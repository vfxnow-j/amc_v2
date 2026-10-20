export type EntityRole = 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'VIEWER' | 'FLOW_USER'

export type AccessUser = {
  role: EntityRole
  entityAccess: boolean
  entityScope: 'ALL' | 'SELECTED'
  grantedEntityIds: string[]
}

export function canEnterEntities(u: AccessUser): boolean {
  if (u.role === 'FLOW_USER') return false
  return u.role === 'SUPER_ADMIN' || u.entityAccess
}

/** The entities (of `allIds`, i.e. the active ones) this user may open. */
export function entityIdsFor(u: AccessUser, allIds: string[]): string[] {
  if (!canEnterEntities(u)) return []
  if (u.role === 'SUPER_ADMIN' || u.entityScope === 'ALL') return allIds
  const granted = new Set(u.grantedEntityIds)
  return allIds.filter((id) => granted.has(id))
}

export function canWriteInEntity(role: EntityRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'STAFF'
}
