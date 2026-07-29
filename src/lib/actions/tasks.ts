'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireFlowEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { sendEmail } from '@/lib/email'
import { taskAssignedEmail, taskStatusChangedEmail } from '@/lib/email/templates'
import type { FlowTaskStatus, FlowTaskPriority, Prisma, UserRole } from '@/generated/prisma/client'

// ============================================
// TYPES
// ============================================

export type TaskFormData = {
  title: string
  description?: string
  status?: FlowTaskStatus
  priority?: FlowTaskPriority
  assigneeIds?: string[]
  groupId?: string | null
  dueDate?: Date | null
  notes?: string
  linkedEntityType?: string | null
  linkedEntityId?: string | null
}

export type GroupFormData = {
  name: string
  color?: string
}

const ASSIGNEES_SELECT = { select: { id: true, name: true, email: true } } as const

function revalidateFlow() {
  revalidatePath('/dashboard/flow')
  revalidatePath('/dashboard')
}

// ============================================
// FLOW_USER SCOPING
// ============================================
//
// FLOW_USER role can see tasks they created OR are assigned to. They can
// edit/delete only what they created. On tasks they are merely assigned to
// (not created), they may only change status, notes, and add comments —
// or remove themselves from the assignee list.
//
// Admins, super admins, and staff see everything (existing behavior).
// VIEWER continues to be rejected from any mutation but can read via getGroups.

type FlowAuthScope = {
  userId: string
  role: UserRole
  isFlowOnly: boolean
  taskWhere: Prisma.FlowTaskWhereInput
}

async function flowScope(authResult: {
  authorized: boolean
  userId?: string
  role?: UserRole
  error?: string
}): Promise<FlowAuthScope> {
  if (!authResult.authorized || !authResult.userId || !authResult.role) {
    throw new Error(authResult.error || 'Unauthorized')
  }
  const isFlowOnly = authResult.role === 'FLOW_USER'
  const taskWhere: Prisma.FlowTaskWhereInput = isFlowOnly
    ? {
        OR: [
          { createdById: authResult.userId },
          { assignees: { some: { id: authResult.userId } } },
        ],
      }
    : {}
  return { userId: authResult.userId, role: authResult.role, isFlowOnly, taskWhere }
}

// Fields that a FLOW_USER may edit on a task they are assigned to but did
// not create. Anything else throws (assigneeIds is allowed only for self-unassign).
const ASSIGNEE_EDITABLE_FIELDS = new Set<keyof TaskFormData>(['status', 'notes'])

function isSelfUnassign(
  existingAssigneeIds: string[],
  newAssigneeIds: string[],
  userId: string,
): boolean {
  // Allowed: the only diff is that userId was present in existing and is now absent.
  const removed = existingAssigneeIds.filter(id => !newAssigneeIds.includes(id))
  const added = newAssigneeIds.filter(id => !existingAssigneeIds.includes(id))
  return added.length === 0 && removed.length === 1 && removed[0] === userId
}

async function assertCanWriteGroup(groupId: string, scope: FlowAuthScope) {
  if (!scope.isFlowOnly) return
  const g = await prisma.flowGroup.findUnique({
    where: { id: groupId },
    select: { createdById: true },
  })
  if (!g) throw new Error('Group not found')
  if (g.createdById !== scope.userId) throw new Error('Forbidden')
}

// ============================================
// GROUPS
// ============================================

export async function getGroups() {
  const auth = await requireAuth()
  const scope = await flowScope(auth)

  const groups = await prisma.flowGroup.findMany({
    include: {
      tasks: {
        where: scope.taskWhere,
        include: {
          assignees: ASSIGNEES_SELECT,
          createdBy: { select: { id: true, name: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

  // For FLOW_USER, only show groups they created OR groups containing visible tasks.
  // (Admins see every group, even empty ones — same as before.)
  const visibleGroups = scope.isFlowOnly
    ? groups.filter(g => g.createdById === scope.userId || g.tasks.length > 0)
    : groups

  // Also get ungrouped tasks
  const ungroupedTasks = await prisma.flowTask.findMany({
    where: { groupId: null, ...scope.taskWhere },
    include: {
      assignees: ASSIGNEES_SELECT,
      createdBy: { select: { id: true, name: true } },
      _count: { select: { comments: true } },
    },
    orderBy: { sortOrder: 'asc' },
  })

  return serialize({ groups: visibleGroups, ungroupedTasks })
}

export async function createGroup(data: GroupFormData) {
  const auth = await requireFlowEditor()
  const scope = await flowScope(auth)

  const maxSort = await prisma.flowGroup.aggregate({ _max: { sortOrder: true } })
  const group = await prisma.flowGroup.create({
    data: {
      name: data.name,
      color: data.color || '#6366f1',
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      createdById: scope.userId,
    },
  })

  revalidateFlow()
  return serialize(group)
}

export async function updateGroup(id: string, data: Partial<GroupFormData> & { collapsed?: boolean; sortOrder?: number }) {
  const auth = await requireFlowEditor()
  const scope = await flowScope(auth)
  await assertCanWriteGroup(id, scope)

  const group = await prisma.flowGroup.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.collapsed !== undefined ? { collapsed: data.collapsed } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    },
  })

  revalidateFlow()
  return serialize(group)
}

export async function deleteGroup(id: string) {
  const auth = await requireFlowEditor()
  const scope = await flowScope(auth)
  await assertCanWriteGroup(id, scope)

  // Ungroup tasks first (don't delete them)
  await prisma.flowTask.updateMany({
    where: { groupId: id },
    data: { groupId: null },
  })

  await prisma.flowGroup.delete({ where: { id } })

  revalidateFlow()
}

// ============================================
// TASKS
// ============================================

export async function createTask(data: TaskFormData) {
  const auth = await requireFlowEditor()
  const scope = await flowScope(auth)

  // FLOW_USER may only create tasks in their own groups (or ungrouped).
  if (scope.isFlowOnly && data.groupId) {
    await assertCanWriteGroup(data.groupId, scope)
  }

  const maxSort = await prisma.flowTask.aggregate({
    _max: { sortOrder: true },
    where: { groupId: data.groupId || null },
  })

  const hasAssignees = data.assigneeIds && data.assigneeIds.length > 0

  // Auto-set status to ASSIGNED when assignees provided and status is default
  const effectiveStatus = hasAssignees && (!data.status || data.status === 'NEW')
    ? 'ASSIGNED'
    : (data.status || 'NEW')

  const task = await prisma.flowTask.create({
    data: {
      title: data.title,
      description: data.description || null,
      status: effectiveStatus,
      priority: data.priority || 'MEDIUM',
      assignees: hasAssignees
        ? { connect: data.assigneeIds!.map(id => ({ id })) }
        : undefined,
      groupId: data.groupId || null,
      dueDate: data.dueDate || null,
      notes: data.notes || null,
      linkedEntityType: data.linkedEntityType || null,
      linkedEntityId: data.linkedEntityId || null,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      createdById: scope.userId,
    },
    include: {
      assignees: ASSIGNEES_SELECT,
    },
  })

  // Send assignment emails to all assignees
  for (const assignee of task.assignees) {
    if (assignee.email) {
      try {
        const { subject, html } = taskAssignedEmail(
          assignee.name,
          task.title,
          task.id,
          data.priority || 'MEDIUM',
          data.dueDate ? new Date(data.dueDate).toLocaleDateString() : undefined,
        )
        await sendEmail({ to: assignee.email, subject, html })
      } catch { /* non-critical */ }
    }
  }

  revalidateFlow()
  return serialize(task)
}

export async function updateTask(id: string, data: Partial<TaskFormData>) {
  const auth = await requireFlowEditor()
  const scope = await flowScope(auth)

  const existing = await prisma.flowTask.findUnique({
    where: { id },
    include: { assignees: ASSIGNEES_SELECT },
  })
  if (!existing) throw new Error('Task not found')

  // FLOW_USER permission gate: validate every field they're trying to change
  // against their relationship to the task (creator vs. assignee vs. neither).
  if (scope.isFlowOnly) {
    const changedFields = (Object.keys(data) as Array<keyof TaskFormData>).filter(
      k => data[k] !== undefined,
    )
    const isCreator = existing.createdById === scope.userId
    const isAssignee = existing.assignees.some(a => a.id === scope.userId)
    if (!isCreator && !isAssignee) throw new Error('Forbidden')

    if (!isCreator) {
      // Assignee-only path: status/notes always OK; assigneeIds OK only as a
      // self-unassign; everything else is rejected.
      const existingIds = existing.assignees.map(a => a.id)
      const newIds = data.assigneeIds ?? existingIds
      const allowed = changedFields.every(f => {
        if (ASSIGNEE_EDITABLE_FIELDS.has(f)) return true
        if (f === 'assigneeIds') return isSelfUnassign(existingIds, newIds, scope.userId)
        return false
      })
      if (!allowed) throw new Error('Forbidden field for assignee')
    } else if (data.groupId !== undefined && data.groupId !== existing.groupId && data.groupId) {
      // Creator moving their task into a different group: must own that group.
      await assertCanWriteGroup(data.groupId, scope)
    }
  }

  const updateData: Record<string, unknown> = {}
  if (data.title !== undefined) updateData.title = data.title
  if (data.description !== undefined) updateData.description = data.description || null
  if (data.priority !== undefined) updateData.priority = data.priority
  if (data.groupId !== undefined) updateData.groupId = data.groupId || null
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate || null
  if (data.notes !== undefined) updateData.notes = data.notes || null
  if (data.linkedEntityType !== undefined) updateData.linkedEntityType = data.linkedEntityType || null
  if (data.linkedEntityId !== undefined) updateData.linkedEntityId = data.linkedEntityId || null

  // Handle assignees update (set = replace all)
  if (data.assigneeIds !== undefined) {
    updateData.assignees = {
      set: data.assigneeIds.map(uid => ({ id: uid })),
    }
  }

  // Auto-transition status based on assignee changes
  const existingIds = existing.assignees.map(a => a.id)
  const newIds = data.assigneeIds !== undefined ? data.assigneeIds : existingIds
  const hadAssignees = existingIds.length > 0
  const hasAssignees = newIds.length > 0
  const newStatus = data.status !== undefined ? data.status : existing.status

  // Auto-set ASSIGNED when assignees added to a NEW task (unless status was explicitly changed)
  if (data.assigneeIds !== undefined && hasAssignees && !hadAssignees && newStatus === 'NEW' && data.status === undefined) {
    updateData.status = 'ASSIGNED'
  }
  // Auto-revert to NEW when all assignees removed from an ASSIGNED task
  if (data.assigneeIds !== undefined && !hasAssignees && hadAssignees && existing.status === 'ASSIGNED' && data.status === undefined) {
    updateData.status = 'NEW'
  }

  // Status transitions (explicit status change)
  if (data.status !== undefined && data.status !== existing.status) {
    updateData.status = data.status
    if (data.status === 'IN_PROGRESS' && !existing.startedAt) {
      updateData.startedAt = new Date()
    }
    // CLOSED is a terminal status (same as COMPLETED for stamping completedAt
    // and hiding from default views) — used when work stops without finishing.
    if (data.status === 'COMPLETED' || data.status === 'CLOSED') {
      updateData.completedAt = new Date()
    }
    if (data.status !== 'COMPLETED' && data.status !== 'CLOSED') {
      updateData.completedAt = null
    }
  }

  const task = await prisma.flowTask.update({
    where: { id },
    data: updateData,
    include: {
      assignees: ASSIGNEES_SELECT,
    },
  })

  // Send email to newly added assignees
  if (data.assigneeIds !== undefined) {
    const addedIds = data.assigneeIds.filter(uid => !existingIds.includes(uid))
    for (const assignee of task.assignees.filter(a => addedIds.includes(a.id))) {
      if (assignee.email) {
        try {
          const { subject, html } = taskAssignedEmail(
            assignee.name,
            task.title,
            task.id,
            task.priority,
            task.dueDate ? task.dueDate.toLocaleDateString() : undefined,
          )
          await sendEmail({ to: assignee.email, subject, html })
        } catch { /* non-critical */ }
      }
    }
  }

  // Send email on status change (to all assignees)
  if (data.status && data.status !== existing.status) {
    for (const assignee of task.assignees) {
      if (assignee.email) {
        try {
          const { subject, html } = taskStatusChangedEmail(
            assignee.name,
            task.title,
            task.id,
            existing.status,
            data.status,
          )
          await sendEmail({ to: assignee.email, subject, html })
        } catch { /* non-critical */ }
      }
    }
  }

  revalidateFlow()
  return serialize(task)
}

export async function deleteTask(id: string) {
  const auth = await requireFlowEditor()
  const scope = await flowScope(auth)

  if (scope.isFlowOnly) {
    const t = await prisma.flowTask.findUnique({
      where: { id },
      select: { createdById: true },
    })
    if (!t) throw new Error('Task not found')
    if (t.createdById !== scope.userId) throw new Error('Forbidden')
  }

  await prisma.flowTask.delete({ where: { id } })

  revalidateFlow()
}

export async function moveTask(id: string, groupId: string | null, sortOrder: number) {
  const auth = await requireFlowEditor()
  const scope = await flowScope(auth)

  if (scope.isFlowOnly) {
    // Must be the creator to move a task. Destination group, if any, must
    // be a group they own (admins' groups are read-only to flow users).
    const t = await prisma.flowTask.findUnique({
      where: { id },
      select: { createdById: true },
    })
    if (!t) throw new Error('Task not found')
    if (t.createdById !== scope.userId) throw new Error('Forbidden')
    if (groupId) await assertCanWriteGroup(groupId, scope)
  }

  await prisma.flowTask.update({
    where: { id },
    data: { groupId, sortOrder },
  })

  revalidateFlow()
}

// ============================================
// COMMENTS
// ============================================

export async function addComment(taskId: string, content: string) {
  const auth = await requireFlowEditor()
  const scope = await flowScope(auth)

  // FLOW_USER may only comment on tasks in their visibility scope.
  if (scope.isFlowOnly) {
    const t = await prisma.flowTask.findUnique({
      where: { id: taskId },
      select: {
        createdById: true,
        assignees: { select: { id: true } },
      },
    })
    if (!t) throw new Error('Task not found')
    const inScope = t.createdById === scope.userId || t.assignees.some(a => a.id === scope.userId)
    if (!inScope) throw new Error('Forbidden')
  }

  const comment = await prisma.flowTaskComment.create({
    data: {
      taskId,
      authorId: scope.userId,
      content,
    },
    include: {
      author: { select: { id: true, name: true } },
    },
  })

  // Notify all task assignees about the comment
  const task = await prisma.flowTask.findUnique({
    where: { id: taskId },
    include: { assignees: ASSIGNEES_SELECT },
  })
  if (task) {
    for (const assignee of task.assignees) {
      if (assignee.email && assignee.id !== scope.userId) {
        try {
          const { subject, html } = taskStatusChangedEmail(
            assignee.name,
            task.title,
            task.id,
            'COMMENT',
            `New comment from ${comment.author.name}`,
          )
          await sendEmail({ to: assignee.email, subject, html })
        } catch { /* non-critical */ }
      }
    }
  }

  revalidateFlow()
  return serialize(comment)
}

export async function getTaskComments(taskId: string) {
  const auth = await requireAuth()
  const scope = await flowScope(auth)

  // FLOW_USER may only read comments on tasks in their visibility scope.
  if (scope.isFlowOnly) {
    const t = await prisma.flowTask.findUnique({
      where: { id: taskId },
      select: {
        createdById: true,
        assignees: { select: { id: true } },
      },
    })
    if (!t) throw new Error('Task not found')
    const inScope = t.createdById === scope.userId || t.assignees.some(a => a.id === scope.userId)
    if (!inScope) throw new Error('Forbidden')
  }

  const comments = await prisma.flowTaskComment.findMany({
    where: { taskId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return serialize(comments)
}

// ============================================
// STATS
// ============================================

export async function getTaskStats() {
  const auth = await requireAuth()
  const scope = await flowScope(auth)

  const [total, byStatus, overdue] = await Promise.all([
    prisma.flowTask.count({ where: scope.taskWhere }),
    prisma.flowTask.groupBy({
      by: ['status'],
      _count: true,
      where: scope.taskWhere,
    }),
    prisma.flowTask.count({
      where: {
        ...scope.taskWhere,
        dueDate: { lt: new Date() },
        status: { notIn: ['COMPLETED', 'CLOSED'] },
      },
    }),
  ])

  const statusCounts: Record<string, number> = {}
  for (const s of byStatus) {
    statusCounts[s.status] = s._count
  }

  return { total, ...statusCounts, overdue }
}
