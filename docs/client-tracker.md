# Client Tracker — specification

Settled with the owner 2026-09-14 over four question rounds. This is the source of truth
for the Tracker, account temperature, conversation log, asks and the client environment
profile. Nothing here is built yet.

## What it is for

Sales time is the scarce resource. The tracker exists to answer, every morning, **who should
we talk to today, why, and what do we offer them** — and to stop spending that time on
accounts that do not return revenue. Everything below serves one of three jobs:

- **Follow** — know where every account stands and never let a live one go quiet unnoticed.
- **Expand** — know what a client owns, runs and asks for, and where VFXNow or GPL could supply it.
- **Prune** — recognise dead accounts honestly and move them to low-touch.

## Where it lives

- **Clients → Tracker** — a new page in the Clients cluster (`src/lib/nav/clusters.ts`; the
  owner asked for this entry). The queue and every account's band, tier and next step.
- **Client record** — gains a Relationship card (band and *why*, tier, owner, next step,
  pin/seasonal) and a Conversations card (timeline of conversations and asks). Phase 3 adds
  the Environment profile.
- **Lead record** — the same log. Leads are one tracker with clients; they show as
  **Prospect** instead of a temperature. On conversion their conversations and asks move to
  the account.

## The data

Temperature and tier are **derived at read time, never stored** — a stored classification
goes stale the way `Reservation.subtotal` already has on this project. What is stored are the
*inputs* a person supplies: conversations, asks, owner, pins, seasonal windows.

### `Interaction` — one conversation or outreach attempt

| Field | Notes |
|---|---|
| `clientId?` / `leadId?` | At least one. On lead conversion `clientId` is filled and `leadId` kept for history. |
| `contactId?` | The `ClientContact` spoken to — shows who we actually talk to at an account. |
| `business` | `VFXNOW` \| `GPL`. GPL is a sister company; its orders are not in this database. |
| `channel` | `CALL` · `EMAIL` · `TEXT` · `VIDEO` · `MEETING` · `IN_PERSON` · `EVENT` |
| `direction` | `OUTBOUND` \| `INBOUND` |
| `reach` | `CONNECTED` · `NO_ANSWER` · `VOICEMAIL` · `NO_REPLY` — the unanswered-outreach rule reads this. |
| `intent?` | Axis 1, required when connected: `NO_GO` · `NOT_NOW` · `CURIOUS` · `PROSPECTING` · `READY_TO_BUY` |
| `nextStep` / `nextStepAt` | Axis 2: `FOLLOW_UP` · `SEND_QUOTE` · `DEMO` · `SITE_VISIT` · `NONE`, with a date. `nextStepDoneAt` closes it. |
| `summary`, `notes` | One line for lists; free text for the detail dump. |
| `reservationId?` | The order this conversation led to (see Conversion). |
| `occurredAt`, `createdById` | When it happened (may be backdated), who logged it. |

### `ClientAsk` — something a client asked for

| Field | Notes |
|---|---|
| `clientId?` / `leadId?`, `interactionId?` | Where it came from. |
| `business` | `VFXNOW` \| `GPL` |
| `category` | `WORKSTATION` · `GPU` · `STORAGE` · `NETWORK` · `REMOTE_ACCESS` · `SOFTWARE` · `CLOUD` · `PRO_SERVICES` · `MANAGED_SERVICES` · `LOGISTICS` · `OTHER` — the last three line up with `ServiceKind`. |
| `description`, `quantity?` | |
| `status` | `OPEN` · `QUOTED` · `WON` · `LOST` · `CANT_SUPPLY` |
| `reservationId?` | The order that answered it. |
| `lostReason?`, `closedAt?` | |

No estimated value is stored on an ask in Phase 1. If one is added later it is labelled an
estimate everywhere and never summed with booked value.

### Additions to existing models

- `Client.ownerId` → `User` (SetNull). Leads already have `assignedToId`; that is their owner.
- `Client.seasonalMonths Int[]` — the usual booking months for an event-based account. Empty = not seasonal.
- `Client.tempPin`, `tempPinReason`, `tempPinUntil`, `tempPinById` — the ad-hoc override. Reason and expiry required.
- `Setting` key `tracker.cadence` — the cadence table below, editable by an admin.

## Temperature — how a band is decided

A **move** is: an order created, an active order running, a rental returned, or a *connected*
conversation graded `CURIOUS` or higher. Silence, `NO_GO` and `NOT_NOW` are not moves.

Evaluated in order; the first rule that matches wins. The pure function lives beside
`lib/orders/lifecycle.ts` (Prisma-free), so the badge, the list and the queue cannot disagree.

1. **Pinned** — an unexpired pin sets the band. Shown as "Hot · pinned until 3 Oct — reason".
2. **HOT** — an active order (`APPROVED` · `PREPARING` · `SHIPPED` · `ACTIVE`) or an open bid
   (`QUOTE_SENT` · `REVISION`).
3. **HOT** — last order ≤ 60 days, or a positive conversation (`CURIOUS`+) ≤ 30 days.
4. **SEASONAL** — the account has booking months and today is outside its window. It rests
   here instead of cooling. It becomes COLD only after a whole window passes with no move.
5. **DEAD** — no move for 12 months or more, **or** 3 or more consecutive unanswered outreach
   attempts spanning at least 60 days while the last move is over 90 days old. The streak
   resets on any connected conversation or order.
6. **WARM** — last move 60–90 days ago.
7. **COLD** — last move 90 days to 12 months ago.

**New accounts with no orders** count their creation date as a move for Warm, never for Hot —
nothing has been earned yet. **Leads** show *Prospect*; a lost lead leaves the queue.

**Traps to respect when computing "last move":**
- A recurring order's `endDate` is a billing-period end, not a return date. Use its status,
  and the COMPLETED transition in `StatusHistory` for a returned rental — never `endDate`.
- `CANCELLED` and `LOST` orders are not moves.
- Reuse the one booked-value definition the dashboard already uses (2026-09-10 polish). Find
  it before building rather than writing a second one.

**Where accounts would sit on orders alone today** (94 clients, last order): ≤30d 17 · 30–90d
19 · 90–180d 26 · 180–365d 23 · never 9. None is older than a year, so **no account is Dead
on orders alone yet**. Dead will come from unanswered outreach once logging starts. That is
expected, not a bug.

## Value tier — A / B / C

Rank accounts by **booked value over the trailing 12 months**, real orders only. Among accounts
with any booked value, the top 20% are **A** and the next 30% are **B**. Everyone else, including
zero, is **C**. Percentile cut-offs adjust as the business grows. With about 85 ordering
accounts, that is roughly 17 A and 26 B.

## The matrix — what to do with an account

| | A | B | C |
|---|---|---|---|
| **HOT** | Protect and expand: owner call, catalogue-gap review | Expand: cross-sell from the profile | Serve well, no chasing |
| **WARM** | ★ **Call now** — highest priority in the whole system | Call soon | Check in |
| **COLD** | Win-back plan: find the reason, make an offer | Re-engage | Nurture |
| **SEASONAL** | Pre-window call with a ready proposal | Pre-window call | Pre-window email |
| **DEAD** | One senior touch, then low-touch | Low-touch | Archive from active lists |

Warm A-accounts rank highest because this is the cheapest point to recover revenue that is
already proven.

### Cadence (defaults in `tracker.cadence`, admin-editable)

| Band | Default | A tier | C tier |
|---|---|---|---|
| HOT | check in every 30d | 21d | 45d |
| WARM | call within 7d of entering | 3d | 14d |
| COLD | re-engage every 45d | 30d | 90d |
| DEAD | low-touch every 180d | 90d | none |
| SEASONAL | 6 weeks before window | 8 weeks | 4 weeks |

B tier uses the default.

## The follow-up queue

A queue item is one of:

1. **Next step due** — `nextStepAt` ≤ today and not done.
2. **Cadence due** — last touch + cadence for the account's band and tier ≤ today.
3. **Quote unanswered** — an order at `QUOTE_SENT` for 5+ days with no conversation since.
4. **Going quiet** — a Hot account with no touch for 30d, or an account that just entered Warm.
5. **Rental ending** — an active non-recurring rental whose return is ≤ 14 days away. Prompt an
   extend, buy-out or next-project call.

**All five are derivable when the page is read**, from stored rows plus today's date. The queue
needs no scheduled job and cannot drift. Only *pushing* them as notifications (Phase 2) needs
the digest job. That also means Notifications needs new `NotificationType` members.

**Order:** matrix cell first, then days overdue, then booked value. The default view is **Mine**
(owner = me). **Pool** shows unowned accounts, which anyone can claim.

## Grading a conversation — what each outcome triggers

| Intent | Counts as a move | Default next step | Nudge |
|---|---|---|---|
| `NO_GO` | no | none, or revisit in 180d | Close open asks as Lost; a reason is required |
| `NOT_NOW` | no | revisit date required (default +60d) | Ask if this is seasonal and offer to set months |
| `CURIOUS` | yes | follow up in +14d | Capture at least one ask |
| `PROSPECTING` | yes | follow up in +7d | Asks expected; conversion suggestions look back 45d |
| `READY_TO_BUY` | yes | send quote within 2d | "New order" button with the client and asks prefilled |

An unanswered attempt (`NO_ANSWER` · `VOICEMAIL` · `NO_REPLY`) needs no intent. It needs a
retry date, and it extends the unanswered streak.

## Conversion

When an order is created for an account that has an open ask or a `PROSPECTING`+ conversation
in the last 45 days, the tracker **suggests** the link. One click confirms it: the conversation
gets its `reservationId` and the ask becomes `WON` with that order. Nothing is linked without a
person confirming. When the order later reaches `LOST`, the linked ask returns to `LOST`.

## The environment profile (Phase 3)

One profile per client, tagged by what each business supplies. Each section records **what they
own elsewhere**, **what we supply** (from real orders) and **what they have asked for**.

- **Workstations & GPUs** — vendor/model, OS, GPU, seat count, age / refresh date
- **Storage / NAS** — vendor, capacity, % used, protocol, backup/LTO
- **Network & remote access** — speed, switching, internet, VPN, remote desktop tools
- **Software & pipeline** — DCC apps, render manager, render farm / cloud use, license servers
- **Services** — pro services, logistics, managed services, and anything else in the VFXNow or GPL catalogue

Vocabulary reuses inventory's categories (Workstations, Storage Servers, Networking, Graphics
Cards…) so "they own a NAS" and "we rent them storage" are the same word.

## Expansion signals (Phase 4)

- **Catalogue gaps** — the full VFXNow + GPL offering against owned / supplied / asked. Empty cells are cross-sell openings.
- **Aging & capacity** — owned workstations past refresh, a NAS near full, an old network.
- **Rental → ownership** — the same class of kit re-rented repeatedly. Suggest rent-to-own or sale.
- **Unfilled asks** — `CANT_SUPPLY` and `LOST` asks resurface when stock or pricing changes, and roll into a purchasing demand report.

## Build phases — each confirmed before the next

1. **Log, temperature, Tracker.** `Interaction`, `ClientAsk`, owner, pin, seasonal; the
   temperature and tier functions; the Tracker page with the queue (all five items, since
   they're derived); the Relationship and Conversations cards on client and lead records;
   the nav entry.
2. **Push and link.** Notifications for queue items, the dashboard tile, conversion suggestions.
3. **Environment profile.**
4. **Expansion signals, gap grid, demand report.**

Capture is manual quick-log at first. JustCall/HubSpot auto-logging comes later; their secrets
are blank in v2 and outbound email is off.

## What Phase 1 makes reachable — check before building

- **Lead conversion** (`lib/actions/leads.ts`) must carry interactions and asks to the new
  account. Read what the ported action does and what it checks before extending it.
- **Lead assignment** becomes the owner concept for leads. Confirm the ported assign action
  has a role check; `agreement.ts` shipped with none.
- Every new server action checks role: SUPER_ADMIN, ADMIN and STAFF write, VIEWER reads.
- A new model requires restarting the dev server after `prisma generate`.

## Band colour

Band is **never colour alone**: always a label, with colour as reinforcement. Red already means
overdue in this app, so **Dead is not red**. It is a muted neutral, which suits an account that
has left the active lists. Suggested: Hot = warm orange, Warm = amber, Cold = blue,
Seasonal = violet, Dead = neutral, each checked for contrast across the twelve themes.

## Small calls still open (defaults applied until the owner says otherwise)

- **Who may pin or set seasonal months** — default: STAFF may pin (reason required, 90 days at
  most); only ADMIN sets seasonal months.
- **Is a `DRAFT` order an open bid?** — default: no; a bid exists once the quote is sent.
- **Multi-threading** (not requested, offered): flag an A-account where only one contact has
  been reached in 12 months. That's a single point of failure for the relationship.

---

## Phase 1 — as built (2026-09-14)

Built on `feat/design-tokens`: schema (`prisma/manual/2026-09-14-client-tracker.sql`, applied
by hand, additive only), `lib/tracker/labels.ts` and `lib/tracker/temperature.ts` (pure),
`lib/queries/tracker.ts`, `lib/actions/tracker.ts`, `components/tracker/*`, the page at
`/dashboard/clients/tracker`, the Relationship and Conversations cards on the client record,
Conversations on the lead record, and the nav entry.

**Where the build reads the spec a particular way — each one is the owner's to overturn:**

- **Lead conversations are followed, not copied.** An account shows every conversation and ask
  logged on a lead whose `convertedToClientId` or `boundToClientId` is that account, resolved at
  read time. Nothing is written on conversion, so no conversion path (there are four) can forget
  to carry them. `Interaction.clientId` stays null on those rows.
- **Warm is "under 90 days and not Hot".** Read literally, 60–90 days left a gap: a positive
  conversation 30–60 days ago with no recent order, or a new account with nothing booked, matched
  no rule.
- **A return is `completedAt`, not the COMPLETED row in `StatusHistory`.** `completedAt` is set on
  28 of 28 completed orders; the history holds the transition for only 24.
- **Booked value for tiers** reuses the dashboard's definition: approved through completed, from
  the approved package (`queries/order-value`), on orders *created* in the last 365 days. 45
  accounts have booked value on that basis today, so the split is 9 A · 14 B, not the ~17 A the
  spec estimated from all ordering accounts.
- **Hot is rose, not orange.** The band colours reuse the twelve tile accents, whose text-on-tint
  contrast is already proven; there is no orange among them. Warm amber, Cold blue, Seasonal
  violet, Dead slate, Prospect teal. The label is always printed.
- **Leads get next-step items only**, no cadence items, and a Prospect ranks beside Warm B.
- **Logging a conversation closes the record's earlier open next steps** for the same business —
  the follow-up that was due is the thing just logged.
- **Pins:** STAFF up to 90 days, administrators up to 365. Seasonal months: administrators only.
- **`tracker.cadence` is read, not yet editable.** Defaults are in code with per-cell fallback;
  no settings screen writes the row yet.

**What day one looks like.** Nothing has been logged, so every account is measured from its
orders alone: 66 Hot, 3 Warm, 25 Cold, no Dead or Seasonal, 30 open leads as Prospect — and 85 of
124 rows are due, mostly cadence and going-quiet on Hot accounts nobody has a logged conversation
with. That number falls as calls are logged; it is not a fault.

**What it made reachable.** Eight Server Functions — `logInteraction`, `completeNextStep`,
`createAsk`, `setAskStatus`, `setClientOwner`, `pinTemperature`, `clearTemperaturePin`,
`setSeasonalMonths` — each gated inside itself (`requireEditor`, or `requireAdmin` for seasons),
confirmed in the build's server-reference manifest; the helpers in that file are not exposed.
`assignLead` already gates on `requireEditor`. `convertLeadToReservation` was not touched.

**Open:** the Clients cluster is administrator-only in the rail, so STAFF — who may write here —
can reach a record by link but not the Tracker from the rail. None of the write paths has been
driven from a browser; there is no browser in this environment.

## Phase 2 — as built (2026-09-14)

**Notifications.** Four `NotificationType` members (`prisma/manual/2026-09-14-tracker-notifications.sql`):
`FOLLOW_UP_DUE`, `QUOTE_UNANSWERED`, `ACCOUNT_QUIET`, `RENTAL_ENDING`. The daily sweep
(`lib/notifications/raise.ts`, `trackerFollowUps`) raises them from `getTrackerRows` — the same
derived queue the Tracker shows — with the existing seven-day quiet period. Cadence items stay on
the page and are not notified.

- **Recipient is the account's owner.** Pool accounts do not notify every admin. Where an item
  belongs to someone anyway it falls back to them: a next step to whoever logged it, a quote or a
  rental to whoever built the order. "Going quiet" on an unowned account raises nothing.
- **Dry run on 2026-09-14, nothing written:** 24 quote-unanswered (16 to J Roen, 8 to Marvin Villa)
  and 2 rentals coming back (Marvin Villa). No follow-up or quiet alerts yet — nothing is logged and
  nothing is owned.

**Dashboard tile.** "Who to call" (`tracker-queue`, admin-only like the Clients cluster): the
viewer's own due accounts, or the whole queue while they own none. It is in the picker, not added
to any seeded view.

**Conversion suggestions.** A "From the tracker" card on the order record lists the account's open
or quoted asks with no order, and its Prospecting-or-better conversations from the 45 days before
the order was created (or since) with no order. Everything starts ticked; nothing links until the
button is pressed (`linkToOrder`, gated, and every id checked against the order's own account). A
linked ask becomes Won. Derived on read, so all six order-creation paths get it without being
touched. The card renders nothing when there is nothing to suggest or show.

**Lost orders.** `markLost` and the client's decline-by-link (`denyQuote`) now return any ask the
order had answered to Lost, through `lib/tracker/order-outcome.ts` — a plain module, so it is not a
callable Server Function.

**Not verified:** the card with real suggestions and the tile on a dashboard — no asks or
conversations exist yet, and the tile is not on a saved view. Linking has not been clicked.
