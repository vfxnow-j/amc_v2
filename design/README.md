# Handoff: VFXnow AMC v2 — shell redesign (direction 3a, light + dark)

## Overview

VFXnow AMC is an existing, running Next.js 16 platform for a VFX hardware rental
business (assets → reservations → check-out/in → billing, plus CRM, leasing, quoting
and an AI assistant). This handoff covers a **v2 redesign of the application shell and
the dashboard surface**: a new information architecture that collapses ~28 dashboard
routes into 6 clusters, a new visual treatment ("floating cards"), the VFXnow brand
palette, and a light/dark theme pair.

It also introduces one net-new feature area — **Service Center** (work orders + QC test
runs) — which needs new routes and schema, described under "New feature: Service Center".

The work is intended to be built into the existing repo (Next.js 16 App Router,
TypeScript, React 19, Tailwind 4, shadcn/ui) and run on a second port alongside the
current instance for side-by-side testing.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes that show
intended look, structure and behaviour. They are **not production code to copy**. They use
inline styles, hard-coded sample data and a preview runtime that does not exist in the
target app.

The task is to **recreate these designs in the existing VFXnow codebase** using its
established patterns: Tailwind 4 utility classes, shadcn/ui primitives (Radix), the app's
existing `(dashboard)` layout and route groups, server components + server actions.
Translate the design tokens below into the Tailwind theme / CSS variables layer rather
than pasting inline styles.

Open `VFXnow 3a Reference.dc.html` in a browser to see the chosen direction (light frame
on the left, dark on the right). `All directions (context).dc.html` contains the full
exploration — earlier IA variants (1a/1b/1c), the dark study (2a), the other treatments
(3b bento tiles, 3c inset wells) and a **working, clickable nav prototype (4a)**. Use it
for context and for the nav interaction spec; only 3a is being built.

## Fidelity

**High-fidelity.** Colours, type, spacing, radii, row heights and copy are final and
should be matched closely. Exact values are listed under "Design tokens" and per
component below. Two caveats:

- The reference frames are fixed 1160×720 boxes so several could be compared side by
  side. In the real app the shell fills the viewport; the frame is not a max-width.
- Sample data (client names, unit IDs, dollar figures) is illustrative. Wire to real
  Prisma queries.

## Information architecture

The current app has ~28 sibling routes under `(dashboard)/dashboard/`. v2 groups them
into six clusters. Left column is the new nav; right column is the existing route(s)
that back it.

### 1. Operate — `OP`
| Nav item | Existing route(s) | Notes |
|---|---|---|
| Reservations | `reservations` | The hub. Sub-views: Open, Out now, Quotes, Archive |
| Desk — check-out / in | `checkout`, `checkin`, `checkouts` | **Merge three routes into one two-mode screen** |
| Mobile scan | `mobile` | Unchanged, restyled |
| Calendar | `calendar` | Unchanged |
| Packages | (from `Package` model, currently inside reservations) | Promote to its own list |

### 2. Inventory — `IN`
| Nav item | Existing route(s) | Notes |
|---|---|---|
| Assets | `assets` | Asset + AssetUnit list/detail |
| Units | `assets/[id]/units` (derived) | Promote serialized units to a first-class list |
| Locations & transfers | (from `Location`, `AssetTransfer`) | New list, models already exist |
| Audits & scan lists | `audits`, `scan-lists` | **Merge — one screen, two tabs** |
| Vendors | `vendors` | Unchanged |

### 3. Service center — `SC` — **NEW**
| Nav item | Backing | Notes |
|---|---|---|
| Work orders | new `WorkOrder` model | See "New feature" below |
| QC test runs | new `QcTestRun` model | |
| Maintenance log | `maintenance` (`MaintenanceRecord`) | Existing route folds in here |
| Coverage & RMA | `ServiceCoverage` | Warranty/coverage expiry tracking |

### 4. Revenue — `RV`
| Nav item | Existing route(s) | Notes |
|---|---|---|
| Invoices | `invoices` | Unchanged |
| Payments | (from `Payment`, QuickBooks sync) | Promote; surface QB sync state here |
| Contracts — sale · RTO · lease | `sales`, `rent-to-own`, `leases` | **Merge three routes into one, filtered by type** |
| Rate cards | (from `RateCard`, `Rate`) | Currently in settings |
| Purchase orders | `purchase-orders` | Unchanged |

### 5. Clients — `CL`
| Nav item | Existing route(s) |
|---|---|
| Accounts | `clients` |
| Leads | `leads` |
| Quotes | (reservations filtered to QUOTE_SENT; public portal stays `/quote/[token]`) |
| Marketing | `marketing` |

### 6. Insight — `IQ`
| Nav item | Existing route(s) |
|---|---|
| Overview | `dashboard` (root) |
| Reports | `reports` |
| Insights | `insights` |
| Nowbot | `nowbot` |

**Routes intentionally left out of the six clusters:** `settings` (pinned separately at
the bottom of the rail), `flow` (separate app area for the `FLOW_USER` role — do not put
it in the main rail), `cloud` / `services` (fold into Inventory or Revenue — confirm with
the product owner before moving), `builder`.

**Role-based visibility.** `SUPER_ADMIN` / `ADMIN` see all six. `STAFF` (warehouse) see
Operate, Inventory, Service center. `VIEWER` see Insight plus read-only Operate.
`FLOW_USER` never sees this rail. Gate in the nav config, not per-page.

## Screens / views

The reference shows one screen (Insight → Overview) in both themes, because the point of
this pass is the **shell**. Two screens are specified below: the shell itself, which every
route inherits, and the Overview content.

### Screen: application shell

**Purpose.** Persistent chrome — brand, search, cluster nav, user — around a routed
content area.

**Layout.** Outer container fills the viewport, `background: var(--ground)`,
`padding: 12px`, `display: flex`, `gap: 12px`. Two children:

1. **Nav panel** — `width: 256px`, `flex: none`, `background: var(--panel)`,
   `border-radius: 16px`, `padding: 14px 10px`, `box-shadow: var(--shadow-sm)`,
   `display: flex; flex-direction: column`.
2. **Content column** — `flex: 1; min-width: 0`, `display: flex; flex-direction: column`,
   `gap: 12px`. Contains a page header card then the routed body.

Nothing touches the viewport edge; the ground colour does the separating. No borders
anywhere in this direction — separation is surface + radius + shadow only.

**Nav panel contents, top to bottom.**

- **Brand lockup** — `padding: 2px 8px 14px`, `display: flex; align-items: center; gap: 9px`.
  Ring mark `24×24px` (`assets/vfxnow-mark.png`), then a two-line stack, `line-height: 1.02`:
  wordmark "VFX" in `--color-text` + "now" in `--color-accent-600` (light) /
  `--color-accent` (dark), `15px / 800 / -0.01em`; beneath it "AMC",
  `9px / 700 / letter-spacing .2em`, `--color-neutral-700` (light) / `--color-neutral-500` (dark).
- **Search** — `background: var(--sunken)`, `border-radius: 12px`, `padding: 8px 10px`,
  placeholder `12px` `--color-neutral-700`, right-aligned `⌘K` hint `10px / 700`.
  Opens the command palette; it should search orders, units, serials and clients.
- **Cluster list** — `flex: 1; min-height: 0; overflow-y: auto`, `display: flex;
  flex-direction: column; gap: 4px` between bubbles (`2px` between page rows inside an
  open bubble). Cluster labels are `white-space: nowrap`; page labels ellipsis rather than
  wrap, so a long label like "Contracts — sale · RTO · lease" truncates instead of
  reflowing the row. See the nav interaction spec below.
- **User pod** — pinned bottom, `margin-top: 10px`, `background: var(--sunken)`,
  `border-radius: 12px`, `padding: 8px 10px`. `26×26` avatar tile `border-radius: 9px`,
  initials `10px / 700`; name `12px / 700`; role `10px` `--color-neutral-700`.
  Settings gear right-aligned.

**Page header card** — `background: var(--panel)`, `border-radius: 16px`,
`padding: 12px 16px`, `box-shadow: var(--shadow-sm)`, `display: flex; align-items: center;
gap: 14px`. Left: cluster name as an eyebrow (`10px / 700 / .14em / uppercase` in
`--color-neutral-700`), then the page title (`24px / 800 / -0.03em`), then an optional
one-line context blurb (`13px`, `--color-neutral-800`) — e.g. "42 open orders · $1.24M
booked". Right: a segmented pill control and the primary action.

### Nav interaction spec (accordion "bubbles")

This is the part the client cared about most; a **working prototype is in
`All directions (context).dc.html`, option 4a** — exercise it before building.

Each cluster is a bubble: `border-radius: 14px`, containing a header row and a
collapsible panel.

- **Header row** — `padding: 8px 10px`, `display: flex; align-items: center; gap: 9px`,
  `cursor: pointer`, `user-select: none`. Children: a `26×26` mark tile
  (`border-radius: 9px`, 2-letter code `10px / 800`), the cluster label
  (`13.5px / 700 / -0.01em`), an optional `NEW` pill, then right-aligned the cluster count
  (`11px / 700`, `--color-neutral-700`) and a `▶` chevron (`10px`).
- **Panel** — one row per page: `padding: 6px 10px`, `border-radius: 10px`,
  `margin-top: 2px`, `display: flex; align-items: center; gap: 9px`; a `4px` dot, the label
  (`12.5px`), right-aligned per-page count (`11px`, `opacity .75`).

Behaviour:

1. **One cluster open at a time.** Opening a cluster closes the previous one, so the rail
   never exceeds its own height and rows don't slide out from under the cursor.
2. **Collapsed ≠ forgotten.** A closed cluster containing the active page keeps a quiet
   tint (`--color-neutral-200` light / `#1c2a33` dark) and its count.
3. **Open cluster** gets `--color-accent-100` (light) /
   `color-mix(in srgb, var(--color-accent) 20%, transparent)` (dark); its mark tile goes
   to full `--color-accent` with `--color-text` glyphs. Closed mark tiles are
   `--color-neutral-300` / `#26343d`.
4. **Active page row** is a full `--color-accent` fill with `--color-text` text at weight
   700. Never white-on-cyan (fails contrast).
5. **Counts** — cluster totals ride the bubble header always; per-page counts appear only
   while open, so the closed rail stays calm.
6. **Keyboard** — `1`–`6` jump to a cluster, `↑`/`↓` walk its pages, `Enter` navigates,
   `⌘K` bypasses the rail. Treat the mouse as the slow path; warehouse staff live on keys.

Animation: panel `max-height` + `opacity`, `280ms cubic-bezier(.4,0,.2,1)` and `180ms ease`
respectively; chevron `transform: rotate(0 → 90deg)`, `240ms` same curve; bubble and mark
background `200ms ease`; page-row background `160ms ease`. Compute `max-height` from row
count (`rows × 34px + 8`) — do not animate to `auto`. Respect
`prefers-reduced-motion: reduce` by dropping to an instant show/hide.

Open product question, unresolved: whether power users can **pin two clusters open** at
once (Operate + Service is the real case). Ship single-open; leave the state shape able to
hold a set.

### Screen: Insight → Overview

**Purpose.** The owner/admin morning read, and the warehouse lead's "what needs hands
today" list. Two audiences, one screen — KPIs on top for the first, work queues below for
the second.

**Layout.** Content column: header card, then a 4-up KPI row, then a
`grid-template-columns: 1.5fr 1fr; gap: 12px` body that fills remaining height.

**KPI row** — 4 equal cards, `gap: 12px`, each `background: var(--panel)`,
`border-radius: 16px`, `padding: 12px 14px`, `box-shadow: var(--shadow-sm)`. Contents:
label (`10px / 700 / .14em / uppercase`, `--color-neutral-700`), value
(`30px / 700 / -0.03em`, tabular figures), then a delta pill
(`11px / 700`, `background: var(--color-neutral-200)`, `border-radius: 20px`,
`padding: 1px 8px`).

The four: Utilisation `78.4%` / "+2.1 pts"; Revenue MTD `$412,880` / "64% of target";
Units on rent `1,284` / "of 1,638"; **Overdue** `7 units` / "$465 in fees" — this last card
is the alert state: `background: var(--color-accent-100)`, label
`--color-accent-800`, value `--color-accent-700`, pill on white with `--color-accent-800` text.
(Dark: `color-mix(in srgb, var(--color-accent) 22%, var(--panel))`, value
`--color-accent-300`.)

Source these from `src/lib/analytics/` — `earned-revenue.ts` and `statistics.ts` already
compute revenue and utilisation.

**Left panel — "Due back today."** `background: var(--panel)`, `border-radius: 16px`,
`padding: 14px 0 0`, column flex, `overflow: hidden`. Header row (`padding: 0 16px 12px`):
title `14px / 800 / -0.01em`, a late-count pill (`11px / 700`, `--color-accent-200` bg,
`--color-accent-800` text — dark: 32% accent mix), and a right-aligned
"Open the desk →" link in `--color-accent-700` (light) / `--color-accent-300` (dark).

Table: `display: grid`, `grid-template-columns: 84px 1fr 128px 62px 74px` —
Unit / Asset / Client / Due / State. Header labels `10px / 700 / .12em / uppercase`
`--color-neutral-700`, `padding: 0 16px 6px`. Rows `padding: 8px`, `border-radius: 10px`,
in a `padding: 0 8px` gutter with `gap: 2px`; zebra on `--color-neutral-100` (dark:
`#19262e`); **late rows** take `--color-accent-100` (dark: 22% accent mix) with the state
cell in `--color-accent-700` / `--color-accent-300` at weight 700. Unit IDs weight 700.
Footer, pushed to bottom, `12px` `--color-neutral-700`: "7 of 14 shown · scroll for the rest".

This is `ReservationItemUnit` joined to `AssetUnit` and `Client`, filtered to units due
today or overdue, ordered by due time. Rows link to the reservation; the pill filters to
late only.

**Right column** — two stacked cards, `gap: 12px`.

*Service center card* (`flex: none`): title + `NEW` pill + "23 open" meta. Four rows,
`gap: 6px`, each `border-radius: 10px`, `padding: 8px 10px`, `display: flex; gap: 8px`:
unit ID (`width: 74px`, weight 700), description (`12px`), then a result pill
(`10px / 700`, `border-radius: 20px`, `padding: 1px 7px`). FAIL rows sit on
`--color-accent-100` with a solid `--color-accent` pill and `--color-text` glyphs; RUNNING
and PASS sit on `--color-neutral-100` with a `--color-neutral-300` pill. Real copy from the
reference: "GPU 3 off bus — memtest queued", "Disk 7 pre-fail, RMA opened",
"Burn-in 4/6 h · OCCT clean", "Battery 71% — pass with note".

*Needs a decision card* (`flex: none`): title, then items on `--color-neutral-100`
(dark `#19262e`), `border-radius: 12px`, `padding: 10px` — bold headline plus a `12px`
`--color-neutral-700` detail line. Two shown: "Quote QT-0416 expires tomorrow /
Cobalt Frame · $38,900 · sent 13 days ago"; "3 invoices past 30 days / $52,140 · oldest
Halcyon, 44 days". Feed from `src/lib/analytics/insights.ts`.

## Copy rules

The client asked for real labels and real error/empty copy — no lorem, no "No data".

- **Empty states name the next action.** Reference example, verbatim: *"Nothing scanned
  yet — scan a unit barcode or add a line by hand."* Every empty table follows that
  shape: what's absent, then the way out. Never a blank table.
- **Conflicts offer a way out instead of blocking.** In the order builder the
  unavailable-unit case reads *"No unit is free for the whole window — all 6 are out until
  Aug 2,"* and offers three buttons: *Substitute PowerScale F710* (primary), *Start this
  line Aug 2*, *Book anyway, flag ops*. Carry that pattern into every validation failure —
  a save is never a dead end.
- **Counts are always qualified**: "7 of 14 shown · scroll for the rest", "of 1,638",
  "23 open". A bare number never stands alone.
- **Sentence case everywhere** except the `.14em`-tracked micro-labels, which are the only
  uppercase in the UI.

## Interactions & behaviour

- **Nav** — as specified above.
- **Segmented pill controls** (Today / Week / Month) — `background:
  var(--color-neutral-200)`, `border-radius: 20px`, `padding: 3px`; the selected option is
  a white pill with `--shadow-sm` and weight 700. Dark: track `#1e2f39`, selected pill
  `--color-bg` with `--color-text`.
- **Primary buttons** — `background: var(--color-accent-700)`, white text,
  `border-radius: 20px`, `padding: 8px 16px`, `13px / 700`. Hover
  `--color-accent-800`. On dark surfaces the primary may instead be full
  `--color-accent` with `--color-text` at weight 800.
- **Secondary buttons** — `background: var(--color-neutral-200)` (dark `#1e2f39`),
  `border-radius: 20px`, `padding: 8px 14px`, `12px / 700`, no border.
- **Focus** — `outline: 2px solid var(--color-accent); outline-offset: 2px` on
  `:focus-visible`. Never leave the browser default.
- **Rows** — hover lifts to `--color-neutral-200`; the whole row is the click target and
  navigates to the record.
- **Loading** — skeleton rows at the real row height (not spinners), so the table doesn't
  reflow when data lands. Use React Suspense boundaries per card so KPIs don't block the
  work queues.

## Theming (light / dark)

Both skins are in scope and must be one token set, not two stylesheets. Define semantic
variables and flip them on `[data-theme]` / `.dark`:

| Semantic | Light | Dark |
|---|---|---|
| `--ground` (app background) | `#f1f4f6` (`--color-bg`) | `#0c1418` |
| `--panel` (cards, nav) | `#ffffff` | `#15222a` |
| `--sunken` (search, user pod, wells) | `--color-neutral-200` `#e7ebee` | `#1e2f39` |
| `--row-alt` (zebra) | `--color-neutral-100` `#f4f6f8` | `#19262e` |
| `--ink` (body text) | `--color-text` `#14222a` | `--color-bg` `#f1f4f6` |
| `--ink-muted` | `--color-neutral-700` `#55606a` | `--color-neutral-400` `#b3bcc4` |
| `--ink-faint` | `--color-neutral-600` | `--color-neutral-500` |

Accent behaviour differs by theme and this matters: **brand cyan `#00d0ff` never carries
white text.** Light theme uses `--color-accent-700` `#0084a5` for primary buttons and for
accent-coloured body text, and reserves full cyan for state fills, selection and the mark.
Dark theme can use full cyan as a fill (with `--color-text` glyphs) and
`--color-accent-300` `#7cdfff` for accent text. Accent *tints* on dark are
`color-mix(in srgb, var(--color-accent) 18–26%, transparent)` rather than the 100–200 ramp
steps.

Default the app to **dark** for `STAFF` (warehouse lighting) and light for admin/finance,
with a per-user override persisted on the `User` record; respect
`prefers-color-scheme` for first load before a preference exists.

## State management

Shell-level, all client-side and cheap:

- `openCluster: string | null` — which bubble is expanded. Persist per user in
  `localStorage`; on navigation, force it to the cluster owning the active route.
- `activeRoute` — derive from the router, never store.
- `theme: 'light' | 'dark' | 'system'` — persisted per user (server) with a
  `localStorage` mirror to avoid a flash before hydration.
- `commandPaletteOpen: boolean`.

Everything else is server state: fetch in server components, mutate through the existing
server actions in `src/lib/actions/`, and `revalidatePath()` as the app already does. Do
not introduce a client data-fetching library for these screens.

## New feature: Service Center

Net-new area, tracked in the nav as `SC` with a `NEW` pill. Purpose: when a unit fails on
return, capture the failure, the bench tests run against it, and the outcome — bound to the
unit, visible from the reservation that returned it.

Two new models (names indicative; follow the existing schema's conventions):

- **`WorkOrder`** — `assetUnitId` (required), `openedFromReservationId` (nullable),
  `openedById`, `assignedTechId`, `status` (`OPEN`, `IN_TEST`, `AWAITING_PARTS`,
  `RMA`, `CLOSED_PASS`, `CLOSED_SCRAP`), `fault` (short text), `billable` (bool,
  default false), `openedAt`, `closedAt`, notes. Reference copy: *"WO-0312 — GPU 3
  dropped off PCIe bus"*, "Opened today 08:55 by QC bench · tech M. Okafor · client not
  billed".
- **`QcTestRun`** — `workOrderId`, `testName`, `result` (`PASS`, `FAIL`, `RUNNING`,
  `QUEUED`), `ranAt`, `durationSec`, `logUrl` / attachment, free-text `output`. The
  reference shows a four-row table: `nvidia-smi enumeration` FAIL 08:52;
  `memtest86 · 2 passes` PASS 09:40; `OCCT power · 30 min` PASS 10:20;
  `Riser reseat + retest` QUEUED —.

Behaviour to build:
- Opening a work order sets the unit's status so it can't be booked; closing as
  `CLOSED_PASS` returns it to available, `CLOSED_SCRAP` retires it.
- Check-in gets a "flag for service" path that creates the work order inline from the
  desk, carrying the reservation and unit.
- `MaintenanceRecord` (existing) becomes the historical log view under this cluster; a
  closed work order should write one.
- QC results ideally ingest from bench tooling — expose a key-authenticated endpoint under
  the existing `/api/v1/*` pattern so a test rig can POST a run result. Manual entry and
  log-file attachment must also work.
- Surface on the unit detail page and as a tab on the reservation ("Service · 2").

## Design tokens

Brand palette derived from the VFXnow logo (the mark is pure `#00d0ff` on white).

```
/* accent — brand cyan */
--color-accent:      #00d0ff   /* state, selection, marks. NEVER under white text */
--color-accent-100:  #e2f8ff   --color-accent-200: #b5edff
--color-accent-300:  #7cdfff   --color-accent-400: #38d6ff
--color-accent-500:  #00d0ff
--color-accent-600:  #00a8d1   /* wordmark "now" on light */
--color-accent-700:  #0084a5   /* primary buttons, accent body text on light */
--color-accent-800:  #00647f   --color-accent-900: #004b60

/* ground + ink (cool, tuned to the cyan) */
--color-bg:      #f1f4f6      --color-surface: #e6ebee
--color-text:    #14222a

/* neutrals */
--color-neutral-100: #f4f6f8  --color-neutral-200: #e7ebee
--color-neutral-300: #d5dbe0  --color-neutral-400: #b3bcc4
--color-neutral-500: #8b959e  --color-neutral-600: #6b757e
--color-neutral-700: #55606a  --color-neutral-800: #38434d
--color-neutral-900: #1e2a33

/* dark-theme surfaces */
ground #0c1418   panel #15222a   sunken #1e2f39   row-alt #19262e   hairline #26343d
```

**Type** — Schibsted Grotesk (Google Fonts, variable 400–900), `font-variant-numeric:
tabular-nums` globally so figure columns align.

| Role | Size / weight / tracking |
|---|---|
| Page title | 24–26px / 800 / −0.03em |
| Card title | 14px / 800 / −0.01em |
| KPI value | 30px / 700 / −0.03em, tabular |
| Body, table cell | 13px / 400, line-height 1.4 |
| Secondary / detail | 12px / 400 |
| Micro-label (the only uppercase) | 10px / 700 / +0.14em |
| Table column head | 10px / 700 / +0.12em, uppercase |
| Pill / badge | 10–11px / 700 |
| Nav cluster label | 13.5px / 700 / −0.01em |
| Nav page label | 12.5px / 400 (700 when active) |

**Radius** — `20px` app frame · `16px` cards and nav panel · `14px` nav bubbles, inner
wells · `12px` search, user pod, inset items · `10px` table rows, nav page rows, small
chips · `9px` mark tiles and avatars · `20px` (pill) buttons, badges, segmented controls.
Nothing square; nothing fully round except pills.

**Spacing** — `12px` between shell regions and cards · `14px` card padding (`12px 14px`
for KPI cards, `14px 16px` for header cards) · `8–10px` row padding · `6px` gap between
stacked list rows · `4px` gap between nav bubbles, `2px` between page rows · `gap: 9px` inside a nav row.

**Shadows** — only two, both from the design system: `--shadow-sm` on cards and panels,
`--shadow-lg` on the app frame in the reference (drop this in-app; the frame is the
viewport). No shadows at all in the dark theme — surface lightness does the separating.

**Density** — the client asked for dense, power-user layout: table rows `~30px` tall
(`8px` padding on `13px` text), nav rows `~30px`, KPI cards `~72px`. Do not loosen these;
warehouse staff scan long lists.

## Assets

- `assets/vfxnow-mark.png` — the cyan ring mark, trimmed square from the supplied logo.
  Used at 24–28px in the brand lockup and as the collapsed-rail mark. **Ask the client for
  vector (SVG) before shipping** — the PNG is a raster crop of the supplied file and will
  soften on hi-dpi.
- `assets/vfxnow-logo.png` — the full supplied logo (white "now" wordmark, cyan ring).
  Works on dark grounds only; on light grounds the reference uses the mark plus a typeset
  wordmark instead. Also request the light-ground variant.
- Fonts — Schibsted Grotesk from Google Fonts. Self-host in the app.
- Icons — Lucide, already the convention in this codebase.
- No photography in this pass.

## Files in this bundle

- `VFXnow 3a Reference.dc.html` — **the chosen direction**: the shell + Overview in light
  and dark, side by side. Open in a browser.
- `All directions (context).dc.html` — the full exploration. Contains, newest first:
  turn 4 (`4a`, the **working clickable nav prototype** — use it as the nav spec),
  turn 3 (`3a` floating cards ✅ chosen, `3b` bento tiles, `3c` inset wells), turn 2
  (`2a` dark study on a lined treatment), turn 1 (`1a` expanding clusters, `1b` cluster
  rail + sub-nav pane, `1c` everything-visible + section tabs). `1b` also contains a
  **reservation record with the unit inspector / work-order panel**, and `1c` contains a
  **new order builder** with the conflict-resolution pattern — both are the best existing
  reference for those screens even though their shell treatment was not chosen.
- `assets/` — brand mark and logo.
- `ds/` — the stylesheet and bundle the references load (design-system tokens). Reference
  only; do not add to the app.
- `support.js` — preview runtime for the HTML references. Not for production.

## Suggested build order

1. Token layer + theme switching (light/dark), fonts, Tailwind theme extension.
2. Shell: nav panel, accordion behaviour, header card, command palette hookup. Route the
   six clusters at the existing paths first — no route moves yet.
3. Overview screen against real analytics queries.
4. Route consolidation: Desk (checkout+checkin+checkouts), Contracts (sales+rent-to-own+
   leases), Audits & scan lists. These change URLs — add redirects from the old paths.
5. Service Center: schema, work-order CRUD, QC run ingest endpoint, check-in flag path.
6. Remaining screens restyled cluster by cluster, Operate first.

Steps 1–3 are what the second-port test instance needs to be worth looking at.
