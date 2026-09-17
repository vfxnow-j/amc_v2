# Notifications — specification

The owner's ask, 2026-09-16: *"notification vamp: I want to be able to send the inventory
reports, depreciation reports, add new recipients and specify the reports they'd receive like
v1. then lets tail up actual notifications punching in resend and new styles."*

Sharpened the same day: every recipient category any code sends to must be a labelled
checkbox with a one-line description, and nothing may be a checkbox that nothing sends to; a
recipient is an address (person or distribution list), an optional label and ticks; an admin
template gallery with sample previews and "Send me a sample"; the real logo in every email.

## Decided by the owner

- **Email safety.** `EMAIL_TEST_REDIRECT` is set to the owner's address; every send lands
  there with a banner naming the real recipient. v2 has its own `RESEND_API_KEY` and
  `EMAIL_FROM` (noreply@vfxnow.io, verified domain). Nothing here clears or bypasses the
  redirect.
- **Schedule** like v1: per report, daily / weekly / every other week / monthly, a day, an
  hour, Pacific. One hourly cron decides what is due and sends at most once per occurrence.
  "Send now" per report, admin only.
- **Depreciation report** is new: book value summary and by family, the period's expense,
  fully depreciated now and in the next 90 days; branded PDF and a CSV for accounting;
  monthly by default; the one existing depreciation schedule.
- **Inventory report** is v1's, ported (v1 is read, never written).
- **Recipients** keep v1's `notification_recipients` shape, additive keys only.
- **New styles**: one branded, table-based, inline-styled layout for every template, with a
  plain-text part.
- **Logo** as an inline CID attachment (no public URL exists for images).

## Where it lives

| Piece | File |
| --- | --- |
| Layout and blocks | `src/lib/email/layout.ts` |
| Templates (all) | `src/lib/email/templates.ts`, personal digest in `src/lib/notifications/digest-email.ts` |
| Sample data for the gallery | `src/lib/email/samples.ts` |
| Send path (key check, redirect, text part, inline logo) | `src/lib/email/send.ts` |
| Recipient categories (client-safe) | `src/lib/notifications/recipients-schema.ts` |
| Reading/writing recipients | `src/lib/notifications/recipients.ts` |
| Senders to recipient lists | `src/lib/notifications/outbound.ts` |
| Report registry, schedule maths | `src/lib/notifications/reports/registry.ts`, `schedule.ts` |
| Running reports, claims, the daily sweep | `src/lib/notifications/reports/run.ts` |
| Inventory and depreciation builders | `src/lib/notifications/reports/reports.ts`, `src/lib/inventory/snapshot.ts`, `src/lib/inventory/depreciation-report.ts` |
| PDFs | `src/components/documents/report-pdf-kit.tsx`, `inventory-snapshot-pdf.tsx`, `depreciation-report-pdf.tsx` |
| Admin actions | `src/lib/actions/notification-settings.ts` |
| Screens | `/dashboard/settings/notifications`, `/dashboard/settings/notifications/templates` |
| Cron | `/api/cron/reports` (hourly), `/api/cron/daily-digest` (the sweep on demand) |

## Phase 1 — layout, restyle, test send (as built, `2593651`, logo `9068445`)

- **Layout.** Dark band with the VFXnow logo and a teal rule, eyebrow, title, subtitle, white
  body, one CTA button, footer. Blocks: paragraph, facts, callout (tones), section, data
  table, headline stats, bullets, one-time code. Tables and inline styles for Gmail/Outlook,
  light page, hidden preheader. Colours are the default theme's ramps; the CTA is
  accent-700 (#0081a1, white text 4.51:1) and follows the owner's pending #00718d decision.
- **Audiences.** Client mail never links into the app and invites a reply; staff mail says
  where to change what arrives; security mail says it can't be switched off.
- **Plain text** derived from the HTML for every message (`htmlToText`); the redirect banner
  appears in the text part too, and in `<body>` rather than before the doctype.
- **Logo.** `public/brand/email-logo-white.png` (192×128, 8KB) attached inline with content
  id `vfxnow-logo` by `sendEmail` whenever the HTML references it; `sendBatch` falls back to
  one-by-one sends for such messages because Resend's batch endpoint takes no attachments.
  The white `alt` stands in if images are blocked; previews swap the cid for the file.
- **Fixes on the way.** Subjects were HTML-escaped ("&amp;" in subjects); the proposal email
  was unescaped inline HTML, now `proposalEmail`.
- **Test send**: Settings → Notifications → Outbound email (admins): key set, from, redirect,
  where links point (flagged while APP_URL is localhost), "Send test" mails the specimen.

## Phase 2 — recipients, registry, schedules, Send now (as built, `4827738`)

**The mapping** — every recipient category, what it sends, the sender, and when. No category
is sent to that can't be ticked; no tick is unsent.

| Key (column) | Label | Emails | Sender | When |
| --- | --- | --- | --- | --- |
| `leads` (Leads) | New leads | New lead | `notifyNewLead` | A lead is created: web form, API v1, Zapier, JustCall, lead actions |
| `reservations` (Orders) | Orders and quote replies | Order confirmed (prep list); quote approved / declined / changes requested | `notifyReservationConfirmed`; `approveQuote`, `denyQuote`, `requestQuoteChanges` | As it happens |
| `purchaseOrders` (POs) | Purchase orders submitted | PO submitted, PDF attached | `notifyPurchaseOrderSubmitted` | `submitPurchaseOrder` |
| `funding` (Funding) | Funding requests submitted | Funding request submitted, form PDF attached | `notifyFundingRequestSubmitted` | `submitFundingRequest` |
| `coverage` (Coverage) *v2 key* | Service coverage expiring | Coverage expiring | `sendCoverageExpiryNotifications` | Report schedule, default daily 7:00; only when something ends within 30 days, each coverage at most weekly |
| `insights` (Digests) | Day at a glance and weekly report | Day at a glance; weekly report | `notifyDailyDigest`; `notifyWeeklyReport` | Report schedules, default daily 9:00 and Sunday 12:00 |
| `traffic` (Traffic) | Daily traffic report | Traffic report | `notifyDailyTrafficReport` | Report schedule, default daily 17:00 |
| `inventory` (Inventory) | Inventory report | Inventory report, PDF attached | `sendInventoryReport` | v1's stored schedule: weekly Monday 11:00 |
| `depreciation` (Deprec.) *v2 key* | Depreciation report | Depreciation report, PDF + CSV | `sendDepreciationReport` | Report schedule, default monthly 1st 8:00 |

`coverage` absent on an entry (every entry from v1) inherits `reservations`, because v1 sends
coverage to reservations recipients. `depreciation` absent means off.

**Mail that is not set by recipients** (addressed to a person):

| Mail | To | Sender | Respects |
| --- | --- | --- | --- |
| Approval needed / decided | Approvers for the type (not the asker); the asker | `approvals/core` `notifyApprovers`, `notifyRequester` | In-app always; email unless the person turned Email off for "Approvals waiting on you" (Phase 4) |
| Personal digest | Each user with the digest on | `sendNotificationDigests` | Opt-in, and per-type Email switches |
| Task assigned / updated | The assignee | `actions/tasks` | No preference type exists |
| Account invite, password reset, MFA code/on/off | The account holder | users, password-reset, mfa | Not switchable (security) |
| Quote link / quote / proposal / order confirmed / preparing / shipped / invoice / documents requested / onboarding | The client | quote-tokens, reservations, proposals, invoices, agreement, leads | The redirect |
| Overdue reminder; system alert | Clients; admins | `sendOverdueReminders`, `sendSystemAlert` (admin actions) | **Not called by anything in v2** (v1 runs reminders from its billing cron) |

- **Editor** (admins): add address + optional label, tick, remove, save. Save merges by address
  over the stored row, so unknown keys survive, and writes every known category explicitly.
  Audited as a Settings UPDATE. Non-admins see the list read-only, in words.
- **Senders moved** out of `actions/notifications.ts` (`"use server"`) into
  `notifications/outbound.ts`: as action exports they were public POST endpoints with no
  session. They now report honest `sent`/`recipients`/`error`; coverage stamps `notifiedAt`
  only on a successful send and scopes to `IN_FLEET`.
- **Schedules** in `Setting` rows: `inventory_report_settings` (v1's key, `enabled` added),
  `report_schedule:<key>` for the rest. Bookkeeping in `report_sent:<key>`:
  `{ occurrence, previous, scheduled: RunRecord, manual: RunRecord }`.
- **Once per occurrence.** A report is due on the first poll at or after its hour on a
  matching Pacific day. The run claims the day ("2026-09-16") with one conditional `UPDATE …
  WHERE occurrence IS DISTINCT FROM`, so racing polls send once. A run that delivered to
  nobody it meant to (Resend refused, builder threw) releases the claim for the next poll;
  no recipients or nothing to report keeps it. A day with no poll is skipped, not caught up.
  Every other week counts 14 days from the last claimed occurrence.
- **Send now** runs a report immediately, recorded as `manual`, and does not move or cancel the
  scheduled send.

## Phase 3 — the reports and the cron (as built, `127f7c8`)

**Inventory report** — v1's snapshot ported to `lib/inventory/snapshot.ts` with v2's
definitions (fleet = `IN_FLEET`, custody = `OPEN_CHECKOUT`). Email: headline counts, rows
moving first then deepest stock up to "Rows in email", PDF of every row. Options on the
schedule (v1's): outlook days, rows, title, attach PDF. On 2026-09-16 with v1's 7-day
outlook: 852 units across 147 models (the snapshot, like v1's, skips models whose asset is
retired — 11 fleet units sit on such models), 457 in stock, 340 out, 47 committed and past
their ship date, 1 coming back, 59 overdue returns not counted, 60 on quotes.

**Depreciation report** — `lib/inventory/depreciation-report.ts`, every figure from
`bookValue` over `calculateDepreciatedValue` (which gained an as-of date; nothing else changed).

- Book value today; period expense = book at period start − book at period end, per unit, over
  today's fleet (a unit in service mid-period starts at cost; sold/retired units are absent).
- Period: last full calendar month for monthly; the last 1/7/14 whole days otherwise.
- Fully depreciated now, and within 90 days (in-service date + life × 30 days).
- Excluded, listed with the reason, never valued at zero: no purchase price, unscheduled
  method, no useful life.
- Email: stats, what is counted, top 15 families/models by cost + the rest rolled up + total,
  next-90-days list (12 + count), how the figures are made. PDF: all of it plus every fully
  depreciated and excluded unit. CSV: one row per valued unit, Pacific ISO dates,
  two-decimal amounts, `in_service_from` saying which date the schedule used.

**Figures on 2026-09-16** (863 fleet units): 745 valued, 118 excluded (all: no purchase
price). Cost $2,237,655.26; accumulated $1,607,266.05; net book value $630,389.38; August 2026
expense $26,118.49; 147 fully depreciated; 37 more within 90 days. Largest family: Lenovo
ThinkStation, 80 units, cost $463,609.30, book $82,537.52.

**What those figures rest on — measured, 2026-09-16:**

- 652 of 745 valued units have no received date; their schedule runs from purchase date.
- 743 of 745 use a 60-month life — the schema default, so for most models nobody chose it.
  (Fleet-wide: 859 of 863 on 60, 4 on 36; every asset is STRAIGHT_LINE.)
- 1 unit's model has a salvage value; the rest depreciate to zero.
- 72 of 745 have a purchase date equal to their record's creation date — possibly the entry
  date rather than the purchase date. Unverifiable from the data.
- Purchase dates are stored as Pacific midnights (07:00/08:00 UTC) for 2,152 of 2,635 units.
- `AssetUnit.loanAmount` is not read (it holds the whole lease on every unit).
- No purchase price appears to be a lease total copied per unit: 2 of the 392 units carrying a loan amount have
  price = loanAmount; the largest prices ($33,346 storage servers) are plausible hardware.

**`/api/cron/reports`** (POST, `Authorization: Bearer $CRON_SECRET`, fails closed):
once per Pacific day from 9:00 the **daily sweep** (raise in-app notifications, then personal
digests — not configurable, claimed like an occurrence), then every due report.
`?force=<key,…>|all|sweep` sends now without touching schedules. `/api/cron/daily-digest`
now runs only the sweep, so it cannot send the day at a glance twice.

**Crontab line** (for the coordinator to add; shares the crontab with v1):

```
# v2 — notifications: daily sweep + scheduled reports; cadence lives in Settings → Notifications
0 * * * * curl -s -X POST -H "Authorization: Bearer $(grep -m1 CRON_SECRET /home/docker/projects/vfxnow-amc-v2/.env | cut -d= -f2- | tr -d '"')" http://localhost:3001/api/cron/reports > /dev/null 2>&1
```

**Refresh from v1.** `scripts/refresh-from-v1.sh` replaces `notification_recipients` and
`inventory_report_settings` with v1's. It now carries v2's own rows
(`notification_prefs:*`, `report_schedule:*`, `report_sent:*`, restored "on conflict do
nothing") and re-applies what v1's recipient entries don't have — `name`, `coverage`,
`depreciation` — by address. An address only v2 has is not re-added; a schedule edited for
the inventory report in v2 reverts to v1's. Tested in a rolled-back transaction; the script
was not run.

## Phase 4 — audit and gallery (as built, `694ee46`)

- **Gallery**: `/dashboard/settings/notifications/templates?t=<key>`, admins only (STAFF are
  redirected; the action checks itself). 35 templates, sample data that reads as sample,
  sandboxed iframe, subject / goes to / sent when, plain-text part, "Send me a sample" to the
  signed-in admin through the redirect.
- **Approvals** respect the per-user Email switch for "Approvals waiting on you"
  (default on): muted people are told in-app only, and the confirmation says so. The
  preferences column is "Email"; the approvals row stays live without the digest.
- **Removed** `notifyInsights` and `insightsDigestEmail`: nothing called them in v1 or v2.
- Every staff/recipient email goes through `sendEmail`/`sendBatch`, in the layout, and fails
  soft (none throws into the action that triggered it).

## Verification (2026-09-16)

Real sends through Resend, all to the redirect: layout specimen ×2 (before and after the
logo), traffic ×2 (Send now, then the scheduled run), day at a glance ×1 (scheduled),
inventory ×1 and depreciation ×1 (`?force`, recipient row narrowed to one address each and
restored byte-for-byte), approval-needed sample ×1. Resend accepted each; whether the logo
renders in Gmail is for the owner's inbox to confirm.

Browser (geckodriver, admin): recipient add/label/tick/save/remove; Send now for coverage
("nothing to report") and traffic; gallery render and one sample. Cron: 401 without or with a
wrong secret; 400 on an unknown force key; three concurrent polls after a run sent nothing;
six racing claim UPDATEs on a scratch key took exactly one. The 51 in-app notifications the
test sweep raised were deleted. `report_sent:*` rows from those runs remain (they are true).

## Not done / open

- **APP_URL is `http://localhost:3001`**, so every button in every email opens only on this box.
- **v1 still sends the same reports** to the same lists from its own crontab. With the redirect
  removed and v2's cron running, recipients would get both.
- Overdue reminders and system alerts are unwired (and the reminder reads `Invoice.status =
  OVERDUE`, which v2 does not maintain).
- Tasks have no notification preference type.
- `sendBatch` falls back to per-message sends for layout mail; a partial failure reports the
  whole batch failed, so digest senders under-count `sent` in that case.
- The day at a glance's v1 cadence was Mon–Sat; v2's cadences have no "Mon–Sat", so it is daily.
