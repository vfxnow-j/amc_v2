# Flow order type (with leases wired in) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate v1's Flow order type in v2. Flow is a fixed-term subscription on gear we already own, priced off landed cost, and the gear always comes back. It includes the client quote and the subscription terms. **In addition, leases are wired in:** hardware still being paid off shows its lease balance, payment and interest, and the deal's economics are placed against that.

**Architecture:**
- **Engine:** v1's pure pricing modules come across nearly verbatim, with their tests.
- **v2 additions, each tested separately:** the engine takes a *list* of loans instead of one, and a pure `lease-funding.ts` works out each held unit's share of its lease from the lease's remaining payments.
- **Where Flow lives:** it's a type in v2's one Orders screen (like RTO). It gets its own cards on the order record, a branch in the quote portal, and a Settings → Documents section for its terms.

**Tech Stack:** Next.js (read `node_modules/next/dist/docs/` before any routing or server-action work; see AGENTS.md), Prisma 7, @react-pdf/renderer, `node:test` via `npx tsx --test`.

**Sources:** v1 is read-only at `/home/docker/projects/vfxnow-amc`. The specs are in its `docs/superpowers/specs/`:
- `2026-09-22-flow-order-type-design.md`
- `2026-09-23-flow-client-quote-design.md`
- `2026-09-25-flow-subscription-terms-design.md`

v1's step-by-step plans are in its `docs/superpowers/plans/`:
- `2026-09-22-flow-pricing-engine.md`
- `2026-09-22-flow-order-type.md`
- `2026-09-25-flow-subscription-terms.md`

When a task below says "port", read the named v1 file and the matching v1 plan section. Then write the v2 version following v2's patterns. Never edit v1.

## Global Constraints

- v1 is read-only: read it, never write it, never read its `.env`, never write its database.
- **Schema changes are v2's own additive migration** (`prisma/manual/2026-09-26-flow-order-type.sql`), applied before any data pull. The pull never changes schema (owner, 2026-09-26). Column names and types **match v1 exactly**, so the sync maps them by name.
- **Owner decisions (2026-09-26):**
  - Flow lives **in Orders, as a type**.
  - **Leases are wired in.** The remaining balance is the present value of the payments still to come (monthly payment, rate, start date and term only; never `totalAmount`, whose meaning differs between leases). The balance is split by unit cost across **units still held**.
  - Leases with no terms are flagged "lease terms missing" and priced on labelled, overridable assumptions.
  - Per-line and deal breakdowns are **internal only**.
  - v2's Flow economics therefore differ from v1's by design.
- Lease data changes the **economics only**. The client's contract price comes from basis → purchase tax → finance % → margin and never reads funding, so updating a lease never changes a quote the client has seen.
- Client-facing surfaces carry **no** cost, basis, trueCost, margin, finance, profit, lease or residual keys (v1 rule 11). This is pinned by a recursive key test.
- Flow is excluded from the billing run, auto-invoice, manual invoicing, proposals, "convert to sale", and switching type into or out of Flow (v1 7a8943f, 01a81f5, 7bb38b1).
- Order numbers: `FLW-{YYYY}-{SEQ}`, matching v1 (`FLW-2026-00001..3` exist there).
- Tests: `node:test`, `npx tsx --test`. Task 2 adds an `npm test` script.
- Commits: prose messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; stage explicit paths under `flock /tmp/vfxnow-v2-git.lock`; serialise builds with `flock /tmp/vfxnow-v2-build.lock`.
- After `prisma generate`, **restart the dev server** on :3001. The client is pinned to `globalThis`, so new columns don't load into a running server.

---

### Task 1: Schema — FLOW, the Flow columns, line trueCost

**Files:**
- Create: `prisma/manual/2026-09-26-flow-order-type.sql`
- Modify: `prisma/schema.prisma` (enum `ReservationType` ~:907, model `Reservation`, model `ReservationItem`)

- [ ] **Step 1: Write the SQL** (idempotent and additive; mirrors v1 `7853232` and `4ae4ea2`):

```sql
-- Flow order type, ported from v1 (2026-09-22..25). Additive only; mirrors v1's
-- column names and types exactly so scripts/sync-from-v1.ts maps them by name.
-- Owner, 2026-09-26: schema changes are v2's own step, never part of a data pull.
ALTER TYPE "ReservationType" ADD VALUE IF NOT EXISTS 'FLOW';

ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "flowTermMonths"          INTEGER,
  ADD COLUMN IF NOT EXISTS "flowMonthlyPayment"      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "flowContractValue"       DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "flowStartDate"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "flowPeriodsBilled"       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "flowStepPct"             DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowMarginPct"           DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowFinancePct"          DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowPurchaseTaxPct"      DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowTaxExempt"           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "flowRecoverByMonth"      INTEGER,
  ADD COLUMN IF NOT EXISTS "flowDeprPct"             DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowLifeMonths"          INTEGER,
  ADD COLUMN IF NOT EXISTS "flowAssumedAprPct"       DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowAssumedLoanBalance"  DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "flowAssumedNoteMonths"   INTEGER,
  ADD COLUMN IF NOT EXISTS "flowExtensionPct"        DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowTermsSnapshot"       JSONB,
  ADD COLUMN IF NOT EXISTS "flowTermsVersion"        INTEGER,
  ADD COLUMN IF NOT EXISTS "flowAutopayMethod"       TEXT,
  ADD COLUMN IF NOT EXISTS "flowAutopayAuthorizedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "flowAutopayAuthorizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "flowAutopaySetupAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "flowAutopaySetupById"    TEXT;

ALTER TABLE "reservation_items"
  ADD COLUMN IF NOT EXISTS "trueCost"         DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "flowAddedAtMonth" INTEGER;
```

`billsFromSchedule` is deliberately **not** added: v2 derives it (see the monthly-payment plan). Before running, check the table names with `grep -n '@@map("reservations")\|@@map("reservation_items")' prisma/schema.prisma`.

- [ ] **Step 2: Mirror the schema in Prisma** — add `FLOW // Term hardware subscription — owned gear, returns at term end` to `enum ReservationType`. Copy v1's field block (v1 `prisma/schema.prisma:846-879`, with its comments) into `model Reservation`, and v1 `:965` and `:969` into `model ReservationItem`. Don't add `billsFromSchedule`.

- [ ] **Step 3: Apply and check** — `docker exec -i vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -v ON_ERROR_STOP=1 < prisma/manual/2026-09-26-flow-order-type.sql`, then `npx prisma validate` and `npx prisma db pull --print 2>/dev/null | grep -c flow`. The last command is read-only and confirms the database and schema agree. **Never** run `prisma db push`. Then run `npx prisma generate` and restart the dev server.

- [ ] **Step 4: Commit**: "feat(flow): the FLOW order type and its columns, mirroring v1".

---

### Task 2: Port the pure Flow engine and its 86 tests

**Files:**
- Create (copy from v1 `src/lib/pricing/`): `flow.ts`, `flow-order.ts`, `flow-lines.ts`, `flow-basis.ts`, `flow-client-quote.ts`, `flow-quote-view.ts`, `flow-terms.ts`, and the tests `flow.test.ts`, `flow-order.test.ts`, `flow-lines.test.ts`, `flow-basis.test.ts`, `flow-terms.test.ts` → the same names under v2 `src/lib/pricing/`.
- Modify: `package.json` (add a `test` script)

- [ ] **Step 1: Copy** — `for f in flow flow-order flow-lines flow-basis flow-client-quote flow-quote-view flow-terms; do cp /home/docker/projects/vfxnow-amc/src/lib/pricing/$f.ts src/lib/pricing/; done` and the same for the five `.test.ts` files. (Reading v1 and writing v2 is allowed; check the destination is v2 before running.)

- [ ] **Step 2: Fix imports** — `grep -n "^import" src/lib/pricing/flow*.ts`. Each import must resolve in v2. `flow-quote-view.ts` uses `@/lib/pricing/...`, which works in v2. Anything importing a v1-only helper gets reported and fixed, not stubbed.

- [ ] **Step 3: Add the test script** to `package.json`:

```json
    "test": "tsx --test src/lib/pricing/*.test.ts src/lib/billing/*.test.ts src/lib/utils/*.test.ts src/lib/coverage/*.test.ts src/lib/quotes/*.test.ts src/lib/checkout/*.test.ts"
```

(The shell expands the globs. A directory with no tests yet makes `tsx` fail on the unmatched pattern, so leave out any directory that doesn't exist yet and add it when its first test lands.)

- [ ] **Step 4: Run** — `npx tsx --test src/lib/pricing/flow*.test.ts`
Expected: `# pass 86`, `# fail 0`. Any failure means the copy is wrong; don't change a test to make it pass.

- [ ] **Step 5: Commit**: "feat(flow): port v1's Flow pricing engine and its 86 tests unchanged".

---

### Task 3: The engine carries a list of loans

v1's `quote()` knows one note per order. A Flow order in v2 can hold gear from several leases (FCB REFI 2024, a First Citizens lease) plus owned stock. So v2 extends `FlowProcurement` with an optional `loans` list and sums across it. A single loan still goes down the same path, which keeps the 86 ported tests valid.

**Files:**
- Modify: `src/lib/pricing/flow.ts` (`FlowProcurement`, `ResolvedFunding`, `resolveFunding`, `quote()`)
- Modify: `src/lib/pricing/flow-order.ts` (`FlowOrderConfig.funding` → a list)
- Test: `src/lib/pricing/flow-loans.test.ts`

**Interfaces:**
- Produces:
  - `type FlowLoan = { balance: number; aprPct: number; monthsLeft: number; label?: string }`
  - `FlowProcurement.loans?: FlowLoan[]` (when present and non-empty, it replaces `loan`)
  - `ResolvedFunding.loans: { balance: number; aprPct: number; noteMonths: number; label?: string }[]`
  - `FlowOrderConfig.funding?: FlowLoan[] | { aprPct: number; balance: number; monthsLeft: number } | null` (the old single-object shape is still accepted, so v1's tests keep compiling)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pricing/flow-loans.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quote, payment, interestOver, balanceAfter } from './flow'

const items = [{ name: 'Lenovo P620', unitCost: 10000, qty: 1 }, { name: 'RTX A6000', unitCost: 5000, qty: 1 }]
const base = { items, termMonths: 24 }
const A = { balance: 6000, aprPct: 7, monthsLeft: 30 }
const B = { balance: 2000, aprPct: 5.65, monthsLeft: 10 }

test('one loan in the list prices exactly like the single-loan form', () => {
  const single = quote({ ...base, procurement: { mode: 'stock_financed', loan: A } })
  const listed = quote({ ...base, procurement: { mode: 'stock_financed', loans: [A] } })
  assert.deepEqual(listed.economics, single.economics)
  assert.deepEqual(listed.cash, single.cash)
  assert.deepEqual(listed.tail, single.tail)
})

test('two loans: note payment, interest and what is left all add up per loan', () => {
  const q = quote({ ...base, procurement: { mode: 'stock_financed', loans: [A, B] } })
  const pA = payment(A.balance, A.aprPct, A.monthsLeft)
  const pB = payment(B.balance, B.aprPct, B.monthsLeft)
  assert.equal(q.cash.notePayment, Math.round((pA + pB) * 100) / 100)
  const interest = interestOver(A.balance, A.aprPct, A.monthsLeft, 24) + interestOver(B.balance, B.aprPct, B.monthsLeft, 24)
  assert.equal(q.economics.financeActual, Math.round(interest * 100) / 100)
  const left = balanceAfter(A.balance, A.aprPct, A.monthsLeft, 24) + balanceAfter(B.balance, B.aprPct, B.monthsLeft, 24)
  assert.equal(q.tail.balanceAtTermEnd, Math.round(left * 100) / 100)
})

test('a loan stops costing cash after its last payment', () => {
  const q = quote({ ...base, procurement: { mode: 'stock_financed', loans: [A, B] } })
  const pA = payment(A.balance, A.aprPct, A.monthsLeft)
  const pB = payment(B.balance, B.aprPct, B.monthsLeft)
  const rate = (i: number) => q.schedule.rates[i]
  assert.equal(q.cash.netByMonth[0], Math.round((rate(0) - pA - pB) * 100) / 100)
  assert.equal(q.cash.netByMonth[15], Math.round((rate(15) - pA) * 100) / 100) // B paid off after month 10
})

test('the client price never depends on funding', () => {
  const owned = quote({ ...base, procurement: { mode: 'stock_owned' } })
  const leased = quote({ ...base, procurement: { mode: 'stock_financed', loans: [A, B] } })
  assert.deepEqual(leased.schedule.rates, owned.schedule.rates)
  assert.equal(leased.client.totalPayable, owned.client.totalPayable)
})

test('an empty loan list is owned stock', () => {
  const owned = quote({ ...base, procurement: { mode: 'stock_owned' } })
  const empty = quote({ ...base, procurement: { mode: 'stock_financed', loans: [] } })
  assert.equal(empty.economics.financeActual, owned.economics.financeActual)
})
```

Check the `FlowItem` field names in `flow.ts` (`unitCost`, `qty`, `name`, …) before running, and adjust the test's `items` to match the type exactly.

- [ ] **Step 2: Run it to see it fail** — `npx tsx --test src/lib/pricing/flow-loans.test.ts` → type or assertion failures (`loans` is unknown).

- [ ] **Step 3: Implement.** Make these edits in `flow.ts`:

```ts
export type FlowLoan = { balance: number; aprPct: number; monthsLeft: number; label?: string }

export type FlowProcurement = {
  mode: 'new' | 'stock_owned' | 'stock_financed'
  monthsInService: number
  /** The note already against it, when mode is stock_financed. */
  loan: { balance: number; aprPct: number; monthsLeft: number }
  /**
   * v2: several notes at once — gear on an order can sit on different leases.
   * When present and non-empty it replaces `loan`; each is costed on its own
   * terms and the results summed. One entry prices exactly like `loan`.
   */
  loans?: FlowLoan[]
}

export type ResolvedFunding = {
  funding: FlowFunding
  procurement: FlowProcurement
  financed: number
  aprPct: number
  noteMonths: number
  fees: number
  /** Every note costed separately; `financed/aprPct/noteMonths` summarise them. */
  loans: { balance: number; aprPct: number; noteMonths: number; label?: string }[]
}
```

In `resolveFunding`, replace the `if (P.mode === 'stock_financed') { … }` branch with:

```ts
  let loans: ResolvedFunding['loans'] = []
  if (P.mode === 'stock_financed') {
    const source = P.loans && P.loans.length ? P.loans : [P.loan]
    loans = source
      .map((l) => ({ balance: num(l.balance), aprPct: num(l.aprPct), noteMonths: Math.round(num(l.monthsLeft)), label: (l as FlowLoan).label }))
      .filter((l) => l.balance > 0)
    financed = loans.reduce((s, l) => s + l.balance, 0)
    aprPct = financed > 0 ? loans.reduce((s, l) => s + l.aprPct * l.balance, 0) / financed : 0
    noteMonths = loans.reduce((m, l) => Math.max(m, l.noteMonths), 0)
  } else if (P.mode === 'new' && F.mode !== 'cash') {
```

Keep the `new` branch as it is, but at its end also set `loans = financed > 0 ? [{ balance: financed, aprPct, noteMonths }] : []`. Return `loans` in the result object.

In `quote()`, replace the three lines computing `notePmt`, `interest` and `loanLeft` with sums over `f.loans`:

```ts
  const pmts = f.loans.map((l) => payment(l.balance, l.aprPct, l.noteMonths))
  const notePmt = pmts.reduce((s, p) => s + p, 0)
  const interest = f.loans.reduce((s, l) => s + interestOver(l.balance, l.aprPct, l.noteMonths, T), 0)
  const loanLeft = f.loans.reduce((s, l) => s + balanceAfter(l.balance, l.aprPct, l.noteMonths, T), 0)
```

Replace the `cashEnd` and `monthlyNet` lines:

```ts
  const paidInTerm = f.loans.reduce((s, l, i) => s + pmts[i] * Math.min(l.noteMonths, T), 0)
  const cashEnd = -cashOutAtSigning - f.fees + chain.contract - paidInTerm
  const monthlyNet = sched.rates.map((r, m) => r - f.loans.reduce((s, l, i) => s + (m < l.noteMonths ? pmts[i] : 0), 0))
```

Replace the tail's `monthsPastTerm` and `paymentsLeft`:

```ts
  const monthsPastTerm = f.loans.reduce((m, l) => Math.max(m, l.noteMonths - T), 0)
  const paymentsLeft = f.loans.reduce((s, l, i) => s + pmts[i] * Math.max(0, l.noteMonths - T), 0)
```

`coveredNote` keeps using the summary `f.financed` / `f.aprPct`, which is exact for one loan and an approximation for several. Say so in its comment.

In `flow-order.ts`, change the `funding` field and the `quote({...})` call:

```ts
  /** Notes against the order's gear (v2: one per lease). The single-object form is v1's. */
  funding?: FlowLoan[] | { aprPct: number; balance: number; monthsLeft: number } | null
```

```ts
  const loans = Array.isArray(config.funding) ? config.funding : config.funding ? [config.funding] : []
  const q = quote({
    items,
    termMonths: config.termMonths,
    config: engineConfig,
    funding: { mode: loans.length ? 'loan' : 'cash' },
    procurement: loans.length
      ? { mode: 'stock_financed', monthsInService: num(config.monthsInService), loan: loans[0], loans }
      : { mode: 'stock_owned', monthsInService: num(config.monthsInService) },
  })
```

- [ ] **Step 4: Run all Flow tests** — `npx tsx --test src/lib/pricing/flow*.test.ts` → the 86 ported tests plus 5 new, `# fail 0`.

- [ ] **Step 5: Commit**: "feat(flow): cost each lease behind an order separately". Prose: why one note per order isn't enough in v2; a single loan prices identically; the client price never reads funding.

---

### Task 4: `lease-funding.ts` — what each held unit still owes

**Files:**
- Create: `src/lib/pricing/lease-funding.ts`
- Test: `src/lib/pricing/lease-funding.test.ts`

**Interfaces:**
- Produces:
  - `type LeaseTerms = { id: string; label: string; status: string; monthlyPayment: number; aprPct: number; startDate: Date; termMonths: number }` (`aprPct` in percent: `Lease.interestRate` is a fraction, ×100)
  - `type Assumption = { aprPct: number; noteMonths: number }`
  - `type LeaseBalance = { balance: number; payment: number; monthsLeft: number; aprPct: number; assumed: boolean }`
  - `leaseBalance(l: LeaseTerms, asOf: Date, assume: Assumption, assumedPrincipal: number): LeaseBalance`
  - `type HeldUnit = { unitId: string; assetId: string; leaseId: string | null; cost: number }`
  - `type UnitFunding = { unitId: string; leaseId: string; leaseLabel: string; share: number; balance: number; payment: number; monthsLeft: number; aprPct: number; assumed: boolean }`
  - `unitFunding(leases: LeaseTerms[], held: HeldUnit[], asOf: Date, assume: Assumption): Map<string, UnitFunding>`
  - `FLOW_LEASE_ASSUMPTION: Assumption = { aprPct: 8, noteMonths: 60 }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pricing/lease-funding.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leaseBalance, unitFunding, FLOW_LEASE_ASSUMPTION, type LeaseTerms } from './lease-funding'
import { payment } from './flow'

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12))
const fcb: LeaseTerms = { id: 'L1', label: '6786821', status: 'ACTIVE', monthlyPayment: 4117.09, aprPct: 5.55, startDate: day(2026, 2, 2), termMonths: 36 }

test('balance is the present value of the payments still to come', () => {
  const b = leaseBalance(fcb, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0) // 6 payments made (Mar..Aug)
  const r = 5.55 / 100 / 12
  const pv = 4117.09 * (1 - Math.pow(1 + r, -30)) / r
  assert.equal(b.monthsLeft, 30)
  assert.equal(b.balance, Math.round(pv * 100) / 100)
  assert.equal(b.assumed, false)
})

test('a 0% lease with a payment: payments left × payment', () => {
  const b = leaseBalance({ ...fcb, aprPct: 0, monthlyPayment: 1000, termMonths: 12, startDate: day(2026, 5, 1) }, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0)
  assert.equal(b.monthsLeft, 9)
  assert.equal(b.balance, 9000)
})

test('a paid-off or finished lease owes nothing', () => {
  assert.equal(leaseBalance({ ...fcb, status: 'PAID_OFF' }, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0).balance, 0)
  assert.equal(leaseBalance({ ...fcb, startDate: day(2020, 0, 1) }, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0).balance, 0)
})

test('no terms recorded: priced on the labelled assumption, as a note on the unit cost from the lease start', () => {
  const shell = { ...fcb, monthlyPayment: 0, aprPct: 0, termMonths: 60, startDate: day(2025, 10, 19) }
  const b = leaseBalance(shell, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 20345)
  const pmt = payment(20345, 8, 60)
  const r = 8 / 100 / 12
  assert.equal(b.assumed, true)
  assert.equal(b.aprPct, 8)
  assert.equal(b.monthsLeft, 50) // Dec..Sep = 10 made
  assert.equal(b.balance, Math.round(pmt * (1 - Math.pow(1 + r, -50)) / r * 100) / 100)
})

test('a lease balance is split across the units still held, by cost', () => {
  const held = [
    { unitId: 'u1', assetId: 'p620', leaseId: 'L1', cost: 10000 },
    { unitId: 'u2', assetId: 'a6000', leaseId: 'L1', cost: 5000 },
    { unitId: 'u3', assetId: 'mac', leaseId: null, cost: 3000 },
  ]
  const f = unitFunding([fcb], held, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION)
  const total = leaseBalance(fcb, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0).balance
  assert.equal(f.get('u1')!.share, 2 / 3)
  assert.equal(f.get('u1')!.balance, Math.round(total * 2 / 3 * 100) / 100)
  assert.equal(f.get('u2')!.payment, Math.round(4117.09 / 3 * 100) / 100)
  assert.equal(f.has('u3'), false) // owned outright
})

test('shares of one lease sum back to the lease, to the cent', () => {
  const held = [1, 2, 3].map((i) => ({ unitId: `u${i}`, assetId: 'x', leaseId: 'L1', cost: 3333.33 }))
  const f = unitFunding([fcb], held, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION)
  const total = leaseBalance(fcb, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0).balance
  const sum = [...f.values()].reduce((s, u) => s + u.balance, 0)
  assert.equal(Math.round(sum * 100) / 100, total)
})

test('a lease whose held units cost nothing splits evenly', () => {
  const held = [{ unitId: 'u1', assetId: 'x', leaseId: 'L1', cost: 0 }, { unitId: 'u2', assetId: 'x', leaseId: 'L1', cost: 0 }]
  assert.equal(unitFunding([fcb], held, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION).get('u1')!.share, 0.5)
})
```

- [ ] **Step 2: Run it to see it fail** — `npx tsx --test src/lib/pricing/lease-funding.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/pricing/lease-funding.ts
/**
 * What the gear on a Flow order still owes on its lease (owner, 2026-09-26):
 * "if there's hardware on a capital lease we pay, we'd need to have that
 * somewhat broken out on cost for the hardware, then place the deal against it."
 *
 * v1 designed this and never wired it — every v1 Flow order prices as owned stock.
 *
 * - A lease's balance is the present value of the payments still to come. It needs
 *   only the payment, rate, start and term. `totalAmount` is NOT used: on some
 *   leases it is the principal, on others the sum of payments.
 * - A lease's balance and payment are split across the units it financed that we
 *   still hold, in proportion to what each cost. Sold units drop out, so the debt
 *   sits on the fleet that can go on a deal.
 * - A lease with no terms recorded (a $0 payment — 15 of 20 on 2026-09-26) is
 *   priced as a note on the unit's cost from the lease start, on an assumed rate
 *   and length, and marked `assumed` so every surface labels it.
 *
 * Economics only: the client's price never reads any of this. Pure.
 */
import { payment } from './flow'

export type LeaseTerms = {
  id: string
  label: string
  status: string
  monthlyPayment: number
  /** Percent, e.g. 5.55. Lease.interestRate is stored as a fraction — multiply by 100. */
  aprPct: number
  startDate: Date
  termMonths: number
}

export type Assumption = { aprPct: number; noteMonths: number }
export const FLOW_LEASE_ASSUMPTION: Assumption = { aprPct: 8, noteMonths: 60 }

export type LeaseBalance = { balance: number; payment: number; monthsLeft: number; aprPct: number; assumed: boolean }

const round2 = (n: number) => Math.round(n * 100) / 100

/** Payments made by `asOf`: one per whole month since the start. */
function paymentsMade(start: Date, asOf: Date): number {
  const months = (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - start.getUTCMonth())
  return Math.max(0, months - (asOf.getUTCDate() < start.getUTCDate() ? 1 : 0))
}

function presentValue(pmt: number, aprPct: number, months: number): number {
  if (months <= 0 || pmt <= 0) return 0
  const r = aprPct / 100 / 12
  return r > 0 ? (pmt * (1 - Math.pow(1 + r, -months))) / r : pmt * months
}

export function leaseBalance(l: LeaseTerms, asOf: Date, assume: Assumption, assumedPrincipal: number): LeaseBalance {
  if (l.status === 'PAID_OFF') return { balance: 0, payment: 0, monthsLeft: 0, aprPct: l.aprPct, assumed: false }
  const made = paymentsMade(l.startDate, asOf)
  if (l.monthlyPayment > 0) {
    const monthsLeft = Math.max(0, l.termMonths - made)
    return { balance: round2(presentValue(l.monthlyPayment, l.aprPct, monthsLeft)), payment: monthsLeft > 0 ? l.monthlyPayment : 0, monthsLeft, aprPct: l.aprPct, assumed: false }
  }
  // No terms on record: a note on the unit cost from the lease start, on the assumption.
  const monthsLeft = Math.max(0, assume.noteMonths - made)
  const pmt = assumedPrincipal > 0 ? payment(assumedPrincipal, assume.aprPct, assume.noteMonths) : 0
  return { balance: round2(presentValue(pmt, assume.aprPct, monthsLeft)), payment: monthsLeft > 0 ? round2(pmt) : 0, monthsLeft, aprPct: assume.aprPct, assumed: true }
}

export type HeldUnit = { unitId: string; assetId: string; leaseId: string | null; cost: number }

export type UnitFunding = {
  unitId: string
  leaseId: string
  leaseLabel: string
  /** This unit's fraction of its lease. */
  share: number
  balance: number
  payment: number
  monthsLeft: number
  aprPct: number
  assumed: boolean
}

/** Each held unit's part of its lease. Units with no lease are absent: owned outright. */
export function unitFunding(leases: LeaseTerms[], held: HeldUnit[], asOf: Date, assume: Assumption): Map<string, UnitFunding> {
  const out = new Map<string, UnitFunding>()
  for (const lease of leases) {
    const units = held.filter((u) => u.leaseId === lease.id)
    if (units.length === 0) continue
    const totalCost = units.reduce((s, u) => s + Math.max(0, u.cost), 0)
    // A terms-missing lease is assumed per unit (each is its own note on its own
    // cost); a lease with terms is one note split by cost.
    const whole = lease.monthlyPayment > 0 ? leaseBalance(lease, asOf, assume, 0) : null
    let balanceLeft = whole?.balance ?? 0
    let paymentLeft = whole?.payment ?? 0
    units.forEach((u, i) => {
      const share = totalCost > 0 ? Math.max(0, u.cost) / totalCost : 1 / units.length
      const last = i === units.length - 1
      if (whole) {
        const balance = last ? round2(balanceLeft) : round2(whole.balance * share)
        const pmt = last ? round2(paymentLeft) : round2(whole.payment * share)
        balanceLeft -= balance
        paymentLeft -= pmt
        out.set(u.unitId, { unitId: u.unitId, leaseId: lease.id, leaseLabel: lease.label, share, balance, payment: pmt, monthsLeft: whole.monthsLeft, aprPct: whole.aprPct, assumed: false })
      } else {
        const b = leaseBalance(lease, asOf, assume, Math.max(0, u.cost))
        out.set(u.unitId, { unitId: u.unitId, leaseId: lease.id, leaseLabel: lease.label, share, ...b })
      }
    })
  }
  return out
}
```

The shares-sum test depends on the last unit absorbing the rounding, and the implementation does that.

- [ ] **Step 4: Run** — `npx tsx --test src/lib/pricing/lease-funding.test.ts` → `# pass 7`. If `monthsLeft` in test 1 isn't 30, re-derive `paymentsMade` by hand for a Mar 2 start and a Sep 26 as-of date before changing anything. The March payment falls on Mar 2, so six have been made by Sep 26.

- [ ] **Step 5: Commit**: "feat(flow): what each held unit still owes on its lease".

---

### Task 5: Server loaders — basis, funding, and the order's Flow inputs

**Files:**
- Create: `src/lib/flow/load-bases.ts` (port of v1 `src/lib/flow/load-bases.ts`, 48 lines)
- Create: `src/lib/flow/load-funding.ts`
- Create: `src/lib/flow/order-inputs.ts`

**Interfaces:**
- Consumes: `resolveFlowBasis` (`flow-basis.ts`); `unitFunding`, `FLOW_LEASE_ASSUMPTION` (Task 4); `FlowLoan` (Task 3); `flowConfigFromSettings`, `priceFlowLines` (`flow-lines.ts`).
- Produces:
  - `loadFlowBases(db, assetIds: string[])` (as in v1)
  - `type LineFunding = { itemId: string; units: number; balance: number; payment: number; interestOverTerm: number; leases: { leaseId: string; label: string; assumed: boolean }[] }`
  - `loadFlowFunding(db, order: { id: string; flowTermMonths: number | null; flowAssumedAprPct: unknown; flowAssumedNoteMonths: number | null }, items: { id: string; assetId: string | null; quantity: number }[]): Promise<{ loans: FlowLoan[]; lines: LineFunding[]; assumedCount: number }>`
  - `flowInputsForOrder(db, orderId: string)`: everything `flowOrder()` needs for this order, with funding included. The repricing path (Task 7) and the order page (Task 9) both call it.

- [ ] **Step 1: Port `load-bases.ts`** verbatim, adjusting only the Prisma type import to v2's `@/generated/prisma/client`.

- [ ] **Step 2: `load-funding.ts`.** Which units a line's funding comes from:
  - If the line has units assigned (`ReservationItemUnit`, still open), use those units.
  - Otherwise, use the average over the asset's **held** units (status not `SOLD` or `RETIRED`, and `retiredAt` null): each line unit carries that average balance and payment.
  - The held set for the split is every held unit that has a `leaseId`, across the whole fleet, **not only this order's gear**. A lease's balance is spread over all the gear it still covers.
  - Unit cost = `purchasePrice` plus the landed-cost adjustment where v2 stores it. Use the same figure `flow-basis.ts` calls true cost, so "cost" means one thing.
  - The assumption comes from the order: `flowAssumedAprPct` / `flowAssumedNoteMonths` when set, otherwise `FLOW_LEASE_ASSUMPTION`.

  Group a line's per-unit funding by lease into `FlowLoan`s: balance and payment summed, APR taken from the lease, `monthsLeft` from the lease, `label` = lease number. Merge the same lease across lines into one loan. `interestOverTerm` per line = Σ `interestOver(unitBalance, apr, monthsLeft, flowTermMonths)` × units. Load leases with `prisma.lease.findMany({ where: { status: { not: 'PAID_OFF' } } })` and map `interestRate × 100 → aprPct`.

- [ ] **Step 3: `order-inputs.ts`** — read v1's create/reprice path (`src/lib/actions/reservations.ts`: `repriceFlowTx` ~302 and `maybeRecalcFlow` 407) and v1 `flow-lines.ts` `flowConfigFromSettings`. Build `flowInputsForOrder` to return `{ config, lines, funding }`. `config` is the result of `flowConfigFromSettings(order, defaults)` with `funding: funding.loans` and `monthsInService` set (the average months in service of the line units, from `resolveFlowBasis`, which v1 computed and never passed on).

- [ ] **Step 4: Check on real data (read-only).** Write `scripts/flow-funding-preview.ts`. For the three largest leases (FCB REFI 2024, 6786821, 6783781) it prints the lease balance, the number of held units, the split sum (it must equal the lease balance) and one sample unit's share. Run it. Report the figures, and flag any lease whose held units' cost is zero.

- [ ] **Step 5: Commit**: "feat(flow): load each order's lease funding and pricing inputs".

---

### Task 6: Thread FLOW through v2's type switches

Every place listed below must either handle FLOW or deliberately exclude it. The list comes from a full sweep on 2026-09-26. Before starting, re-run `grep -rn "RENT_TO_OWN" src --include=*.ts --include=*.tsx | grep -v generated` and add any new hit to this list.

**Files and what each needs:**
- **Labels:** `src/lib/types.ts:28,277-288` (union, `reservationTypeLabels` "Flow", `reservationTypeDescriptions` "Term hardware subscription — owned gear, returns at term end") and `src/lib/reservations/status.ts:23-28` (`TYPE_LABEL`).
- **Orders filter:** `src/lib/orders/types.ts:24-66` (a `flow` filter, its label and `ORDER_TYPES`) and `src/components/orders/revenue-strip.tsx:9-14` (`FILTER_FOR`).
- **Numbering:**
  - `src/lib/numbering/next.ts:123`: `kindForOrderType` FLOW → `flow`.
  - `src/lib/numbering/format.ts:62-65`: kind `flow` with pattern `FLW-{YYYY}-{SEQ}`, plus `NumberKind` and its label.
  - The sequence must continue past v1's `FLW-2026-00003` once those are synced. Check how v2 seeds sequences for RTO and do the same.
- **Recurring:** `src/lib/orders/recurring.ts`: FLOW always recurs (monthly), like RTO. Add `if (type === "FLOW") return true;` with a comment.
- **Billing and invoicing (exclude):**
  - `src/lib/actions/billing.ts:27` `dueReservations` gets `reservationType: { not: 'FLOW' }`.
  - `:196` `getUpcomingBilling` excludes FLOW.
  - `src/lib/actions/reservations.ts:205` `maybeAutoInvoice` returns early for FLOW.
  - `src/lib/actions/invoices.ts:159,477,537` refuses FLOW: "Flow orders are billed from their schedule; invoicing is not wired yet."
  - `src/lib/actions/order-stage.ts:586` `invoiceOrder` refuses FLOW.
  - `src/components/orders/order-actions.tsx:1079` `InvoiceButton` is hidden for FLOW.
- **Revenue:**
  - `src/lib/billing/earned.ts:184-189`: add FLOW beside RENT_TO_OWN in the full-charge guard.
  - Also port v1 `cb456d2` ("Accrue Flow earned revenue from its schedule, not total per cycle") into `src/lib/analytics/earned-revenue.ts:19,100,149` (`ReservationTypeKey`, `byType`).
  - `src/app/(shell)/dashboard/reports/page.tsx:154` gets a FLOW row.
- **Deal and margin:**
  - `src/lib/orders/deal.ts:83`: months for FLOW = `flowTermMonths`.
  - `src/lib/queries/margin.ts:61,106`, `accounting.ts:231,345` and `contract-record.ts:19,32`: decide per query. A Flow contract belongs in the contract record (a term commercial deal); list the choice made in the commit message.
- **Cycles:** `src/lib/actions/order-stage.ts:516-535,566` and `src/components/orders/order-actions.tsx:845-849,908,964,1018`: FLOW allows MONTHLY only.
- **Type changes (refuse):**
  - `src/lib/actions/reservations.ts:1144,1178-1206`: `updateReservation` refuses switching into or out of FLOW (v1 01a81f5), and the switch to RENTAL clears the flow columns (v1 c1ed9cf/80ed1a5).
  - `:4848-4960`: `duplicateReservation` keeps FLOW → FLOW only.
  - `src/lib/actions/sales.ts:320`: `convertReservationToSale` refuses FLOW.
- **Proposals:** `src/lib/actions/proposals.ts` refuses FLOW.
- **Other readers to check** (one line each in the commit message: handled or not relevant):
  - `extend-order.ts:61`, `asset-build.ts:388,528`
  - `queries/operate.ts:156,168`, `queries/reservations.ts:57,219`
  - `scan-desk.ts:41`, `orders/lifecycle.ts:153` (`movesFor`), `queries/packages.ts:264-288`
  - `billing/calendar.ts:283`, `analytics/insights.ts:250-258,733-740`
  - `tracker/labels.ts:151,164`, `tracker/environment.ts:115`, `integrations/hubspot.ts:29,177`
  - `actions/leads.ts:423,510`, `components/leads/lead-resolve.tsx:28`
  - `actions/documents.ts:419-424`, `order-detail-pdf.tsx:101`, `quote-pdf.tsx:41`
  - `scripts/smoke-routes.ts:87-98`, `scripts/normalize-order-dates.ts`
- **Default list filter:** `src/lib/actions/reservations.ts:379,396,467`: add FLOW wherever `[RENTAL, RENT_TO_OWN]` is the default (v1 did).

- [ ] **Step 1:** Make the label, filter, numbering and recurring changes. Run `npx tsc --noEmit`. Exhaustive `Record<ReservationType, …>` maps will fail to compile until each has a FLOW entry; that's the checklist.
- [ ] **Step 2:** Make the exclusions and refusals. Run `npx tsx scripts/smoke-routes.ts` → no new broken routes.
- [ ] **Step 3:** Make the revenue and deal changes, porting v1 `cb456d2`. `npm test` → green.
- [ ] **Step 4: Commit**: "feat(flow): thread the Flow type through orders, billing and revenue".

---

### Task 7: Server actions — create, update, reprice, settings, terms

Port from v1 (`src/lib/actions/reservations.ts`), in v2's shape. v2 creates orders through `src/lib/actions/order-builder.ts:87,155` and edits them through `src/lib/actions/reservations.ts`.

**Files:**
- Modify: `src/lib/actions/order-builder.ts` (create a FLOW order: persist the flow columns, `flowStartDate = startDate`, `flowPeriodsBilled = 0`, `endDate = start + term`)
- Modify: `src/lib/actions/reservations.ts`. Add `repriceFlowTx(tx, reservationId)`, porting v1 ~302. It recomputes line `rate`/`subtotal` and the order's `subtotal`, `discountAmount`, `taxAmount`, `total`, `totalCost` (from `trueCost`), `totalMargin`, `flowContractValue`, `flowMonthlyPayment` and `endDate`, using `flowInputsForOrder` (Task 5). Also add `maybeRecalcFlow`, called from every line-changing action (v1 has seven call sites; find v2's with `grep -n "export async function .*Item\|addItem\|removeItem\|updateItem" src/lib/actions/reservations.ts`). Also port:
  - `trueCost` set once, from the landed-cost basis, and reused per asset on update;
  - `costBasis` floored at `trueCost`;
  - `updateFlowLineBasis` and `updateFlowStepPct`;
  - the term lock (refuse term, basis and step edits once `flowTermsSnapshot` is set or `flowPeriodsBilled > 0`);
  - the refusals of direct rate edits, cloud hosts and components on Flow;
  - `requestRevision`, which clears the snapshot and autopay fields if nothing has been billed;
  - `approveReservation`, which freezes the terms snapshot.
- Create: `src/lib/actions/flow-settings.ts` (port v1, 92 lines: `getFlowDefaults`, `setFlowDefaults` admin-only, `getFlowBasesForAssets` editor-only).
- Create: `src/lib/actions/flow-terms.ts` (port v1, 114 lines: `getFlowTermsSettings`, `saveFlowTermsSettings`, `resetFlowTermsWording`, `updateFlowExtensionPct`, `markFlowAutopaySetup`, audit-logged through v2's audit helper). **No non-async exports** from `'use server'` files; v1 had a production incident from exactly that (eb12bb2).
- Create: `src/lib/flow-terms-server.ts` (port v1, 81 lines).

- [ ] **Step 1:** Port the settings and terms actions, plus `flow-terms-server.ts`. `npx tsc --noEmit` → clean for these files.
- [ ] **Step 2:** Add create in `order-builder.ts` and `repriceFlowTx`. Then write `scripts/flow-smoke.ts` (port v1 `scripts/flow-smoke.ts`). Inside a transaction that **rolls back**, it creates a Flow order on two leased units and one owned unit, reprices it, and asserts:
  - the line subtotals sum to the contract to the cent;
  - `flowMonthlyPayment` equals the schedule's month-1 rate;
  - `totalCost` equals Σ trueCost;
  - the funding loans are non-empty.

  Run it and paste the output into the commit.
- [ ] **Step 3:** Port the item-action hooks, the locks and the refusals. Re-run the smoke.
- [ ] **Step 4: Commit**: "feat(flow): create, reprice and edit Flow orders".

---

### Task 8: Order builder — Flow on the new-order form

**Files:**
- Modify: `src/components/reservations/order-builder.tsx:66-79,130,216,639`

**What to build:**
- FLOW appears as a type option with a `TYPE_NOTE`.
- `DATE_LABELS.FLOW` = "Subscription start / end".
- Choosing Flow shows:
  - the term in months (default 24; **the default must be real, not only displayed**: v1 a33476a/c35a1f6);
  - an expander "Pricing assumptions", prefilled from `getFlowDefaults()`, with margin %, finance %, purchase tax % plus exempt, recover-by month, depreciation %, life months, and the step %.
- Lines show the **basis** (floored at true cost) rather than a rate. The client price per line is computed live with `priceFlowLines` (it's pure, so it runs in the browser).
- The live preview shows:
  - month-1 payment, the step-down month, and the contract value;
  - an **internal** strip with hardware cost, lease balance on the gear, monthly net cash and profit.
- Follow the builder's existing look. Read how the RTO fields render and do the same.

- [ ] **Step 1:** Build it. **Step 2:** Create a Flow order in the browser on :3001, using real typing via the geckodriver route in `vfxnow-v2-browser-screenshots`. Confirm the saved order's numbers match the preview. **Step 3: Commit.**

---

### Task 9: Order record — Flow cards, with the lease breakdown

**Files:**
- Create: `src/components/orders/flow/flow-terms-card.tsx`
  - Shows the term, start and end, the current and next rate, the step month, and the extension %.
  - An **Edit terms** dialog (locked once agreed or billed).
  - Terms version, "agreed <date> by <name>", and the autopay method.
  - While `flowAutopaySetupAt` is null, an amber **Set up autopay** to-do with a **Mark set up** button (editor role).
  - Port the content from v1 `src/components/reservations/flow/flow-terms-card.tsx` (235 lines) and `flow-terms-editor.tsx` (120 lines), restyled in v2's card system.
- Create: `src/components/orders/flow/flow-schedule-card.tsx`: the month-by-month schedule with a step marker. Port v1 `flow-schedule-table.tsx`. Hide the rows when the schedule isn't feasible (v1 ffd0c77).
- Create: `src/components/orders/flow/flow-economics-card.tsx`, **internal only**. It has two sections:
  - **Hardware**, one row per line: units, true cost, lease balance, lease payment/mo, interest over the term, and which lease(s). A lease without terms is badged "lease terms missing — assumed 8% / 60 mo".
  - **The deal against it:** contract; hardware; finance allowance vs actual interest (the gap); profit and profit/month; monthly net cash for month 1 and the thinnest month; still owed at term end; gear value at term end.
  - Reads `flowOrder()` fed by `flowInputsForOrder()` (Task 5), computed on each render so lease updates show at once.
- Modify: `src/app/(shell)/dashboard/orders/[id]/page.tsx:56,89-108,190,393,507`. Render the three cards for FLOW in the same column the RTO commercial card uses, and give FLOW its date facts. Hide the invoice actions; the Print menu offers only the Flow quote (Task 10). Role gate: the economics card follows the rule for other cost/margin figures on the page. Find it with `grep -n "totalCost\|margin" src/app/\(shell\)/dashboard/orders/\[id\]/page.tsx`.
- Modify the line table: on a Flow order, the line's price pencil edits **basis** (`updateFlowLineBasis`), not rate (v1 `reservation-items-table.tsx`).

- [ ] **Step 1:** Build the cards. **Step 2:** Open a Flow order with leased gear and check the hardware rows against `scripts/flow-funding-preview.ts` from Task 5. **Step 3:** `npx tsx scripts/smoke-routes.ts`. **Step 4: Commit.**

---

### Task 10: Client quote — link, portal, PDF, approval with terms and autopay

**Files:**
- Modify: `src/lib/actions/quote-tokens.ts:18` (`generateQuoteToken` allows FLOW when feasible and refuses otherwise with a message), `:663` (send email), `buildQuote`, and `approveQuote`.
  - `buildQuote` for FLOW attaches `flow: flowClientQuote(...)` plus the rendered terms (`flowTermsForReservation`), and **drops per-line `rate`/`subtotal`**.
  - `approveQuote` for FLOW: no quantity or package changes; requires `autopayMethod` of ACH or CARD; in the same transaction writes `flowTermsSnapshot`, `flowTermsVersion`, `flowAutopayMethod`, `flowAutopayAuthorizedBy` (the signer name) and `flowAutopayAuthorizedAt`. The terms are rendered server-side from current settings, never taken from the browser. Port v1 lines 295-350 and 440-513.
- Modify: `src/lib/actions/order-stage.ts:100` (`createQuoteLink`), same rule as `generateQuoteToken`.
- Modify: `src/components/quote/quote-portal.tsx`. Add a FLOW branch:
  - heading "Flow Subscription" and billing label "Monthly (Flow, N months)";
  - the gear list **without prices**;
  - the tiers summary, totals and the full schedule table with a step marker;
  - "Equipment remains the property of VFXNow and is returned at the end of the term.";
  - the terms block (the clauses, a cancellation table and the extension line);
  - the approve panel with **two required checkboxes** (the Flow terms plus the General Terms link, and the autopay authorization) and an ACH / Card choice.

  Port the content from v1 `src/app/quote/[token]/page.tsx` (26 Flow references) in the portal's existing styling.
- Create: `src/components/documents/flow-quote-pdf.tsx` and `flow-terms-pdf-section.tsx` (port v1, 206 + 46 lines).
- Modify: `src/lib/actions/documents.ts`: for FLOW, the signed quote renders the Flow quote PDF with the terms, the signature and the autopay authorization line (v1 ~704). Offer the Flow quote PDF from the order's Print menu.
- Test: `src/lib/pricing/flow-client-safe.test.ts`. Build a client quote plus terms from a fixture order that has leased gear, and assert recursively that no key matches `/cost|basis|trueCost|margin|finance|profit|lease|residual|economics|tail|hardware/i`.

- [ ] **Step 1:** Write the client-safe test and make it pass. **Step 2:** Build the portal and PDF. **Step 3:** Try it on a Flow order in v2: make a link, open it, try to approve without autopay (refused), then approve with ACH. Check the snapshot and autopay columns are set and the signed PDF shows the terms, signature and autopay. Then change the terms wording in Settings and confirm that order's terms don't change. **Step 4: Commit.**

---

### Task 11: Settings → Documents — Flow subscription terms

**Files:**
- Create: `src/components/settings/flow-terms-section.tsx`. Port v1 `settings/documents/flow-terms-section.tsx` (114 lines):
  - the cancellation %, extension % and notice days;
  - the General Terms URL;
  - the clauses (title + body; add, remove, reorder);
  - the placeholder list and "Reset to default wording".
  - Unknown placeholders are refused on save (`unknownPlaceholders`). Admin to save.
- Modify: v2's Settings → Documents page. Find it with `grep -rln "Documents" src/app/\(shell\)/dashboard/settings`, and mount the section there.

- [ ] **Step 1:** Build it. **Step 2:** Save a change and confirm the version bumps and a new Flow quote shows the new wording. **Step 3: Commit.**

---

### Task 12: Verify the whole type end to end

- [ ] `npm test` → all green. `npx tsc --noEmit` → clean. `npm run lint` → no new errors. `flock /tmp/vfxnow-v2-build.lock npm run build` → succeeds.
- [ ] `npx tsx scripts/smoke-routes.ts` → no broken routes.
- [ ] `npx tsx scripts/flow-smoke.ts` → passes (rolls back).
- [ ] A Flow order created in the browser shows:
  - the Orders filter "Flow" with the order in it;
  - the terms, schedule and economics cards, with leased gear broken out;
  - no Invoice button;
  - the quote link and PDF;
  - approval that needs autopay.
- [ ] Update memory `vfxnow-v2-port-2026-09-26.md` with what landed and any divergence from v1 that was found.
