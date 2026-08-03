import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Reads behind the Settings area.
 *
 * The ported `lib/actions/*` already cover the write path and the single-record
 * reads each form needs, and they stay in charge of authorisation. What they
 * don't do is answer a list screen's question in one query — `getUsers` loads
 * every column of every user to show five, `getAllDocuments` stats every file on
 * disk to decide whether a row is broken. Those are right for the screens that
 * need them and wrong for an index, so the counting lives here.
 *
 * Nothing in this module decides who may see what. Every caller is a server
 * component that has already resolved the session, and the actions the forms
 * call gate themselves.
 */

/* ── The index ──────────────────────────────────────────────────────────── */

/**
 * One line of provable state per settings screen, keyed by the page id in
 * `lib/settings/pages`.
 *
 * Deliberately strings rather than numbers: what is worth saying differs per
 * screen — "9 accounts · 1 never signed in" against "not connected" — and a
 * bare count under half of them would be the kind of unqualified number the
 * build plan rules out. A screen with nothing provable to say gets nothing.
 */
export type SettingsState = Record<string, string | undefined>;

export async function getSettingsState(): Promise<SettingsState> {
  const [
    users,
    pendingUsers,
    apiKeys,
    activeKeys,
    categories,
    cloudProducts,
    activeCloud,
    documents,
    trashed,
    auditEvents,
    lastAudit,
    lastImport,
    qbToken,
    connectionKeys,
  ] = await Promise.all([
    prisma.user.count(),
    // No password hash means the invite was sent and never completed.
    prisma.user.count({ where: { passwordHash: null } }),
    prisma.apiKey.count(),
    prisma.apiKey.count({ where: { isActive: true } }),
    prisma.assetCategory.count(),
    prisma.cloudProduct.count(),
    prisma.cloudProduct.count({ where: { active: true } }),
    prisma.document.count({ where: { deletedAt: null } }),
    prisma.document.count({ where: { deletedAt: { not: null } } }),
    prisma.auditLog.count(),
    prisma.auditLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { action: "IMPORT" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.qBToken.findUnique({
      where: { id: "qb-token" },
      select: { realmId: true, expiresAt: true },
    }),
    prisma.setting.findMany({
      where: { key: { in: ["zapier_webhook_secret", "hubspot_enabled"] } },
      select: { key: true, value: true },
    }),
  ]);

  const settings = new Map(connectionKeys.map((row) => [row.key, row.value]));
  const connected: string[] = [];
  if (settings.get("hubspot_enabled") === true) connected.push("HubSpot");
  if (settings.get("zapier_webhook_secret")) connected.push("Zapier");

  return {
    users: `${users} ${users === 1 ? "account" : "accounts"}${
      pendingUsers ? ` · ${pendingUsers} never signed in` : ""
    }`,
    "api-keys": apiKeys
      ? `${activeKeys} live of ${apiKeys}`
      : "None issued yet",
    categories: `${categories} in use`,
    "cloud-products": cloudProducts
      ? `${activeCloud} sellable of ${cloudProducts}`
      : "No pricing set",
    documents: `${documents} on file${trashed ? ` · ${trashed} in trash` : ""}`,
    "audit-log": lastAudit
      ? `${auditEvents.toLocaleString("en-US")} events · last ${relativeDay(lastAudit.createdAt)}`
      : "Nothing logged yet",
    import: lastImport
      ? `Last run ${relativeDay(lastImport.createdAt)}`
      : "Never run here",
    quickbooks: qbToken
      ? `Connected to realm ${qbToken.realmId}`
      : "Not connected",
    integrations: connected.length
      ? `${connected.join(" and ")} configured`
      : "Nothing configured",
  };
}

/** "today", "yesterday", "12 days ago" — enough to judge staleness. */
function relativeDay(at: Date): string {
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/* ── Users ──────────────────────────────────────────────────────────────── */

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  /** False while the invite is outstanding — they have never set a password. */
  active: boolean;
  mfaEnabled: boolean;
  createdAt: Date;
  lastPasswordChange: Date | null;
};

export async function getUserRows(search: string): Promise<UserRow[]> {
  const contains = { contains: search, mode: "insensitive" } as const;
  const users = await prisma.user.findMany({
    where: search
      ? { OR: [{ name: contains }, { email: contains }] }
      : undefined,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      mfaEnabled: true,
      createdAt: true,
      passwordChangedAt: true,
      // Selected only to be reduced to a boolean below — the hash never leaves
      // this function.
      passwordHash: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: !!user.passwordHash,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt,
    lastPasswordChange: user.passwordChangedAt,
  }));
}

/**
 * Devices allowed to skip the second factor, for the profile screen.
 *
 * Read here rather than through `actions/mfa-trust.getTrustedDevices`, which
 * passes its rows through `serialize` — that helper turns Dates into ISO
 * strings at runtime while declaring it returns the type it was given, so the
 * caller is handed a value that does not match its own type. Reading the rows
 * directly keeps the Dates real, which is what the rest of the app formats.
 *
 * Expired tokens are filtered out: the list exists to answer "what could skip
 * the code right now", and a lapsed token could not.
 */
export async function getTrustedDevicesFor(userId: string) {
  return prisma.mfaTrustToken.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, deviceName: true, lastUsedAt: true, expiresAt: true },
    orderBy: { lastUsedAt: "desc" },
  });
}

export type UserDetail = UserRow & {
  mfaDefault: string | null;
  hasTotpSecret: boolean;
  checkoutsCreated: number;
  checkinsHandled: number;
  ordersPrepared: number;
  auditEvents: number;
  lastSeen: Date | null;
};

/**
 * One account, with the trail behind it.
 *
 * The counts are the argument against deleting somebody: an account with two
 * hundred check-outs against it is a name that appears all over the history,
 * and whoever is about to remove it should see that first. `lastSeen` is the
 * most recent audit entry, which is the closest thing the schema has to a
 * last-login — there is no `lastLoginAt` column, and inventing one from
 * `updatedAt` would be a guess.
 */
export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      mfaEnabled: true,
      mfaDefault: true,
      mfaSecret: true,
      createdAt: true,
      passwordChangedAt: true,
      passwordHash: true,
      _count: {
        select: {
          checkoutsCreated: true,
          checkoutsCheckedIn: true,
          reservationsPrepared: true,
          auditLogs: true,
        },
      },
    },
  });
  if (!user) return null;

  const lastAudit = await prisma.auditLog.findFirst({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: !!user.passwordHash,
    mfaEnabled: user.mfaEnabled,
    mfaDefault: user.mfaDefault,
    hasTotpSecret: !!user.mfaSecret,
    createdAt: user.createdAt,
    lastPasswordChange: user.passwordChangedAt,
    checkoutsCreated: user._count.checkoutsCreated,
    checkinsHandled: user._count.checkoutsCheckedIn,
    ordersPrepared: user._count.reservationsPrepared,
    auditEvents: user._count.auditLogs,
    lastSeen: lastAudit?.createdAt ?? null,
  };
}

/* ── API keys ───────────────────────────────────────────────────────────── */

export type ApiKeyRow = {
  id: string;
  name: string;
  /** First 12 characters. The rest of the key exists only as a hash. */
  prefix: string;
  role: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
};

export async function getApiKeyRows(): Promise<ApiKeyRow[]> {
  const keys = await prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      prefix: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      createdBy: { select: { name: true } },
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  return keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    role: key.role,
    isActive: key.isActive,
    createdBy: key.createdBy?.name ?? "Deleted user",
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
  }));
}

/* ── Categories ─────────────────────────────────────────────────────────── */

export type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  isConfigurable: boolean;
  isComponent: boolean;
  usefulLifeMonths: number;
  assets: number;
};

export async function getCategoryRows(search: string): Promise<CategoryRow[]> {
  const categories = await prisma.assetCategory.findMany({
    where: search
      ? { name: { contains: search, mode: "insensitive" } }
      : undefined,
    select: {
      id: true,
      name: true,
      description: true,
      isConfigurable: true,
      isComponent: true,
      defaultUsefulLifeMonths: true,
      _count: { select: { assets: true } },
    },
    orderBy: { name: "asc" },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    isConfigurable: category.isConfigurable,
    isComponent: category.isComponent,
    usefulLifeMonths: category.defaultUsefulLifeMonths,
    assets: category._count.assets,
  }));
}

/* ── Cloud pricing ──────────────────────────────────────────────────────── */

export type CloudProductRow = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  costHourly: number;
  costDaily: number;
  costWeekly: number;
  costMonthly: number;
  sellHourly: number | null;
  sellDaily: number | null;
  sellWeekly: number | null;
  sellMonthly: number | null;
  marginPercent: number;
  active: boolean;
  /** Lines already sold at this price — why a delete can be refused. */
  usedOnOrders: number;
};

export async function getCloudProductRows(): Promise<CloudProductRow[]> {
  const products = await prisma.cloudProduct.findMany({
    include: { _count: { select: { reservationItems: true } } },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  return products.map((product) => ({
    id: product.id,
    category: product.category,
    name: product.name,
    description: product.description,
    costHourly: Number(product.costHourly),
    costDaily: Number(product.costDaily),
    costWeekly: Number(product.costWeekly),
    costMonthly: Number(product.costMonthly),
    sellHourly: product.sellHourly === null ? null : Number(product.sellHourly),
    sellDaily: product.sellDaily === null ? null : Number(product.sellDaily),
    sellWeekly: product.sellWeekly === null ? null : Number(product.sellWeekly),
    sellMonthly:
      product.sellMonthly === null ? null : Number(product.sellMonthly),
    marginPercent: Number(product.marginPercent),
    active: product.active,
    usedOnOrders: product._count.reservationItems,
  }));
}

export async function getCloudProduct(id: string) {
  const product = await prisma.cloudProduct.findUnique({ where: { id } });
  if (!product) return null;

  return {
    id: product.id,
    category: product.category,
    name: product.name,
    description: product.description,
    costHourly: Number(product.costHourly),
    costDaily: Number(product.costDaily),
    costWeekly: Number(product.costWeekly),
    costMonthly: Number(product.costMonthly),
    sellHourly: product.sellHourly === null ? null : Number(product.sellHourly),
    sellDaily: product.sellDaily === null ? null : Number(product.sellDaily),
    sellWeekly: product.sellWeekly === null ? null : Number(product.sellWeekly),
    sellMonthly:
      product.sellMonthly === null ? null : Number(product.sellMonthly),
    marginPercent: Number(product.marginPercent),
    active: product.active,
    sortOrder: product.sortOrder,
  };
}

/* ── Audit log ──────────────────────────────────────────────────────────── */

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = {
  action?: string;
  entityType?: string;
  userId?: string;
  search?: string;
};

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  at: Date;
  who: string | null;
  ipAddress: string | null;
};

function auditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.userId) where.userId = filters.userId;
  if (filters.search) {
    const contains = { contains: filters.search, mode: "insensitive" } as const;
    where.OR = [
      { entityId: contains },
      { user: { name: contains } },
      { user: { email: contains } },
    ];
  }
  return where;
}

export async function getAuditPage(filters: AuditFilters, page: number) {
  const where = auditWhere(filters);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        ipAddress: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    rows: rows.map(
      (row): AuditRow => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        at: row.createdAt,
        who: row.user?.name ?? null,
        ipAddress: row.ipAddress,
      }),
    ),
    total,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

/**
 * The values the log actually contains, so a filter can never be set to
 * something that returns nothing. `distinct` over an indexed column beats
 * hardcoding the enums in `lib/actions/audit`, which list entity types this
 * database has never seen.
 */
export async function getAuditFilterOptions() {
  const [actions, entityTypes, users] = await Promise.all([
    prisma.auditLog.findMany({
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    }),
    prisma.auditLog.findMany({
      select: { entityType: true },
      distinct: ["entityType"],
      orderBy: { entityType: "asc" },
    }),
    prisma.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    actions: actions.map((row) => row.action),
    entityTypes: entityTypes.map((row) => row.entityType),
    users,
  };
}
