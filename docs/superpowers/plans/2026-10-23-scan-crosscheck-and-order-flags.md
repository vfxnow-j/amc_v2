# Scan Cross-check and Order Flag Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scanned unit ends up with both a barcode and a serial (or is flagged until it does), and any order can be flagged as a case that is worked to a recorded outcome, including when a missing unit is later scanned back in.

**Architecture:** Pure rule modules (`lib/scan/completeness.ts`, `lib/flags/*.ts`) with `node:test` tests and no Prisma import; thin `"use server"` action files over them; one shared scan hook (`lib/scan/unit-gate.ts`) that every scan point calls and that returns either "carry on" or a prompt for a person to answer. Orders page filtering follows the existing URL-param pattern (`FilterTabs` + `listWhere`).

**Tech Stack:** Next.js (this repo's version differs from stock — read `node_modules/next/dist/docs/` before writing page/route code), Prisma 7 (`prisma db push`, no migrations dir), `tsx --test`.

## Global Constraints

- v1 is read-only and is never written (`db-guard.ts`). Nothing in this plan touches v1.
- `lib/*` modules imported by client components must not import `@/lib/prisma` (client bundle fails on `dns`). Keep rule modules Prisma-free; use `import type` for Prisma types only.
- Run `npm run db:push` then `npm run db:generate`, and **restart the dev server** after any schema change (Prisma client is pinned to `globalThis`).
- Always run `npx tsc --noEmit` and `npm run build` before any restart (build-only faults exist).
- Server actions: `"use server"`, gate with `requireEditor()` (returns `{authorized, userId?, error?}`), audit with `logAudit` (entity types `'Asset'` for units, `'Reservation'` for orders; action `'OVERRIDE'` exists).
- New tests must be added to the `test` script glob in `package.json` (`src/lib/scan/*.test.ts`, `src/lib/flags/*.test.ts`).
- Money is `Decimal(12,2)`; convert with `Number()` at the edge only.
- Commit with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage only the files named in the task (working tree has unrelated changes).
- Unit retirement uses existing `AssetStatus.RETIRED` + `retirementReason = LOST`; do not invent a second "lost" representation.

## Execution shape

Task 1 (schema) runs first and alone. Then two parallel worktrees: **Agent A** = Tasks 2–6, **Agent B** = Tasks 7–13. Task 5 (`unit-gate.ts`) is the only shared file: Agent B's Task 10 extends it, so B must start Task 10 after A's Task 5 is merged. B's Tasks 7–9 and 11–13 do not depend on A.

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | New enums + `OrderFlag`, `OrderFlagStep`, `OrderFlagUnit`; fields on `Asset`, `AssetUnit` |
| `src/lib/scan/completeness.ts` (+test) | Pure: is a unit complete, does a scanned serial match, normalise a serial |
| `src/lib/actions/unit-data.ts` | Server: `fixUnitSerial`, `skipUnitSerial`, `listIncompleteUnits` |
| `src/lib/scan/unit-gate.ts` | Server-safe: `gateUnit(code)` → `{kind:"clear"} \| {kind:"needs-data"} \| {kind:"on-case"}` |
| `src/components/scan/unit-gate-prompt.tsx` | Client dialog answering a gate result |
| `src/app/(shell)/dashboard/inventory/missing-data/page.tsx` | Missing data screen |
| `scripts/backfill-unit-data-flags.ts` | One-off flag of existing incomplete units (run on request only) |
| `src/lib/flags/catalog.ts` (+test) | Pure: categories, reasons, severities, playbooks, outcomes |
| `src/lib/flags/rules.ts` (+test) | Pure: exposure, can-close, auto-raise decisions, overdue-days |
| `src/lib/actions/order-flags.ts` | Server: raise, toggle step, close with outcome, reinstate |
| `src/lib/queries/order-flags.ts` | Server: flag filter `where`, counts, dashboard tile data |
| `src/components/orders/flag-dialog.tsx`, `flag-panel.tsx` | Raise dialog; case panel on the order |

---

### Task 1: Schema for both tracks

**Files:**
- Modify: `prisma/schema.prisma` (enum `AssetStatus` ~205; `Asset` ~359; `AssetUnit` ~526; `Reservation` ~991 relations; end of file for new models)

**Interfaces:**
- Produces: Prisma types `DataFlag`, `FlagSeverity`, `FlagSource`, `FlagOutcome`, models `OrderFlag`, `OrderFlagStep`, `OrderFlagUnit`; `Asset.requiresSerial`; `AssetUnit.dataFlag/dataFlaggedAt/dataFlaggedById`; `AssetStatus.MISSING`.

- [ ] **Step 1: Add the enums**

```prisma
enum AssetStatus {
  AVAILABLE
  CHECKED_OUT
  MAINTENANCE
  RETIRED
  RESERVED
  SOLD
  /// Out on an open order flag (lost in transit, not returned). Not bookable.
  MISSING
}

enum DataFlag {
  MISSING_SERIAL
  MISSING_BARCODE
  MISMATCH
}

enum FlagSeverity {
  INFO
  ATTENTION
  CRITICAL
}

enum FlagSource {
  MANUAL
  SYSTEM
}

enum FlagOutcome {
  FOUND_RETURNED
  FOUND_DAMAGED
  CLAIM_PAID
  CLIENT_BILLED
  WRITTEN_OFF
}
```

- [ ] **Step 2: Add the fields**

In `Asset` add `requiresSerial Boolean @default(true)`. In `AssetUnit` add:

```prisma
  dataFlag         DataFlag?
  dataFlaggedAt    DateTime?
  dataFlaggedById  String?
  flagUnits        OrderFlagUnit[]

  @@index([dataFlag])
```

(`AssetUnit` already has an `@@index([purchaseOrderId])`; add the new index beside it.)

- [ ] **Step 3: Add the models**

```prisma
model OrderFlag {
  id              String       @id @default(cuid())
  reservationId   String
  reservation     Reservation  @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  category        String
  reason          String
  note            String?
  severity        FlagSeverity @default(ATTENTION)
  source          FlagSource   @default(MANUAL)
  /// SYSTEM flags only: the rule that raised it, so re-running the rule finds it again.
  ruleKey         String?
  ownerId         String?
  owner           User?        @relation("OrderFlagOwner", fields: [ownerId], references: [id])
  raisedById      String?
  raisedAt        DateTime     @default(now())
  exposureAmount  Decimal      @default(0) @db.Decimal(12, 2)
  nextActionDate  DateTime?
  carrier         String?
  trackingNumber  String?
  claimNumber     String?
  resolvedAt      DateTime?
  resolvedById    String?
  outcome         FlagOutcome?
  outcomeAmount   Decimal?     @db.Decimal(12, 2)
  resolutionNote  String?
  steps           OrderFlagStep[]
  units           OrderFlagUnit[]

  @@index([reservationId])
  @@index([resolvedAt])
  @@unique([reservationId, ruleKey, resolvedAt])
  @@map("order_flags")
}

model OrderFlagStep {
  id       String    @id @default(cuid())
  flagId   String
  flag     OrderFlag @relation(fields: [flagId], references: [id], onDelete: Cascade)
  position Int
  label    String
  doneAt   DateTime?
  doneById String?
  note     String?

  @@index([flagId])
  @@map("order_flag_steps")
}

model OrderFlagUnit {
  id          String      @id @default(cuid())
  flagId      String
  flag        OrderFlag   @relation(fields: [flagId], references: [id], onDelete: Cascade)
  assetUnitId String
  assetUnit   AssetUnit   @relation(fields: [assetUnitId], references: [id])
  /// Status to restore if the unit is found.
  priorStatus AssetStatus
  foundAt     DateTime?
  foundNote   String?

  @@unique([flagId, assetUnitId])
  @@index([assetUnitId])
  @@map("order_flag_units")
}
```

Add `flags OrderFlag[]` to `Reservation` and `ownedFlags OrderFlag[] @relation("OrderFlagOwner")` to `User`.

- [ ] **Step 4: Push and generate**

Run: `npm run db:push && npm run db:generate`
Expected: "Your database is now in sync" and "Generated Prisma Client". Restart the dev server afterwards.

- [ ] **Step 5: Find exhaustive `AssetStatus` uses**

Run: `npx tsc --noEmit`
Expected: any `Record<AssetStatus, …>` or exhaustive switch now errors. Fix each by adding `MISSING` (label "Missing", same tone as MAINTENANCE, never bookable). Re-run until clean.

Run: `grep -rn "status: *{ *in\|notIn" src/lib/queries src/lib/actions | grep -i "AVAILABLE\|RETIRED"` and confirm every availability query treats `MISSING` as not available (it already does if it lists AVAILABLE positively; fix any that list only `notIn: [RETIRED, SOLD]`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma <files fixed in step 5>
git commit -m "feat: schema for unit data flags and order flag cases"
```

---

## Agent A — barcode + serial cross-check

### Task 2: Completeness rules (pure)

**Files:**
- Create: `src/lib/scan/completeness.ts`
- Test: `src/lib/scan/completeness.test.ts`
- Modify: `package.json` (`test` glob)

**Interfaces:**
- Produces:
  - `type UnitFacts = { barcode: string | null; serialNumber: string | null; requiresSerial: boolean }`
  - `type Gap = "MISSING_SERIAL" | "MISSING_BARCODE"`
  - `checkUnit(u: UnitFacts): { complete: true } | { complete: false; gap: Gap }`
  - `normalizeSerial(raw: string): string` (trim, collapse inner whitespace, uppercase)
  - `checkMatch(unitSerial: string | null, scanned: string): "match" | "mismatch" | "unknown"` (`unknown` when the unit has no serial to compare to)

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { checkMatch, checkUnit, normalizeSerial } from "./completeness";

test("a unit with both values is complete", () => {
  assert.deepEqual(
    checkUnit({ barcode: "AMC-1", serialNumber: "C02XYZ", requiresSerial: true }),
    { complete: true },
  );
});

test("a missing serial is a gap only when the item requires one", () => {
  assert.deepEqual(
    checkUnit({ barcode: "AMC-1", serialNumber: null, requiresSerial: true }),
    { complete: false, gap: "MISSING_SERIAL" },
  );
  assert.deepEqual(
    checkUnit({ barcode: "CBL-1", serialNumber: null, requiresSerial: false }),
    { complete: true },
  );
});

test("a blank serial counts as missing", () => {
  assert.equal(
    checkUnit({ barcode: "AMC-1", serialNumber: "   ", requiresSerial: true }).complete,
    false,
  );
});

test("a missing barcode is a gap even for exempt items", () => {
  assert.deepEqual(
    checkUnit({ barcode: "", serialNumber: "S1", requiresSerial: false }),
    { complete: false, gap: "MISSING_BARCODE" },
  );
});

test("serials normalise to one form", () => {
  assert.equal(normalizeSerial("  c02 xyz\t1 "), "C02 XYZ 1");
});

test("checkMatch compares normalised, and says unknown with nothing to compare", () => {
  assert.equal(checkMatch("C02XYZ", " c02xyz "), "match");
  assert.equal(checkMatch("C02XYZ", "ZZZ"), "mismatch");
  assert.equal(checkMatch(null, "ZZZ"), "unknown");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/lib/scan/completeness.test.ts`
Expected: FAIL, cannot find module `./completeness`.

- [ ] **Step 3: Implement**

```ts
// Pure rules of the barcode + serial cross-check. No Prisma: client components import this.

export type UnitFacts = {
  barcode: string | null;
  serialNumber: string | null;
  requiresSerial: boolean;
};

export type Gap = "MISSING_SERIAL" | "MISSING_BARCODE";

export function normalizeSerial(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

const blank = (v: string | null) => v === null || v.trim() === "";

/** A barcode is always required; a serial only when the catalog item says so. */
export function checkUnit(u: UnitFacts): { complete: true } | { complete: false; gap: Gap } {
  if (blank(u.barcode)) return { complete: false, gap: "MISSING_BARCODE" };
  if (u.requiresSerial && blank(u.serialNumber)) {
    return { complete: false, gap: "MISSING_SERIAL" };
  }
  return { complete: true };
}

/** Does the serial label just scanned belong to the unit its barcode resolved to? */
export function checkMatch(
  unitSerial: string | null,
  scanned: string,
): "match" | "mismatch" | "unknown" {
  if (blank(unitSerial)) return "unknown";
  return normalizeSerial(unitSerial as string) === normalizeSerial(scanned)
    ? "match"
    : "mismatch";
}
```

- [ ] **Step 4: Add the test globs and run**

In `package.json` `test`, append ` src/lib/scan/*.test.ts src/lib/flags/*.test.ts`.
Run: `npx tsx --test src/lib/scan/completeness.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scan/completeness.ts src/lib/scan/completeness.test.ts package.json
git commit -m "feat: pure completeness rules for unit barcode + serial"
```

---

### Task 3: Unit data actions

**Files:**
- Create: `src/lib/actions/unit-data.ts`

**Interfaces:**
- Consumes: `checkUnit`, `normalizeSerial` (Task 2).
- Produces:
  - `fixUnitSerial(unitId: string, serial: string): Promise<{ ok: true } | { ok: false; message: string }>`
  - `skipUnitSerial(unitId: string, gap: Gap): Promise<{ ok: true } | { ok: false; message: string }>`
  - `listIncompleteUnits(): Promise<IncompleteUnit[]>` where `IncompleteUnit = { id; barcode; serialNumber; assetName; gap: Gap; flagged: boolean; location: string | null }`

- [ ] **Step 1: Write the file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/actions/audit";
import { requireEditor } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { checkUnit, normalizeSerial, type Gap } from "@/lib/scan/completeness";

type Result = { ok: true } | { ok: false; message: string };

/** Save a serial on a unit, clearing its data flag. Refuses a serial already in the fleet. */
export async function fixUnitSerial(unitId: string, serial: string): Promise<Result> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, message: auth.error ?? "Unauthorized" };

  const value = normalizeSerial(serial);
  if (!value) return { ok: false, message: "Enter or scan the serial." };

  const clash = await prisma.assetUnit.findFirst({
    where: { serialNumber: { equals: value, mode: "insensitive" }, id: { not: unitId } },
    select: { barcode: true },
  });
  if (clash) return { ok: false, message: `That serial is already on ${clash.barcode}.` };

  const before = await prisma.assetUnit.findUnique({
    where: { id: unitId },
    select: { serialNumber: true, dataFlag: true },
  });
  if (!before) return { ok: false, message: "Unit not found." };

  await prisma.assetUnit.update({
    where: { id: unitId },
    data: { serialNumber: value, dataFlag: null, dataFlaggedAt: null, dataFlaggedById: null },
  });
  await logAudit({
    action: "UPDATE",
    entityType: "Asset",
    entityId: unitId,
    oldValues: { serialNumber: before.serialNumber, dataFlag: before.dataFlag },
    newValues: { serialNumber: value, dataFlag: null },
    userId: auth.userId,
  });
  revalidatePath("/dashboard/inventory/missing-data");
  return { ok: true };
}

/** The person chose to carry on without the serial. Flag it, and log who skipped. */
export async function skipUnitSerial(unitId: string, gap: Gap): Promise<Result> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, message: auth.error ?? "Unauthorized" };

  await prisma.assetUnit.update({
    where: { id: unitId },
    data: { dataFlag: gap, dataFlaggedAt: new Date(), dataFlaggedById: auth.userId },
  });
  await logAudit({
    action: "UPDATE",
    entityType: "Asset",
    entityId: unitId,
    newValues: { dataFlag: gap, skipped: true },
    userId: auth.userId,
  });
  revalidatePath("/dashboard/inventory/missing-data");
  return { ok: true };
}

export type IncompleteUnit = {
  id: string;
  barcode: string;
  serialNumber: string | null;
  assetName: string;
  gap: Gap;
  flagged: boolean;
  location: string | null;
};

/** Every unit that fails `checkUnit`, flagged or not, excluding retired and sold stock. */
export async function listIncompleteUnits(): Promise<IncompleteUnit[]> {
  const auth = await requireEditor();
  if (!auth.authorized) return [];

  const units = await prisma.assetUnit.findMany({
    where: {
      status: { notIn: ["RETIRED", "SOLD"] },
      asset: { requiresSerial: true },
      OR: [{ serialNumber: null }, { serialNumber: "" }],
    },
    select: {
      id: true,
      barcode: true,
      serialNumber: true,
      dataFlag: true,
      asset: { select: { name: true, requiresSerial: true } },
      location: { select: { name: true } },
    },
    orderBy: [{ asset: { name: "asc" } }, { barcode: "asc" }],
  });

  return units.flatMap((u) => {
    const r = checkUnit({
      barcode: u.barcode,
      serialNumber: u.serialNumber,
      requiresSerial: u.asset.requiresSerial,
    });
    if (r.complete) return [];
    return [{
      id: u.id,
      barcode: u.barcode,
      serialNumber: u.serialNumber,
      assetName: u.asset.name,
      gap: r.gap,
      flagged: u.dataFlag !== null,
      location: u.location?.name ?? null,
    }];
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/unit-data.ts
git commit -m "feat: actions to fix, skip and list units missing a serial"
```

---

### Task 4: Settings toggle for `requiresSerial`

**Files:**
- Modify: the catalog item edit form/action. Locate with `grep -rn "manufacturer" src/components/inventory src/lib/actions/assets.ts | head`; the form field list and the `updateAsset` action's accepted-fields list are the two edit points.

**Interfaces:**
- Consumes: `Asset.requiresSerial` (Task 1).

- [ ] **Step 1:** Add a checkbox "Requires a serial number" (default checked) to the catalog item form, beside the manufacturer/model fields, and add `requiresSerial` to the create/update action's accepted fields and `data` object.
- [ ] **Step 2:** `npx tsc --noEmit` — expected clean.
- [ ] **Step 3:** Verify by hand in the dev server: open an item, untick, save, reopen — it stays unticked.
- [ ] **Step 4:** Mark exempt items. This is a data decision for the owner (cables, light items, consumables); do **not** guess. Output a list with `psql`/Prisma of assets where `isInventoried` is false and ask the owner to confirm before setting `requiresSerial = false` on them.
- [ ] **Step 5: Commit** the form and action files.

---

### Task 5: The shared scan gate and its prompt

**Files:**
- Create: `src/lib/scan/unit-gate.ts`
- Create: `src/components/scan/unit-gate-prompt.tsx`
- Modify: `src/lib/actions/desk.ts` (`scanUnitOut`, `scanUnitIn`), `src/lib/actions/scan-desk.ts` (`findOpenReturnsForCode`), `src/lib/actions/scan-receive.ts`, `src/lib/actions/audit.ts`'s inventory-audit scan path (`src/lib/actions/inventory-audits.ts`)
- Test: `src/lib/scan/unit-gate.test.ts` (pure decision function only)

**Interfaces:**
- Consumes: `checkUnit`, `checkMatch` (Task 2); `fixUnitSerial`, `skipUnitSerial` (Task 3).
- Produces:
  - `type GateResult = { kind: "clear" } | { kind: "needs-data"; unitId; barcode; assetName; gap: Gap } | { kind: "mismatch"; unitId; barcode; assetName; expected: string; scanned: string } | { kind: "blocked"; unitId; barcode; assetName; reason: string }`
  - `decideGate(facts: GateFacts): GateResult` (pure) where `GateFacts = { unitId; barcode; assetName; serialNumber; requiresSerial; dataFlag: DataFlag | null; scannedSerial?: string; move: "out" | "in" | "audit" | "lookup" }`
  - `gateUnit(code: string, opts?: { scannedSerial?: string; move: GateFacts["move"] }): Promise<GateResult | null>` (`null` = no such unit; callers keep their existing unknown-barcode handling)
  - `<UnitGatePrompt result onResolved onCancel />` client component
- Task 10 (Agent B) extends `GateResult` with `{ kind: "on-case"; … }`; keep `decideGate` a single switch so that is an additive change.

- [ ] **Step 1: Write the failing test for `decideGate`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { decideGate } from "./unit-gate";

const base = {
  unitId: "u1", barcode: "AMC-1", assetName: "RTX 5090",
  serialNumber: "S1", requiresSerial: true, dataFlag: null, move: "out" as const,
};

test("a complete unit is clear", () => {
  assert.deepEqual(decideGate(base), { kind: "clear" });
});

test("a missing serial prompts", () => {
  const r = decideGate({ ...base, serialNumber: null });
  assert.equal(r.kind, "needs-data");
});

test("a flagged unit going out is blocked, coming back in it prompts", () => {
  const flagged = { ...base, serialNumber: null, dataFlag: "MISSING_SERIAL" as const };
  assert.equal(decideGate(flagged).kind, "blocked");
  assert.equal(decideGate({ ...flagged, move: "in" }).kind, "needs-data");
});

test("a scanned serial label that differs is a mismatch", () => {
  const r = decideGate({ ...base, move: "in", scannedSerial: "OTHER" });
  assert.equal(r.kind, "mismatch");
});

test("a matching serial label is clear", () => {
  assert.deepEqual(decideGate({ ...base, move: "in", scannedSerial: " s1 " }), { kind: "clear" });
});
```

- [ ] **Step 2:** Run `npx tsx --test src/lib/scan/unit-gate.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Implement `unit-gate.ts`**

`decideGate` is exported pure; `gateUnit` is the Prisma wrapper. Because the file imports Prisma, **split**: put `decideGate` + types in `src/lib/scan/unit-gate-rules.ts` (Prisma-free; the test imports this) and `gateUnit` in `src/lib/scan/unit-gate.ts`. Test import becomes `./unit-gate-rules`.

```ts
// unit-gate-rules.ts
import { checkMatch, checkUnit, type Gap } from "./completeness";
import type { DataFlag } from "@/generated/prisma/client";

export type GateFacts = {
  unitId: string; barcode: string; assetName: string;
  serialNumber: string | null; requiresSerial: boolean;
  dataFlag: DataFlag | null;
  scannedSerial?: string;
  move: "out" | "in" | "audit" | "lookup";
};

export type GateResult =
  | { kind: "clear" }
  | { kind: "needs-data"; unitId: string; barcode: string; assetName: string; gap: Gap }
  | { kind: "mismatch"; unitId: string; barcode: string; assetName: string; expected: string; scanned: string }
  | { kind: "blocked"; unitId: string; barcode: string; assetName: string; reason: string };

export function decideGate(f: GateFacts): GateResult {
  const id = { unitId: f.unitId, barcode: f.barcode, assetName: f.assetName };
  const check = checkUnit(f);

  // A unit already flagged cannot leave until its data is fixed. Coming back in,
  // it prompts again: the person is holding it and can read the label now.
  if (!check.complete && f.dataFlag && f.move === "out") {
    return { kind: "blocked", ...id, reason: "Serial number is missing. Fix it under Inventory → Missing data." };
  }
  if (!check.complete) return { kind: "needs-data", ...id, gap: check.gap };

  if (f.scannedSerial && checkMatch(f.serialNumber, f.scannedSerial) === "mismatch") {
    return { kind: "mismatch", ...id, expected: f.serialNumber as string, scanned: f.scannedSerial };
  }
  return { kind: "clear" };
}
```

```ts
// unit-gate.ts
import { prisma } from "@/lib/prisma";
import { decideGate, type GateFacts, type GateResult } from "./unit-gate-rules";

export async function gateUnit(
  code: string,
  opts: { scannedSerial?: string; move: GateFacts["move"] } = { move: "lookup" },
): Promise<GateResult | null> {
  const value = code.trim();
  const unit = await prisma.assetUnit.findFirst({
    where: { OR: [{ barcode: value }, { serialNumber: { equals: value, mode: "insensitive" } }] },
    select: {
      id: true, barcode: true, serialNumber: true, dataFlag: true,
      asset: { select: { name: true, requiresSerial: true } },
    },
  });
  if (!unit) return null;
  return decideGate({
    unitId: unit.id, barcode: unit.barcode, assetName: unit.asset.name,
    serialNumber: unit.serialNumber, requiresSerial: unit.asset.requiresSerial,
    dataFlag: unit.dataFlag, scannedSerial: opts.scannedSerial, move: opts.move,
  });
}
```

Note: a serial *label* scanned as the code resolves the unit through the `serialNumber` branch, so `decideGate` sees a unit whose serial equals the scan — that is a match by construction. The mismatch path is for the two-scan flow (barcode, then serial label) via `scannedSerial`.

- [ ] **Step 4:** Run the test — expected 5 passing.

- [ ] **Step 5: Build `UnitGatePrompt`** (client). Props `{ result: Exclude<GateResult, {kind:"clear"}>; onResolved(): void; onCancel(): void }`. Renders by `result.kind`:
  - `needs-data`: heading "Serial missing — {assetName} ({barcode})", a `ScanField`-style input (reuse `src/components/scan/scan-field.tsx`), buttons **Save serial** (calls `fixUnitSerial`, shows `message` on failure, `onResolved()` on ok) and **Skip for now** (calls `skipUnitSerial`, then `onResolved()`).
  - `mismatch`: "This serial ({scanned}) does not match {barcode} (expected {expected})". Buttons **Flag as possible swap** (calls `skipUnitSerial(unitId, "MISMATCH")`… see step 6 for the action) and **Cancel**.
  - `blocked`: reason text and **OK** (`onCancel`).
  Follow the markup and tokens of `src/components/scan/over-scan-prompt.tsx` exactly (same dialog shell, same button classes).

- [ ] **Step 6:** Extend `skipUnitSerial`'s `gap` parameter type in Task 3 to `Gap | "MISMATCH"` (it stores a `DataFlag`, which includes `MISMATCH`). Re-run `npx tsc --noEmit`.

- [ ] **Step 7: Wire the scan points.** Each wiring is the same shape: call `gateUnit` after the barcode resolves and before any write; if the result is not `clear`, return it to the client in the existing outcome union as `{ status: "gate"; gate: GateResult }` and let the scan component render `UnitGatePrompt`; on `onResolved`, the component re-submits the same scan.
  - `desk.ts` `scanUnitOut`: gate with `move: "out"` before `checkoutByBarcode`. `scanUnitIn`: gate with `move: "in"` before `checkinByBarcode`, passing `scannedSerial` when the return UI collected a serial label.
  - Add `{ status: "gate"; gate: GateResult }` to `ScanOutcome` and `CheckinOutcome`.
  - `scan-receive.ts`: receiving collects serials by design; add the same completeness check on commit so a received unit cannot be saved without a serial when its item `requiresSerial` (read `scanReceiveBrief` and the receipt commit action first; the check goes where the unit rows are created).
  - Inventory audits: in `inventory-audits.ts`, the scan-recording action gets `gateUnit(code, { move: "audit" })`; an incomplete unit prompts but does not block the audit scan (record the scan first).
  - Components to update: `checkout-mode.tsx`, `return-mode.tsx`, `receive-mode.tsx`, and the audit scan component — each renders `UnitGatePrompt` when an outcome has `status === "gate"`.
  - The ship gate (`lib/orders/handover.ts`): add a count of units on the order with `dataFlag` set to `Handover` and refuse in `handover-rules.ts` `shortfallMessage` with "N units are missing a serial" (extend `Handover` with `dataFlagged: number`, update `handover.test.ts` fixtures).

- [ ] **Step 8:** `npx tsc --noEmit && npm test` — expected clean, all pass. Then `npm run build`.

- [ ] **Step 9:** Verify in the browser (see `vfxnow-v2-verifying-screens` memory: run `smoke-routes.ts` first): make a test unit with no serial in a **throwaway** order, scan it out, confirm the prompt, save a serial, confirm the scan completes.

- [ ] **Step 10: Commit** each logical piece (rules+test; gate; prompt; scan-point wiring; handover gate) separately.

---

### Task 6: Missing data screen and backfill script

**Files:**
- Create: `src/app/(shell)/dashboard/inventory/missing-data/page.tsx`
- Create: `src/components/inventory/missing-data-table.tsx`
- Create: `scripts/backfill-unit-data-flags.ts`
- Modify: inventory section nav (find with `grep -rn "inventory/map" src/components/shell`)

**Interfaces:**
- Consumes: `listIncompleteUnits`, `fixUnitSerial` (Task 3).

- [ ] **Step 1:** Page: server component, `PageHeader eyebrow="Inventory" title="Missing data"`, calls `listIncompleteUnits()`, renders `<MissingDataTable rows />`. Follow `orders/page.tsx` for header/suspense conventions and read the Next docs under `node_modules/next/dist/docs/` for this version's page rules first.
- [ ] **Step 2:** `MissingDataTable` (client): columns Item, Barcode, Serial, Location, Flag, and an inline input + **Save** per row calling `fixUnitSerial`; on `ok` the row is removed optimistically, on failure the message shows under the input. Copy the table classes from `order-table.tsx`; tables scroll inside their card on mobile (existing rule).
- [ ] **Step 3:** Add "Missing data" to the Inventory nav with a count badge using the same pattern as existing nav counts.
- [ ] **Step 4: Backfill script** (read-only dry run by default; `--apply` writes):

```ts
import { prisma } from "../src/lib/prisma";
import { checkUnit } from "../src/lib/scan/completeness";

const apply = process.argv.includes("--apply");

async function main() {
  const units = await prisma.assetUnit.findMany({
    where: { status: { notIn: ["RETIRED", "SOLD"] }, dataFlag: null },
    select: { id: true, barcode: true, serialNumber: true, asset: { select: { requiresSerial: true } } },
  });
  const gaps = units.flatMap((u) => {
    const r = checkUnit({ barcode: u.barcode, serialNumber: u.serialNumber, requiresSerial: u.asset.requiresSerial });
    return r.complete ? [] : [{ id: u.id, gap: r.gap }];
  });
  console.log(`${gaps.length} of ${units.length} units incomplete.`);
  if (!apply) return console.log("Dry run. Pass --apply to flag them.");
  for (const g of gaps) {
    await prisma.assetUnit.update({
      where: { id: g.id },
      data: { dataFlag: g.gap, dataFlaggedAt: new Date() },
    });
  }
  console.log("Flagged.");
}
main().finally(() => prisma.$disconnect());
```

Match the connection/guard idiom of the existing scripts (`scripts/link-po-units.ts`) for env loading (`tsx --env-file=.env`).
- [ ] **Step 5:** Run the dry run only: `npx tsx --env-file=.env scripts/backfill-unit-data-flags.ts`. Report the count to the owner. **Do not run `--apply` unless asked.**
- [ ] **Step 6:** `npx tsc --noEmit && npm run build`; commit.

---

## Agent B — order flag cases

### Task 7: Flag catalog (pure)

**Files:**
- Create: `src/lib/flags/catalog.ts`
- Test: `src/lib/flags/catalog.test.ts`

**Interfaces:**
- Produces:
  - `FLAG_CATEGORIES` tuple, `type FlagCategory`, `CATEGORY_LABEL`
  - `type ReasonDef = { code: string; category: FlagCategory; label: string; severity: "INFO" | "ATTENTION" | "CRITICAL"; playbook: string[]; tracksUnits: boolean; asksCarrier: boolean }`
  - `REASONS: ReasonDef[]`, `reasonByCode(code): ReasonDef | undefined`, `reasonsIn(category): ReasonDef[]`
  - `OUTCOMES`: `{ code: FlagOutcome; label: string; needsAmount: boolean; unitsEnd: "restore" | "damage" | "retire" | "keep" }[]`, `outcomeDef(code)`
  - `playbooks are plain string[]` so Task 8 can copy them into `OrderFlagStep` rows.

- [ ] **Step 1: Failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { FLAG_CATEGORIES, OUTCOMES, REASONS, reasonByCode, reasonsIn } from "./catalog";

test("reason codes are unique", () => {
  const codes = REASONS.map((r) => r.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("every category has at least one reason and every reason a valid category", () => {
  for (const c of FLAG_CATEGORIES) assert.ok(reasonsIn(c).length > 0, c);
  for (const r of REASONS) assert.ok(FLAG_CATEGORIES.includes(r.category), r.code);
});

test("the lost-in-transit playbook has the claim steps in order", () => {
  const r = reasonByCode("lost_in_transit");
  assert.ok(r);
  assert.equal(r.tracksUnits, true);
  assert.equal(r.asksCarrier, true);
  assert.deepEqual(r.playbook.slice(0, 2), [
    "Record carrier, tracking number and last scan",
    "Open a trace with the carrier",
  ]);
});

test("write-off retires units and needs no amount; claim paid needs one", () => {
  const w = OUTCOMES.find((o) => o.code === "WRITTEN_OFF");
  const c = OUTCOMES.find((o) => o.code === "CLAIM_PAID");
  assert.equal(w?.unitsEnd, "retire");
  assert.equal(w?.needsAmount, false);
  assert.equal(c?.needsAmount, true);
});
```

- [ ] **Step 2:** Run `npx tsx --test src/lib/flags/catalog.test.ts` — expected FAIL.

- [ ] **Step 3: Implement.** Categories: `returns, condition, payment, fulfillment, shipping, data, client, compliance, sales, other`. Reasons (code → label, severity), exactly the spec's list:
  - returns: `overdue_return` (Overdue return, ATTENTION), `partial_return`, `return_unresponsive`, `extension_requested` (INFO), `extension_unpaid`
  - condition: `damage_reported`, `missing_accessory`, `failed_inspection`, `wear_dispute`
  - payment: `payment_overdue`, `card_declined`, `deposit_missing`, `credit_hold` (CRITICAL), `chargeback` (CRITICAL), `tax_cert_missing`
  - fulfillment: `stock_shortage`, `substitute_needed`, `build_pending`, `backorder`, `vendor_wait`, `ship_date_risk`
  - shipping: `carrier_delay`, `lost_in_transit` (CRITICAL, `tracksUnits`, `asksCarrier`), `wrong_address`, `signature_required` (INFO), `customs_hold`
  - data: `missing_serial`, `serial_mismatch`, `unit_swapped`
  - client: `vip` (INFO), `new_client` (INFO), `high_value` (INFO), `repeat_late_payer` (ATTENTION), `special_handling` (INFO)
  - compliance: `po_mismatch`, `insurance_expired`, `id_check`, `approval_needed`
  - sales: `quote_revision` (INFO), `price_override`, `margin_floor`, `conversion_pending`, `warranty_rma`
  - other: `other` (INFO)

  Detailed playbooks (string arrays) for `lost_in_transit`, `damage_reported`, `overdue_return`, `payment_overdue`; every other reason gets a one- or two-step list (e.g. `["Confirm details", "Record how it was resolved"]`).

  `lost_in_transit` playbook, in order:
  1. `"Record carrier, tracking number and last scan"`
  2. `"Open a trace with the carrier"`
  3. `"Check declared value and insurance coverage"`
  4. `"Set the claim deadline"`
  5. `"File the claim and record the claim number"`

  `damage_reported`: record damage and photos; open a work order; decide who bears the cost; bill or absorb. `overdue_return`: contact the client; confirm a return date or extension; arrange pickup or label; escalate if no response in 3 days. `payment_overdue`: send reminder; call the client; agree a payment date; place a credit hold if missed.

  OUTCOMES: `FOUND_RETURNED` (restore, no amount), `FOUND_DAMAGED` (damage, no amount), `CLAIM_PAID` (retire, needs amount), `CLIENT_BILLED` (retire, needs amount), `WRITTEN_OFF` (retire, no amount). Export `ALL_OUTCOME_CODES`.

- [ ] **Step 4:** Run tests — expected 4 passing. **Step 5:** Commit.

---

### Task 8: Flag rules (pure)

**Files:**
- Create: `src/lib/flags/rules.ts`
- Test: `src/lib/flags/rules.test.ts`

**Interfaces:**
- Consumes: `outcomeDef`, `reasonByCode` (Task 7).
- Produces:
  - `exposureFor(units: { purchasePrice: number; landedCostAdjustment: number }[]): number`
  - `canClose(input: { outcome: FlagOutcome | null; amount: number | null; stepsOpen: number; unitsStillMissing: number }): { ok: true } | { ok: false; message: string }`
  - `isStale(flag: { nextActionDate: Date | null; resolvedAt: Date | null }, now: Date): boolean`
  - `autoRaiseDecisions(facts: OrderAutoFacts, open: { ruleKey: string }[]): { raise: RuleKey[]; clear: RuleKey[] }` where `RuleKey = "overdue_return" | "payment_overdue" | "missing_serial"` and `OrderAutoFacts = { returnDue: Date | null; unitsOut: number; invoicePastDue: boolean; unitsDataFlagged: number }`
  - `overdueDays(returnDue: Date, now: Date): number`

- [ ] **Step 1: Failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { autoRaiseDecisions, canClose, exposureFor, isStale, overdueDays } from "./rules";

test("exposure sums price and landed cost", () => {
  assert.equal(exposureFor([{ purchasePrice: 1000, landedCostAdjustment: 50 }, { purchasePrice: 500, landedCostAdjustment: -10 }]), 1540);
  assert.equal(exposureFor([]), 0);
});

test("closing needs an outcome", () => {
  assert.deepEqual(canClose({ outcome: null, amount: null, stepsOpen: 0, unitsStillMissing: 0 }), { ok: false, message: "Choose an outcome to close this case." });
});

test("claim paid needs an amount", () => {
  const r = canClose({ outcome: "CLAIM_PAID", amount: null, stepsOpen: 0, unitsStillMissing: 0 });
  assert.equal(r.ok, false);
  assert.equal(canClose({ outcome: "CLAIM_PAID", amount: 900, stepsOpen: 0, unitsStillMissing: 0 }).ok, true);
});

test("found cannot close while other units are still missing", () => {
  const r = canClose({ outcome: "FOUND_RETURNED", amount: null, stepsOpen: 0, unitsStillMissing: 2 });
  assert.equal(r.ok, false);
});

test("open playbook steps do not block closing", () => {
  assert.equal(canClose({ outcome: "WRITTEN_OFF", amount: null, stepsOpen: 3, unitsStillMissing: 0 }).ok, true);
});

test("a case is stale once its next action date passes", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  assert.equal(isStale({ nextActionDate: new Date("2026-10-22T00:00:00Z"), resolvedAt: null }, now), true);
  assert.equal(isStale({ nextActionDate: new Date("2026-10-24T00:00:00Z"), resolvedAt: null }, now), false);
  assert.equal(isStale({ nextActionDate: new Date("2026-10-22T00:00:00Z"), resolvedAt: now }, now), false);
});

test("overdue return raises when units are out past the due date, clears when back", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const late = { returnDue: new Date("2026-10-20T00:00:00Z"), unitsOut: 2, invoicePastDue: false, unitsDataFlagged: 0 };
  assert.deepEqual(autoRaiseDecisions(late, [], now), { raise: ["overdue_return"], clear: [] });
  assert.deepEqual(autoRaiseDecisions({ ...late, unitsOut: 0 }, [{ ruleKey: "overdue_return" }], now), { raise: [], clear: ["overdue_return"] });
  assert.deepEqual(autoRaiseDecisions(late, [{ ruleKey: "overdue_return" }], now), { raise: [], clear: [] });
});

test("overdueDays counts whole days", () => {
  assert.equal(overdueDays(new Date("2026-10-20T00:00:00Z"), new Date("2026-10-23T12:00:00Z")), 3);
});
```

Note `autoRaiseDecisions` takes `now` as its third parameter; update the Interfaces line accordingly when implementing: `autoRaiseDecisions(facts, open, now)`.

- [ ] **Step 2:** Run `npx tsx --test src/lib/flags/rules.test.ts` — expected FAIL.

- [ ] **Step 3: Implement**

```ts
import type { FlagOutcome } from "@/generated/prisma/client";
import { outcomeDef } from "./catalog";

export type RuleKey = "overdue_return" | "payment_overdue" | "missing_serial";

export type OrderAutoFacts = {
  returnDue: Date | null;
  unitsOut: number;
  invoicePastDue: boolean;
  unitsDataFlagged: number;
};

const DAY = 86_400_000;

export function overdueDays(returnDue: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - returnDue.getTime()) / DAY));
}

export function exposureFor(
  units: { purchasePrice: number; landedCostAdjustment: number }[],
): number {
  const sum = units.reduce((s, u) => s + u.purchasePrice + u.landedCostAdjustment, 0);
  return Math.round(sum * 100) / 100;
}

export function canClose(i: {
  outcome: FlagOutcome | null;
  amount: number | null;
  stepsOpen: number;
  unitsStillMissing: number;
}): { ok: true } | { ok: false; message: string } {
  if (!i.outcome) return { ok: false, message: "Choose an outcome to close this case." };
  const def = outcomeDef(i.outcome);
  if (def.needsAmount && (i.amount === null || i.amount <= 0)) {
    return { ok: false, message: "Enter the amount for this outcome." };
  }
  if (def.unitsEnd === "restore" && i.unitsStillMissing > 0) {
    return {
      ok: false,
      message: `${i.unitsStillMissing} unit${i.unitsStillMissing === 1 ? " is" : "s are"} still missing. Keep the case open for them.`,
    };
  }
  return { ok: true };
}

export function isStale(
  f: { nextActionDate: Date | null; resolvedAt: Date | null },
  now: Date,
): boolean {
  return f.resolvedAt === null && f.nextActionDate !== null && f.nextActionDate.getTime() < now.getTime();
}

/** Which system flags should be raised or cleared, given the order's facts and its open system flags. */
export function autoRaiseDecisions(
  facts: OrderAutoFacts,
  open: { ruleKey: string }[],
  now: Date,
): { raise: RuleKey[]; clear: RuleKey[] } {
  const holds: Record<RuleKey, boolean> = {
    overdue_return: facts.returnDue !== null && facts.unitsOut > 0 && facts.returnDue.getTime() < now.getTime(),
    payment_overdue: facts.invoicePastDue,
    missing_serial: facts.unitsDataFlagged > 0,
  };
  const have = new Set(open.map((o) => o.ruleKey));
  const raise: RuleKey[] = [];
  const clear: RuleKey[] = [];
  for (const key of Object.keys(holds) as RuleKey[]) {
    if (holds[key] && !have.has(key)) raise.push(key);
    if (!holds[key] && have.has(key)) clear.push(key);
  }
  return { raise, clear };
}
```

- [ ] **Step 4:** Run tests — expected all pass. **Step 5:** Commit.

---

### Task 9: Flag actions

**Files:**
- Create: `src/lib/actions/order-flags.ts`

**Interfaces:**
- Consumes: `reasonByCode`, `outcomeDef` (Task 7); `exposureFor`, `canClose`, `autoRaiseDecisions` (Task 8).
- Produces (all return `{ ok: true; … } | { ok: false; message: string }`):
  - `raiseFlag(input: { reservationId; reason: string; note?: string; severity?: FlagSeverity; ownerId?: string; nextActionDate?: string; carrier?: string; trackingNumber?: string; unitIds?: string[] }): Promise<…{ flagId }>`
  - `toggleFlagStep(stepId: string, done: boolean, note?: string)`
  - `updateFlagTracking(flagId: string, patch: { carrier?; trackingNumber?; claimNumber?; nextActionDate?: string | null; ownerId?: string | null })`
  - `closeFlag(input: { flagId; outcome: FlagOutcome; amount?: number; note?: string; unitIds?: string[] })`
  - `reinstateUnit(unitId: string, reason: string)`
  - `syncAutoFlags(reservationId: string)` (system rules, Task 12)
  - `foundUnitOnCase(input: { unitId; flagId; choice: "returned" | "damaged" | "not-this-case" | "leave-open"; note?: string })` (used by Task 10's prompt)

- [ ] **Step 1: `raiseFlag`.** Validate `reasonByCode`; create the `OrderFlag` with `severity = input.severity ?? reason.severity`; copy `reason.playbook` into `OrderFlagStep` rows (`position` = index); if `reason.tracksUnits` and `unitIds` given: compute exposure from `purchasePrice`/`landedCostAdjustment` of those units via `exposureFor`, create `OrderFlagUnit` rows with each unit's current `priorStatus`, and set those units `status: "MISSING"`; do all in one `prisma.$transaction`. `logAudit({ action: "CREATE", entityType: "Reservation", entityId: reservationId, newValues: { flag: reason.code } })`.
- [ ] **Step 2: `toggleFlagStep`** sets/clears `doneAt`/`doneById`/`note`.
- [ ] **Step 3: `closeFlag`.** Load flag with `units`, `steps`. Count `unitsStillMissing` as flag units with `foundAt = null` that are **not** in `input.unitIds` (the units this closing resolves). Call `canClose`; refuse with its message. In a transaction, by `outcomeDef(outcome).unitsEnd` for each resolved unit:
  - `restore`: `status = priorStatus`, `foundAt = now`
  - `damage`: `status = "MAINTENANCE"`, `foundAt = now`
  - `retire`: `status = "RETIRED"`, `retirementReason = "LOST"`, `retiredAt = now`, `retiredTo = null`
  Then set `resolvedAt`, `resolvedById`, `outcome`, `outcomeAmount`, `resolutionNote`. Audit `UPDATE` on `Reservation` with the outcome. For `WRITTEN_OFF`/`CLAIM_PAID` also audit each unit (`entityType: "Asset"`).
- [ ] **Step 4: `reinstateUnit`.** Require a non-empty `reason` (≥ 5 chars). Find the unit's latest `OrderFlagUnit` whose unit is `RETIRED` with `retirementReason = LOST`. Set unit `status = priorStatus`, `retirementReason = null`, `retiredAt = null`, clear `foundAt`→ set `foundAt = now`; append to the flag's `resolutionNote` `"Reinstated {date}: {reason}"`; audit `OVERRIDE` on `Asset`. If `outcome === "CLAIM_PAID"`, include in the returned object `refundWarning: { claimNumber, amount }` so the UI can show it (the warning is also shown *before* confirming — see Task 10).
- [ ] **Step 5: `foundUnitOnCase`.**
  - `returned`: mark that `OrderFlagUnit` found, restore status; if no units remain missing, call `closeFlag` logic with `FOUND_RETURNED`; otherwise leave the case open and append to the timeline note.
  - `damaged`: as `closeFlag` with `damage` semantics for that unit and open a work order via the existing `openWorkOrder({ assetUnitId, fault, openedFromReservationId })` from `@/lib/actions/service`.
  - `not-this-case`: no writes.
  - `leave-open`: append `note` to the flag's `note` with timestamp.
  Every branch appends a timeline line (`"{date}: unit {barcode} scanned at {where} by {user}"`) to `resolutionNote`-independent field — add `timeline String?` to `OrderFlag`? **No new column**: store the timeline as audit entries (`logAudit` on `Reservation`, `newValues: { flagId, event }`) and read them back with `getEntityAuditLog("Reservation", reservationId)`.
- [ ] **Step 6:** `npx tsc --noEmit`; fix. **Step 7:** Add action-level tests only for pure parts (done in Task 8); verify actions by hand in Task 13. **Step 8:** Commit.

---

### Task 10: Scan-time case prompt (extends Agent A's gate)

**Precondition:** Agent A's Task 5 is merged.

**Files:**
- Modify: `src/lib/scan/unit-gate-rules.ts`, `src/lib/scan/unit-gate.ts`, `src/components/scan/unit-gate-prompt.tsx`
- Test: `src/lib/scan/unit-gate.test.ts`

**Interfaces:**
- Consumes: `foundUnitOnCase`, `reinstateUnit` (Task 9).
- Produces: `GateResult` gains `{ kind: "on-case"; unitId; barcode; assetName; flagId; reservationNumber; reasonLabel; unitState: "open-case" | "written-off"; claim: { claimNumber: string; amount: number } | null }`. `GateFacts` gains `openCase: { flagId; reservationNumber; reasonCode; outcome: FlagOutcome | null; claimNumber: string | null; outcomeAmount: number | null } | null` and `retiredLost: boolean`.

- [ ] **Step 1: Failing test** (add to `unit-gate.test.ts`):

```ts
test("a unit on an open case prompts before anything else, even if data is complete", () => {
  const r = decideGate({
    ...base,
    openCase: { flagId: "f1", reservationNumber: "R-100", reasonCode: "lost_in_transit", outcome: null, claimNumber: null, outcomeAmount: null },
    retiredLost: false,
  });
  assert.equal(r.kind, "on-case");
});

test("a written-off unit prompts with the claim attached when one was paid", () => {
  const r = decideGate({
    ...base,
    openCase: { flagId: "f1", reservationNumber: "R-100", reasonCode: "lost_in_transit", outcome: "CLAIM_PAID", claimNumber: "UPS-9", outcomeAmount: 1200 },
    retiredLost: true,
  });
  assert.equal(r.kind, "on-case");
  if (r.kind === "on-case") {
    assert.equal(r.unitState, "written-off");
    assert.deepEqual(r.claim, { claimNumber: "UPS-9", amount: 1200 });
  }
});
```

Existing tests in that file need `openCase: null, retiredLost: false` added to `base`.

- [ ] **Step 2:** Run — expected FAIL. **Step 3:** In `decideGate`, make the on-case check the first branch (a unit that is missing or written off must be dealt with before its serial). Use `reasonByCode(openCase.reasonCode)?.label ?? openCase.reasonCode` for `reasonLabel`; `claim` is non-null only when `openCase.outcome === "CLAIM_PAID"` and a claim number and amount are present.
- [ ] **Step 4:** In `gateUnit`, load the latest `OrderFlagUnit` for the unit where the flag is unresolved **or** the unit is `RETIRED` with `retirementReason = LOST`, joining `flag { id, reason, outcome, claimNumber, outcomeAmount, reservation { reservationNumber } }`.
- [ ] **Step 5:** In `UnitGatePrompt`, render `on-case` as: "This unit is on a case — {reasonLabel}, order {reservationNumber}." Buttons for an open case: **Found — close and return to inventory** (`foundUnitOnCase(returned)`), **Found but damaged** (`damaged`), **Not part of this case** (`not-this-case`, then `onResolved()`), **Leave open** with a note field (`leave-open`). For `written-off`: the same plus **Reinstate** (asks for a reason, then `reinstateUnit`); if `claim` is non-null show first: "Claim {claimNumber} paid ${amount}. A refund to the carrier may be due." and require a second click to confirm.
- [ ] **Step 6:** Run `npx tsx --test src/lib/scan/unit-gate.test.ts` — all pass; `npx tsc --noEmit`; commit.

---

### Task 11: Orders page filters and flag badge

**Files:**
- Create: `src/lib/flags/filter.ts` (Prisma-free: `FLAG_FILTERS`, `FlagFilter`, `isFlagFilter`, labels), `src/lib/queries/order-flags.ts`
- Modify: `src/lib/queries/reservations.ts` (`listWhere`, `getReservationList`, `getViewCounts`), `src/app/(shell)/dashboard/orders/page.tsx`, `src/components/orders/order-table.tsx`

**Interfaces:**
- Produces:
  - `FLAG_FILTERS = ["all", "flagged", "unflagged", "critical", "mine", "stale"] as const`, `type FlagFilter`, `isFlagFilter = oneOf(FLAG_FILTERS)`, `FLAG_FILTER_LABEL`
  - `flagWhere(filter: FlagFilter, userId: string | null, now: Date): Prisma.ReservationWhereInput`
  - list rows gain `openFlags: number` and `topSeverity: FlagSeverity | null`

- [ ] **Step 1:** Write `flag/filter.ts` mirroring `orders/types.ts` (use `oneOf` from `@/lib/guards`).
- [ ] **Step 2: Test `flagWhere`'s pure shape** — put `flagWhere` in `src/lib/flags/filter.ts` only if it avoids a Prisma runtime import (`import type` for the where type is fine). Test in `src/lib/flags/filter.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { flagWhere } from "./filter";

const now = new Date("2026-10-23T12:00:00Z");

test("all adds no condition", () => assert.deepEqual(flagWhere("all", "u1", now), {}));
test("flagged requires an open flag", () =>
  assert.deepEqual(flagWhere("flagged", "u1", now), { flags: { some: { resolvedAt: null } } }));
test("unflagged requires none", () =>
  assert.deepEqual(flagWhere("unflagged", "u1", now), { flags: { none: { resolvedAt: null } } }));
test("mine means an open flag I own", () =>
  assert.deepEqual(flagWhere("mine", "u1", now), { flags: { some: { resolvedAt: null, ownerId: "u1" } } }));
test("stale means an open flag past its next action date", () =>
  assert.deepEqual(flagWhere("stale", "u1", now), {
    flags: { some: { resolvedAt: null, nextActionDate: { lt: now } } },
  }));
test("critical means an open critical flag", () =>
  assert.deepEqual(flagWhere("critical", "u1", now), {
    flags: { some: { resolvedAt: null, severity: "CRITICAL" } },
  }));
```

Run — expected FAIL; implement `flagWhere` as a `switch` returning exactly those objects; run — pass.
- [ ] **Step 3:** In `reservations.ts`, thread a `flag: FlagFilter = "all"` and `userId` through `listWhere`, `getViewCounts` and `getReservationList`, composing with `AND: [existing, flagWhere(...)]`. Add `flags: { where: { resolvedAt: null }, select: { severity: true } }` to the list `select` and compute `openFlags` and `topSeverity` (CRITICAL > ATTENTION > INFO).
- [ ] **Step 4:** `orders/page.tsx`: add `flag?: string` to `searchParams`, parse with `isFlagFilter`, add a third `FilterTabs param="flag" label="Flags"` after the type tabs, include `flag` in the Suspense `key`, and pass it to `ViewTabs` and `OrderTable`. Get `userId` via the existing `auth()` helper (`@/lib/auth-utils`) in the page.
- [ ] **Step 5:** `order-table.tsx`: a flag icon cell with the count, tinted by `topSeverity` using existing status tone tokens (match how `isLate` is shown); link to the order.
- [ ] **Step 6:** `npx tsc --noEmit && npm test && npm run build`. Verify in the browser that `?flag=flagged` filters and composes with `?view=` and `?type=`. Commit.

---

### Task 12: Flag dialog, case panel, auto-raise

**Files:**
- Create: `src/components/orders/flag-dialog.tsx`, `src/components/orders/flag-panel.tsx`, `src/lib/queries/order-flag-facts.ts`
- Modify: `src/app/(shell)/dashboard/orders/[id]/page.tsx` (render the panel), `src/components/orders/order-action-bar.tsx` (add **Flag** button), `src/lib/actions/order-flags.ts` (`syncAutoFlags`)

**Interfaces:**
- Consumes: `raiseFlag`, `toggleFlagStep`, `updateFlagTracking`, `closeFlag` (Task 9); `REASONS`, `reasonsIn`, `CATEGORY_LABEL`, `OUTCOMES` (Task 7); `autoRaiseDecisions` (Task 8).
- Produces: `loadOrderAutoFacts(reservationId): Promise<OrderAutoFacts>`; `syncAutoFlags(reservationId)`.

- [ ] **Step 1: Raise dialog.** Category select → reason select (from `reasonsIn`), severity (defaults to reason's), owner (users list, as the order's existing assignee picker does), next-action date, note. When `reason.asksCarrier` show carrier and tracking number; when `reason.tracksUnits` show a checklist of the order's units currently out. Submit calls `raiseFlag`.
- [ ] **Step 2: Case panel.** Per open flag: reason + severity chip, exposure, owner, next action date (red when `isStale`), the playbook as a checklist (`toggleFlagStep`), carrier/tracking/claim fields (`updateFlagTracking`), affected units, and a **Close case** control: outcome select (`OUTCOMES`), amount when `needsAmount`, note, which units this resolves; shows `canClose`'s message inline. Closed flags appear below, collapsed, with outcome and who/when.
- [ ] **Step 3: `loadOrderAutoFacts`** — `returnDue = reservation.endDate` (rentals and Flow only; `null` otherwise), `unitsOut` = count of `ReservationItemUnit` with `checkedOutAt != null && checkedInAt = null`, `invoicePastDue` = any unpaid `Invoice` of this order with `dueDate < now` (read `prisma/schema.prisma` `model Invoice` for the exact status/due field names first), `unitsDataFlagged` = count of order units whose `assetUnit.dataFlag != null`.
- [ ] **Step 4: `syncAutoFlags`** — load facts and the open `SYSTEM` flags' `ruleKey`s, call `autoRaiseDecisions`, create SYSTEM flags for `raise` (reason code = rule key, `ruleKey` set, playbook copied as in `raiseFlag`) and set `resolvedAt = now`, `resolutionNote = "Cleared automatically: no longer true."` for `clear` (no `outcome`, SYSTEM flags are exempt from `canClose`). Call it from: the order page load for that order, `checkinByBarcode` completion, and a nightly pass.
- [ ] **Step 5: Nightly pass.** Add `scripts/sync-auto-flags.ts` that loops open rental/Flow orders and calls the same function, and install it in the existing v2 cron beside the 03:45 backup (see `vfxnow-v2-persistence-check-queued` memory for how the crontab is managed). Ask the owner before editing the crontab.
- [ ] **Step 6:** `npx tsc --noEmit && npm run build`; commit.

---

### Task 13: Ship gate, dashboard tile, end-to-end check

**Files:**
- Modify: `src/lib/orders/handover.ts`, `src/lib/orders/handover-rules.ts`, `src/lib/orders/handover.test.ts`, `src/lib/actions/order-stage.ts` (ship path), the Dashboard tile list (find with `grep -rn "Booked\|tile" src/app/\(shell\)/dashboard/page.tsx | head`)
- Create: `src/lib/queries/order-flag-tile.ts`

**Interfaces:**
- Consumes: `OrderFlag` (Task 1); gate pattern from `handover-rules.ts`.
- Produces: `criticalFlagBlock(openCritical: number): string | null` in `handover-rules.ts`; `getFlagTile(): Promise<{ open: number; critical: number; attention: number; info: number; exposure: number; stale: number }>`.

- [ ] **Step 1: Failing test** in `handover.test.ts`:

```ts
import { criticalFlagBlock } from "./handover-rules";

test("an open critical flag blocks shipping with a reason", () => {
  assert.match(criticalFlagBlock(1) ?? "", /critical flag/i);
  assert.equal(criticalFlagBlock(0), null);
});
```

Run — FAIL. Implement: `export function criticalFlagBlock(n: number): string | null { return n > 0 ? \`${n} critical flag${n === 1 ? "" : "s"} open on this order. Resolve or override before shipping.\` : null; }`. Run — pass.
- [ ] **Step 2:** In the ship path (`markShipped` in `order-stage.ts`), count open CRITICAL flags and refuse unless the caller passes an override. Reuse the existing super-admin override pattern in `lib/orders/scan-override.ts` (`verifySuperAdmin`, `grantScanOverride`) rather than a new mechanism; log the override with `logAudit({ action: "OVERRIDE", entityType: "Reservation", … })`. Surface the refusal in the existing ship dialog the same way the handover shortfall is shown.
- [ ] **Step 3:** `getFlagTile()` — one `groupBy` on open flags by severity plus `sum(exposureAmount)` and a stale count (`nextActionDate < now`). Add a Dashboard tile "Flagged" (count, critical count, exposure) linking to `/dashboard/orders?flag=flagged`. Follow an existing tile's markup, accent, and Suspense usage.
- [ ] **Step 4: End-to-end check on a throwaway order** (never a real client's): raise a `lost_in_transit` flag on two units → both show `MISSING` and cannot be booked; try to ship → blocked; scan one unit back → the case prompt appears; choose **Found — close and return** → unit restored, case stays open for the other; close the case as `WRITTEN_OFF` → other unit `RETIRED`/`LOST`; scan it again → prompt offers **Reinstate**; reinstate with a reason → unit restored, audit row present. Record each result.
- [ ] **Step 5:** `npx tsc --noEmit && npm test && npm run build`. Run `smoke-routes.ts` (see memory `vfxnow-v2-verifying-screens`). Commit.

---

## Self-review against the spec

- Track A rule, fields, module, scan points (receive, out/ship, in, audit, desk), prompt/skip, skip logged, mismatch check, flagged-unit blocking, Missing data screen, backfill, tests: Tasks 1–6. The scan desk (`findOpenReturnsForCode`) gets the gate in Task 5 step 7 under "scan-desk.ts".
- Track B data, cases (exposure, playbooks, outcome required, units follow case, follow-up clock), scan-triggered resolution incl. reinstate and claim-paid warning: Tasks 7–10. Reasons, auto-raise rules, Orders page chips, Dashboard tile, ship gate with logged override: Tasks 7, 8, 11–13.
- **Deviations from the spec, to confirm with the owner:** (1) playbooks live in code (`catalog.ts`) and are copied into per-case step rows, not stored as editable data; an edit screen is deferred. (2) "Open/Resolved" filter chip is not built: the Orders filter covers `flagged`, `unflagged`, `critical`, `mine`, `stale`; resolved history is on the order's case panel. (3) The case timeline is read from audit rows, not its own table. (4) Category-level filtering on the Orders page is not in Task 11; add it after the owner has used the first version.
- Open question to settle before Task 4 step 4: which catalog items are exempt from serials.
