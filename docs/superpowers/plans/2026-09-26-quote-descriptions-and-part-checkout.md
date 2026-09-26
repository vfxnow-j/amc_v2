# Quote line descriptions + component-part checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate two v1 changes from commit `3fd469e` (2026-09-25) in v2: quotes show the asset name with the line's own description beneath it, and component parts (a GPU inside a workstation) check out by scan and in bulk.

**Architecture:** Both behaviours become small pure helpers with tests (`src/lib/quotes/line-title.ts`, `src/lib/checkout/lines.ts`); the server actions and renderers call them. v2 already marries scanned parts to their part row, so the scan change is only the assigned-line preference and the cloud-config exclusion.

**Tech Stack:** Next.js (read `node_modules/next/dist/docs/` before touching routing — AGENTS.md), Prisma 7, @react-pdf/renderer, `node:test` via `npx tsx --test`.

## Global Constraints

- v1 (`/home/docker/projects/vfxnow-amc`) is read-only: read it, never write it, never read its `.env`.
- No schema change in this plan.
- Tests: `node:test` + `node:assert/strict`, run with `npx tsx --test <file>`, beside the module (`*.test.ts`), same style as `src/lib/pricing/landed-cost.test.ts`.
- Commit messages are prose explaining the decision (match `git log`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stage explicit paths only; never `git add -A`.
- Cloud-host config rows are `parentId != null AND cloudProductId != null` — never checkout targets.

---

### Task 1: Quote line title + spec

**Files:**
- Create: `src/lib/quotes/line-title.ts`
- Test: `src/lib/quotes/line-title.test.ts`
- Modify: `src/lib/actions/documents.ts:432-440` (signed quote items)
- Modify: `src/components/documents/order-detail-pdf.tsx:29-48` (item type) and `:224-226` (render)
- Modify: `src/components/documents/quote-pdf.tsx:163-166` (render)
- Modify: `src/lib/actions/quote-tokens.ts:222` (online quote item)
- Modify: `src/components/quote/quote-portal.tsx:20-35` (`QuoteItem`) and `:485-488` (`Lines`)

**Interfaces:**
- Produces: `lineTitle(item: { description?: string | null; asset?: { name: string } | null }): { title: string; spec?: string }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/quotes/line-title.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineTitle } from './line-title'

test('asset line with its own description: name as title, description beneath', () => {
  assert.deepEqual(
    lineTitle({ asset: { name: 'Lenovo P620' }, description: '64GB RAM, 2TB NVMe, RTX A6000' }),
    { title: 'Lenovo P620', spec: '64GB RAM, 2TB NVMe, RTX A6000' },
  )
})

test('description equal to the asset name is not repeated', () => {
  assert.deepEqual(lineTitle({ asset: { name: 'Lenovo P620' }, description: 'Lenovo P620' }), { title: 'Lenovo P620' })
})

test('whitespace-only or missing description gives no spec', () => {
  assert.deepEqual(lineTitle({ asset: { name: 'Mac Studio' }, description: '   ' }), { title: 'Mac Studio' })
  assert.deepEqual(lineTitle({ asset: { name: 'Mac Studio' }, description: null }), { title: 'Mac Studio' })
})

test('ad-hoc line (no asset) uses its description as the title', () => {
  assert.deepEqual(lineTitle({ asset: null, description: 'Rush delivery' }), { title: 'Rush delivery' })
})

test('nothing at all falls back to "Ad-hoc item"', () => {
  assert.deepEqual(lineTitle({ asset: null, description: '' }), { title: 'Ad-hoc item' })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/lib/quotes/line-title.test.ts`
Expected: FAIL — `Cannot find module './line-title'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/quotes/line-title.ts
/**
 * What a quote shows for one order line: the asset's name as the title and, when
 * the line carries a description of its own (a configured spec, a note), that
 * description on a smaller line beneath. Ported from v1 3fd469e. Before this the
 * PDF dropped the description whenever an asset was set, and the online quote
 * did the reverse and hid the asset name.
 */
export function lineTitle(item: {
  description?: string | null
  asset?: { name: string } | null
}): { title: string; spec?: string } {
  const description = item.description?.trim() || ''
  const assetName = item.asset?.name?.trim() || ''
  const title = assetName || description || 'Ad-hoc item'
  return description && description !== title ? { title, spec: description } : { title }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx tsx --test src/lib/quotes/line-title.test.ts`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Wire the signed quote PDF data** — in `src/lib/actions/documents.ts`, import `import { lineTitle } from '@/lib/quotes/line-title'` and replace the `description:` line in `items: items.map(...)`:

```ts
      items: items.map((item, index) => {
        const { title, spec } = lineTitle(item)
        return {
          description: title,
          spec,
          quantity: item.quantity || 1,
          pricingType: pricingTypeLabels[(item.pricingType as PricingType) || 'DAILY'] || item.pricingType,
          rate: Number(item.rate) || 0,
          amount: financials.itemAmounts[index],
          category: item.asset?.category?.name || (item as any).category || undefined,
          termNote: formatTermNote(item, reservation),
        }
      }),
```

- [ ] **Step 6: Add `spec` to the PDF item type** — in `src/components/documents/order-detail-pdf.tsx`, inside `items: { ... }[]` after `description: string`:

```ts
    /** The line's own description, printed small under the asset name (see lib/quotes/line-title). */
    spec?: string
```

- [ ] **Step 7: Render `spec` in both PDFs** — in `order-detail-pdf.tsx` and `quote-pdf.tsx`, directly after the `<Text style={s.tableCell}>…item.description…</Text>` element inside `s.colDescription`, add:

```tsx
                          {item.spec && (
                            <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 2, ...(item.isComponent ? { paddingLeft: 18 } : {}) }}>
                              {item.spec}
                            </Text>
                          )}
```

- [ ] **Step 8: Online quote** — in `src/components/quote/quote-portal.tsx` add to `QuoteItem` after `name: string;`:

```ts
  /** The line's own description, shown small under the name. */
  spec?: string;
```

In `src/lib/actions/quote-tokens.ts` `buildQuoteItem`, import `lineTitle` and replace `name: item.description || item.asset?.name || 'Ad-hoc item',` with:

```ts
        ...(() => { const { title, spec } = lineTitle(item); return { name: title, spec } })(),
```

In `Lines` (`quote-portal.tsx`), after the closing `</span>` of the `×{item.quantity}` span (still inside the name `<span>`), add:

```tsx
                  {item.spec && (
                    <span className="mt-0.5 block text-xs font-normal text-[#71717a]">{item.spec}</span>
                  )}
```

- [ ] **Step 9: Check other `QuoteData` consumers** — run `grep -rn "QuoteItem\|\.name\b" src/app/quote src/components/quote src/lib/actions/proposals.ts | grep -v node_modules` and confirm every place that reads `item.name` from a `QuoteItem` still gets the asset name (proposal, `/quote/preview/[id]`). No other change is expected; note any that shows the old `description || name` order and apply `lineTitle` there too.

- [ ] **Step 10: Type-check and verify**

Run: `npx tsc --noEmit 2>&1 | grep -E "line-title|documents.ts|quote-tokens|quote-portal|order-detail-pdf|quote-pdf" ; echo done`
Expected: only `done`.
Then open an order with a described line (find one: `docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -tAc "select r.\"reservationNumber\" from reservation_items i join reservations r on r.id=i.\"reservationId\" join assets a on a.id=i.\"assetId\" where i.description is not null and i.description<>'' and i.description<>a.name limit 3"`), print its Quote PDF and preview its online quote (`/quote/preview/<id>`): name on top, description beneath.

- [ ] **Step 11: Commit**

```bash
flock /tmp/vfxnow-v2-git.lock bash -c 'git add src/lib/quotes/line-title.ts src/lib/quotes/line-title.test.ts src/lib/actions/documents.ts src/components/documents/order-detail-pdf.tsx src/components/documents/quote-pdf.tsx src/lib/actions/quote-tokens.ts src/components/quote/quote-portal.tsx && git commit -F /tmp/claude-1000/msg-line-title.txt'
```
Message: "feat(quotes): show the asset name with the line's own description beneath" — prose: v1 3fd469e; the PDF dropped the description whenever an asset was set and the online quote hid the asset name; one helper now decides both.

---

### Task 2: Component parts check out by scan and in bulk

**Files:**
- Create: `src/lib/checkout/lines.ts`
- Test: `src/lib/checkout/lines.test.ts`
- Modify: `src/lib/actions/reservations.ts:4176-4186` (`bulkCheckoutReservation` item query) and `:4232-4234` (per-unit charge)
- Modify: `src/lib/actions/reservations.ts:4549-4576` (`checkoutByBarcode` line selection)

**Interfaces:**
- Produces:
  - `CHECKOUT_LINE_WHERE` — Prisma where fragment: `{ NOT: { parentId: { not: null }, cloudProductId: { not: null } }, OR: [{ packageId: null }, { package: { isActive: true } }] }`
  - `pickScanLine<T extends ScanLine>(lines: T[], assignedLineId: string | null): T | null` where `type ScanLine = { id: string; parentId: string | null; quantity: number; checkedOutCount: number }`
  - `unitChargeFor(item: { includedInParent: boolean }, charge: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/checkout/lines.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickScanLine, unitChargeFor } from './lines'

const line = (id: string, over: Partial<{ parentId: string | null; quantity: number; checkedOutCount: number }> = {}) =>
  ({ id, parentId: null, quantity: 1, checkedOutCount: 0, ...over })

test('the line this unit is already assigned to wins, even when full', () => {
  const lines = [line('top'), line('gpu', { parentId: 'ws', checkedOutCount: 1 })]
  assert.equal(pickScanLine(lines, 'gpu')?.id, 'gpu')
})

test('no assignment: a top-level line with room comes before a part with room', () => {
  const lines = [line('gpu', { parentId: 'ws' }), line('top')]
  assert.equal(pickScanLine(lines, null)?.id, 'top')
})

test('top-level full, part has room: the part (GPU marries into its workstation)', () => {
  const lines = [line('top', { checkedOutCount: 1 }), line('gpu', { parentId: 'ws' })]
  assert.equal(pickScanLine(lines, null)?.id, 'gpu')
})

test('everything full: first top-level line stretches', () => {
  const lines = [line('gpu', { parentId: 'ws', checkedOutCount: 1 }), line('top', { checkedOutCount: 1 })]
  assert.equal(pickScanLine(lines, null)?.id, 'top')
})

test('only full parts: first part', () => {
  assert.equal(pickScanLine([line('gpu', { parentId: 'ws', checkedOutCount: 1 })], null)?.id, 'gpu')
})

test('no lines: null (caller creates an ad-hoc line)', () => {
  assert.equal(pickScanLine([], null), null)
})

test('an assignment to a line not in the candidates is ignored', () => {
  assert.equal(pickScanLine([line('top')], 'elsewhere')?.id, 'top')
})

test('a part included in its system price checks out at no charge', () => {
  assert.equal(unitChargeFor({ includedInParent: true }, 450), 0)
  assert.equal(unitChargeFor({ includedInParent: false }, 450), 450)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/lib/checkout/lines.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/checkout/lines.ts
/**
 * Which order lines hold physical units that go out the door.
 *
 * A part configured into a system (a GPU under its workstation) is a real unit
 * and checks out like any line. A cloud-host config row (parentId and
 * cloudProductId both set) is pricing detail only. And only the quote option the
 * client went ahead with ships — an alternative they didn't choose has nothing
 * to send. Ported from v1 3fd469e; v2 adds the chosen-option rule.
 */
export const CHECKOUT_LINE_WHERE = {
  NOT: { parentId: { not: null }, cloudProductId: { not: null } },
  OR: [{ packageId: null }, { package: { isActive: true } }],
} as const

export type ScanLine = { id: string; parentId: string | null; quantity: number; checkedOutCount: number }

/**
 * The line a scanned unit goes onto, from the lines for its asset (in sort order).
 * The line this exact unit is already assigned to comes first; then a machine's
 * line with room; then a part with room; then the first machine line stretches;
 * then the first part. Null means no line matches and the caller adds one ad hoc.
 */
export function pickScanLine<T extends ScanLine>(lines: T[], assignedLineId: string | null): T | null {
  const hasRoom = (l: T) => l.checkedOutCount < l.quantity
  const top = lines.filter((l) => l.parentId === null)
  const parts = lines.filter((l) => l.parentId !== null)
  return (
    (assignedLineId ? lines.find((l) => l.id === assignedLineId) : undefined) ??
    top.find(hasRoom) ??
    parts.find(hasRoom) ??
    top[0] ??
    parts[0] ??
    null
  )
}

/** A part that is part of its system's base price is charged nothing on checkout. */
export function unitChargeFor(item: { includedInParent: boolean }, charge: number): number {
  return item.includedInParent ? 0 : charge
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx tsx --test src/lib/checkout/lines.test.ts`
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Bulk checkout** — in `src/lib/actions/reservations.ts` import `import { CHECKOUT_LINE_WHERE, pickScanLine, unitChargeFor } from '@/lib/checkout/lines'`. In `bulkCheckoutReservation` replace the items `where`:

```ts
        items: {
          where: {
            // Parts inside a system check out like any line; cloud config rows and
            // lines from an option the client didn't choose never do.
            ...CHECKOUT_LINE_WHERE,
            ...(itemIds ? { id: { in: itemIds } } : {}),
          },
          include: { asset: true },
        },
```

and replace `const itemUnitCharge = computeItemSubtotal(Number(item.rate), 1, itemPeriods)` with:

```ts
      const itemUnitCharge = unitChargeFor(item, computeItemSubtotal(Number(item.rate), 1, itemPeriods))
```

- [ ] **Step 6: Scan checkout** — in `checkoutByBarcode`, replace everything from `const inChosenOption = …` through the `let reservationItem = …null` statement with:

```ts
    const candidateItems = await prisma.reservationItem.findMany({
      where: { reservationId, assetId: assetUnit.assetId, ...CHECKOUT_LINE_WHERE },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    // The line this exact unit was assigned to while preparing, if any.
    const assigned = candidateItems.length
      ? await prisma.reservationItemUnit.findFirst({
          where: { assetUnitId: assetUnit.id, reservationItemId: { in: candidateItems.map((i) => i.id) }, checkedOutAt: null },
          select: { reservationItemId: true },
        })
      : null
    let reservationItem = pickScanLine(candidateItems, assigned?.reservationItemId ?? null)
```

Keep the existing comment block above it, trimmed to say the rule now lives in `lib/checkout/lines.ts`.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "checkout/lines|reservations.ts" ; echo done`
Expected: only `done`.

- [ ] **Step 8: Verify on data** — find an order with a part line: `docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -tAc "select r.\"reservationNumber\", r.status, i.id, i.\"includedInParent\" from reservation_items i join reservations r on r.id=i.\"reservationId\" where i.\"parentId\" is not null and i.\"cloudProductId\" is null and i.\"assetId\" is not null limit 5"`. On a PREPARING/ACTIVE one (v2 data is expendable), scan a unit of the part's asset through Scan desk → Check out and confirm it lands on the part row, not a new line. Note: `bulkCheckoutReservation` currently has no caller in `src` (`grep -rn bulkCheckoutReservation src`); record that in the commit message rather than adding a button in this task.

- [ ] **Step 9: Commit**

```bash
flock /tmp/vfxnow-v2-git.lock bash -c 'git add src/lib/checkout/lines.ts src/lib/checkout/lines.test.ts src/lib/actions/reservations.ts && git commit -F /tmp/claude-1000/msg-part-checkout.txt'
```
Message: "fix(checkout): parts inside a system check out by scan and in bulk" — prose: v1 3fd469e; bulk dropped every part row; scan now prefers the line the unit was assigned to and never targets cloud config rows; included parts check out at no charge; bulk has no caller yet.
