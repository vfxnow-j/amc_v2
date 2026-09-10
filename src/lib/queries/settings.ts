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

/* ── Integrations ───────────────────────────────────────────────────────── */

export type IntegrationState = {
  hubspot: {
    enabled: boolean;
    /** Presence only. The token itself must never reach a rendered page. */
    hasToken: boolean;
    hasWebhookSecret: boolean;
    pipelineRental: string;
    pipelineSale: string;
    pipelineRTO: string;
    pipelineCloud: string;
  };
  zapier: { hasSecret: boolean };
};

/**
 * What is configured, without saying what it is configured *with*.
 *
 * `getHubSpotSettings` in `lib/actions/hubspot-settings.ts` returns the access
 * token and the webhook secret in full, which is right for the code that calls
 * HubSpot and wrong for anything that renders. A screen only ever needs to know
 * whether a credential is set, so that is all this returns — the values stay in
 * the database and in the outbound call.
 */
export async function getIntegrationState(): Promise<IntegrationState> {
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [
          "hubspot_access_token",
          "hubspot_webhook_secret",
          "hubspot_enabled",
          "hubspot_pipeline_rental",
          "hubspot_pipeline_sale",
          "hubspot_pipeline_rto",
          "hubspot_pipeline_cloud",
          "zapier_webhook_secret",
        ],
      },
    },
  });

  const map = new Map(rows.map((row) => [row.key, row.value]));
  // `Setting.value` is a Json column, so it is worth checking rather than
  // asserting: a key holding a number would satisfy `as string` and then be
  // rendered as one.
  const text = (key: string, fallback = "default") => {
    const value = map.get(key);
    return typeof value === "string" && value ? value : fallback;
  };

  return {
    hubspot: {
      enabled: map.get("hubspot_enabled") === true,
      hasToken: !!map.get("hubspot_access_token"),
      hasWebhookSecret: !!map.get("hubspot_webhook_secret"),
      pipelineRental: text("hubspot_pipeline_rental"),
      pipelineSale: text("hubspot_pipeline_sale"),
      pipelineRTO: text("hubspot_pipeline_rto"),
      pipelineCloud: text("hubspot_pipeline_cloud"),
    },
    zapier: { hasSecret: !!map.get("zapier_webhook_secret") },
  };
}

/* ── Documents ──────────────────────────────────────────────────────────── */

export type DocumentRow = {
  id: string;
  documentType: string;
  filename: string;
  fileSize: number;
  entityType: string;
  entityId: string;
  /** "R-2026-0042" or the vendor's PO number — what a person calls it. */
  entityLabel: string;
  entitySubLabel: string;
  isSigned: boolean;
  signedBy: string | null;
  signedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  deleteReason: string | null;
  fileExists: boolean;
};

export type DocumentSweep = {
  rows: DocumentRow[];
  /**
   * True when the whole `documents/` tree is absent, which is a different
   * problem from individual files having gone missing — and the only one of
   * the two that "repair" cannot help with.
   */
  storeMissing: boolean;
  missing: number;
};

export async function getDocumentRows(filters: {
  documentType?: string;
  search?: string;
  trash?: boolean;
}): Promise<DocumentSweep> {
  const fs = await import("fs/promises");
  const { resolveDocPath } = await import("@/lib/actions/documents");

  const where: Prisma.DocumentWhereInput = {
    deletedAt: filters.trash ? { not: null } : null,
  };
  if (filters.documentType)
    where.documentType = filters.documentType as Prisma.DocumentWhereInput["documentType"];
  if (filters.search)
    where.filename = { contains: filters.search, mode: "insensitive" };

  const documents = await prisma.document.findMany({
    where,
    orderBy: filters.trash ? { deletedAt: "desc" } : { createdAt: "desc" },
  });

  // One probe decides whether this instance holds the document store at all.
  // v2 is a fresh checkout against a restored database, so "every row is
  // broken" is the expected state here and 93 individual stat calls would be
  // 93 ways of finding out the same thing.
  let storeMissing = false;
  if (documents.length > 0) {
    const probe = await resolveDocPath(documents[0].filePath);
    const root = probe.slice(0, probe.lastIndexOf("/documents/") + 10);
    try {
      await fs.access(root);
    } catch {
      storeMissing = true;
    }
  }

  const present = storeMissing
    ? documents.map(() => false)
    : await Promise.all(
        documents.map(async (doc) => {
          try {
            await fs.access(await resolveDocPath(doc.filePath));
            return true;
          } catch {
            return false;
          }
        }),
      );

  // Resolve what each document is attached to, in one query per entity kind
  // rather than one per row.
  const byType = new Map<string, Set<string>>();
  for (const doc of documents) {
    const set = byType.get(doc.entityType) ?? new Set<string>();
    set.add(doc.entityId);
    byType.set(doc.entityType, set);
  }
  const ids = (type: string) => [...(byType.get(type) ?? [])];

  const [reservations, purchaseOrders, clients, assets] = await Promise.all([
    prisma.reservation.findMany({
      where: { id: { in: ids("RESERVATION") } },
      select: {
        id: true,
        reservationNumber: true,
        client: { select: { name: true } },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: { id: { in: ids("PURCHASE_ORDER") } },
      select: { id: true, poNumber: true, vendor: { select: { name: true } } },
    }),
    prisma.client.findMany({
      where: { id: { in: ids("CLIENT") } },
      select: { id: true, name: true },
    }),
    prisma.asset.findMany({
      where: { id: { in: ids("ASSET") } },
      select: { id: true, name: true },
    }),
  ]);

  const labels = new Map<string, { label: string; sub: string }>();
  for (const row of reservations)
    labels.set(row.id, {
      label: row.reservationNumber,
      sub: row.client?.name ?? "",
    });
  for (const row of purchaseOrders)
    labels.set(row.id, { label: row.poNumber, sub: row.vendor?.name ?? "" });
  for (const row of clients) labels.set(row.id, { label: row.name, sub: "" });
  for (const row of assets) labels.set(row.id, { label: row.name, sub: "" });

  const rows = documents.map((doc, index): DocumentRow => {
    const named = labels.get(doc.entityId);
    return {
      id: doc.id,
      documentType: doc.documentType,
      filename: doc.filename,
      fileSize: doc.fileSize,
      entityType: doc.entityType,
      entityId: doc.entityId,
      // A missing label means the order or PO it hung off has been deleted;
      // the id is shown rather than a blank, so the row still identifies itself.
      entityLabel: named?.label ?? doc.entityId,
      entitySubLabel: named?.sub ?? "",
      isSigned: doc.isSigned,
      signedBy: doc.signedBy,
      signedAt: doc.signedAt,
      createdAt: doc.createdAt,
      deletedAt: doc.deletedAt,
      deleteReason: doc.deleteReason,
      fileExists: present[index],
    };
  });

  return {
    rows,
    storeMissing,
    missing: rows.filter((row) => !row.fileExists).length,
  };
}

/** How many are in Trash, for the tab that offers to show them. */
export async function getTrashedDocumentCount(): Promise<number> {
  return prisma.document.count({ where: { deletedAt: { not: null } } });
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
