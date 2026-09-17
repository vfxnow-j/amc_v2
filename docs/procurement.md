# Procurement — specification

Asked for by the owner, 2026-09-16:

> under accounting, move purchase orders to "procurement" which will have POs baked in.
> Procurement can also carry the funding requests, and will be the main source of where POs
> also have their assets created.

## What it is for

Everything between "we need hardware" and "the hardware is on the shelf with a barcode":
the case for spending the money (a funding request), the order to the vendor (a purchase
order), and receiving it — which is where assets and units are born. Accounting keeps what
the books record about money already committed (invoices, payments, leases).

The trail is the point. A unit should answer, from its own record: which PO bought me,
which funding request justified that PO, and which loan paid for it. v1 has built that
trail since v2's restore (`AssetUnit.purchaseOrderId`, `PurchaseOrder.leaseId`, the funding
request joins); v2 does not model any of it, and every refresh from v1 drops it.

## Where it lives

A seventh rail cluster, **Procurement** (`PR`), placed before Accounting — the money leaves
through procurement before the books record it.

| Page | URL | From |
| --- | --- | --- |
| Overview *(Phase 5)* | `/dashboard/procurement` | new |
| Purchase orders | `/dashboard/purchase-orders` | moved from Accounting |
| Funding requests | `/dashboard/funding` | v1 `/dashboard/funding` |
| Vendors | `/dashboard/vendors` | moved from Inventory (owner, 2026-09-16) |
| Approvals *(Phase 6)* | `/dashboard/approvals` | new — shown only to approvers |

URLs stay on v1's paths, as everywhere else in the rail, so nothing that links to a PO or a
request breaks. Roles: `SUPER_ADMIN`, `ADMIN`, `STAFF` since Phase 6 (STAFF raise and work on
their own drafts; see "Phase 6 — as built"). VIEWER has no rail entry.

## The data (ported from v1 unchanged)

Ported column-for-column so a refresh from v1 **keeps** these rows rather than dropping
them — the tables and columns exist in v1, so matching names are all the refresh needs.

- `FundingRequest` — request, purpose, equipment & customer, financing terms, payback plan,
  risk, three approvers, lifecycle stamps; `leaseId` for the loan that funded it.
- `FundingRequestItem` — itemised equipment.
- Joins: `_FundingRequestPurchaseOrders`, `_FundingRequestReservations` (the client quote or
  order that justifies the spend).
- `PurchaseOrder.leaseId` — the loan financing the PO; received units inherit it.
- `AssetUnit.purchaseOrderId` — the PO a unit was received against.
- Enums `FundingRequestStatus`, `FundingPurchaseType`, `CustomerCommitment`.

Applied by hand (`prisma/manual/2026-09-16-procurement.sql`), additive only.

### Lifecycle

`DRAFT → SUBMITTED → APPROVED | DECLINED → FUNDED → FULFILLED`, `CANCELLED` from any open
state; `SUBMITTED → DRAFT` on revise. A PO is `DRAFT → SUBMITTED → PARTIAL → RECEIVED`, or
`CANCELLED`.

## Build phases

1. **Cluster and schema.** The Procurement cluster with POs moved into it; the funding
   request pages reserved in the rail; the schema above applied and generated. *(Built
   2026-09-16.)*
2. **Funding requests.** *(Built 2026-09-16, `0f417e4`.)* Port `lib/actions/funding-requests.ts`, `lib/utils/funding.ts` and
   `lib/funding/lease-sync.ts` from v1. List, record, create and edit. Lifecycle controls on
   the record (submit, revise, approve with the three sign-offs, decline with reason, mark
   funded against a lease, mark fulfilled, cancel). Attach POs and client orders as evidence;
   show the payback markers v1 computes, labelled as the requester's estimates. The
   `FUNDING_REQUEST` document v1 raises.
3. **Purchase orders raised in v2.** *(Built 2026-09-16, `92c7bc8`.)* Today receiving works and raising does not. Create and
   edit forms over the ported actions; submit, revise, cancel on the record. Assign a PO to a
   lease and to funding requests (v1's `assignPurchaseOrderToLease`,
   `assignPurchaseOrderToFundingRequest`). "Raise a PO" from an approved funding request, and
   "start a funding request" from a PO (v1's `getFundingRequestPrefillFromPO`). Receiving
   stamps `purchaseOrderId` and inherits the lease onto every unit, as v1 does.
4. **Receiving is where assets are born.** *(Built 2026-09-16, `5cb428e`.)* The receive flow becomes the main way a model and
   its units enter the fleet: create a model inline with its build (`AssetComponent`), bulk
   barcodes and serials, a location per unit. The unit and asset records show the trail
   (PO → funding request → lease). Inventory's register action points at Procurement as the
   primary route; hand registration stays for units that did not come through a PO.
5. **Overview.** *(Built 2026-09-16, `551a764`.)* `/dashboard/procurement`: committed spend (submitted, not yet received),
   what is awaiting receipt and what is past its expected date, the funding pipeline by
   status, and spend by vendor. Every figure from stored rows; nothing projected that the
   data cannot support.
6. **Approvals — raise, review, approve or deny.** *(Built 2026-09-16 — see "Phase 6 — as
   built" below.)* Asked for by the owner 2026-09-16:

   > a flow … that allows a level of a user to raise orders/quotes/POs etc, which then get
   > sent to a super admin (with an approve capability) and allows me to approve, or others I
   > identify. Roles matter, I don't want someone who doesn't know the system to blow it up
   > and have nice controls. This … would then need to spawn a level of approval emails so
   > things can be seen, i.e request for purchase — I review, see what its for, approve or
   > deny — but same level for quotes, etc. depending on role.

   One approval mechanism, not one per record type. A record that needs approval (purchase
   order, funding request, client quote/order — more later) is **raised** by someone allowed
   to raise it, **held** in a pending state it cannot leave on its own (a held PO cannot be
   sent to the vendor, a held quote cannot be sent to the client), and **decided** by an
   approver: approve, or deny with a reason that goes back to the requester. Every decision is
   recorded (who, when, what they saw, why) and cannot be edited afterwards. Editing an
   approved record in a way that changes money sends it back for approval.

   - **Approvers** are the super admin plus people the owner names — a per-user capability,
     scoped by record type, not a new role. Nobody approves their own request.
   - **Notifications**: a request raises an in-app notification and an email to the approvers
     for that type, carrying enough to decide from the email (what, for whom, how much, why)
     and a link to the record; the decision notifies the requester the same way. Email in
     v2 is redirected (`lib/email/send.ts`) until go-live, so this is built and proven
     against the redirect, not real inboxes.
   - **An approvals queue** — one screen listing everything waiting on the signed-in
     approver, across types, oldest first.
   - **Existing hold to reconcile**: orders already have `approveOrder`, and a quote to an
     unverified prospect is already held (`clients.prospectAt`). Phase 6 folds those in rather
     than adding a second gate beside them.

   Decisions for the owner before this is built are listed under "Phase 6 — open calls".

## Rules

- **Wire, do not rewrite.** Ported actions hold the transactions and guards; add the v2
  outcome layer and the form (the `lib/actions/accounts.ts` pattern).
- **Every new server action checks role.** `agreement.ts` shipped with none.
- **Do not repeat the `loanAmount` fault.** v1's lease sync stamps loan fields per unit;
  `AssetUnit.loanAmount` already holds the whole lease copied onto every unit (data gap 7,
  a 432× overstatement if summed). Nothing built here may sum it or write a lease total onto
  a unit.
- **Outbound email is off in v2.** v1 notifies accounting on submit; port the call, confirm
  it refuses cleanly rather than sending.
- **No fabricated figures.** A payback period on a request is the requester's estimate and
  says so; it is not a measured return.
- **Deleting is not offered** unless the owner asks — the data is real.

## Data

Until the next refresh from v1, v2 has the tables but none of v1's rows: no funding
requests (v1 has `FR-2026-00001`), and no unit knows its PO. A refresh after Phase 1 brings
both across, because the columns now exist to receive them.

## Small calls still open (defaults applied until the owner says otherwise)

- **Who raises a PO or a request** — settled by Phase 6: STAFF and up, held for approval
  unless the raiser approves that type. Procurement is back in STAFF's rail, Vendors with it.
- **Accounting's view of POs** — default: none. The payable side of a received PO (a vendor
  bill) is not modelled in either version.

## Phase 6 — decided by the owner, 2026-09-16

- **Who raises.** STAFF and up may raise purchase orders, funding requests and quotes.
  Procurement opens to STAFF in the rail (which returns Vendors to them); VIEWER still reads
  only.
- **What is held.** Everything raised by someone who is not an approver for that type is held
  until approved. An approver's own record goes straight through.
- **Approvers.** The super admin always. Beyond that, the owner tags individual users as
  approvers ("say in accounting") — a per-user capability set in Settings → Users, scoped to
  the record types that person approves. One approval is enough. Nobody approves a record they
  raised.
- **Email.** Built fully and sent through v2's existing redirect to a test inbox until
  go-live; in-app notifications alongside.

Build after Phases 2–4 land: it gates the submit/send paths those phases wire.

## Phase 6 — as built (2026-09-16)

Commits: `0298ff6` schema and refresh carry · `9371e76` the mechanism and purchase orders ·
`acf8ac7` funding requests · `a5a5022` quotes · `1765ddd` the queue, approver tags and the
rail. Every approver scope is empty on this date — the owner tags people.

**One mechanism.** `lib/approvals/core.ts` owns it; `lib/approvals/actions.ts` is the
browser-facing surface (decide, set scopes); `lib/approvals/labels.ts` the words.

- **Data** (`prisma/manual/2026-09-16-approvals.sql`, v2-only, carried by the refresh):
  `approval_requests` — one ask and its answer: record type + id (not a foreign key, so the
  history outlives a record a refresh deletes) + a label snapshot, status
  `PENDING | APPROVED | DENIED | SUPERSEDED`, `automatic`, requester and decider (user id
  *and* name snapshot), amount at request and at decision, the note that says why it was
  asked, the reason. `user_approval_scopes` — a row per user per record type, with who
  granted it. `purchase_orders.raisedById` — whose draft a PO is. No enum value was added to
  any table v1 also has: "held" is not a status, it is the approval standing.
- **Cleared** means the latest non-superseded ask is APPROVED *at the amount the record
  carries now* (PO total, amount requested, order total). A total that moved is not the
  total anybody approved, whichever write path moved it.
- **The gate** (`releaseGate`) is called in the ported transitions themselves, because every
  `"use server"` export is reachable by POST: `submitPurchaseOrder`, `receivePurchaseOrder`
  (and `receivePO`), `markFundingRequestFunded`, `generateQuoteToken` (so
  `sendQuoteLinkEmail` too), `markQuoteSent`, `approveReservation`, and the portal's
  `approveQuote`. The screens call it first with `raise`, so pressing Submit / Send quote /
  Mark approved *asks*; the ported actions only refuse. Submitting a funding request asks
  from inside `submitFundingRequest`, since SUBMITTED is already the waiting state.
- **An approver's own act goes straight through**, recorded as an `automatic` APPROVED row
  (requester = decider) so the trail says who put the money through at what figure. An
  approver pressing the release button on exactly the figure someone else asked about is
  recorded as a real decision on that ask. Minting a quote link when the send dialog opens
  never decides or raises anything.
- **Deciding** refuses: the requester ("another approver has to decide it"), anyone
  without the scope, a deny with no reason, an ask already decided (decisions are written
  only `where status = PENDING`, so never twice), a closed record, and an ask whose figure
  moved since it was asked (renewed at today's figure instead). A funding request's
  SUBMITTED → APPROVED/DECLINED is written in the same transaction as the decision.
- **Money changes** (`noteMoneyChange`, from the PO and funding edit paths): a waiting ask
  is renewed in the original requester's name; an approved record — or one released
  before approvals existed — goes back for approval unless the editor approves that type;
  an APPROVED funding request returns to SUBMITTED. A FUNDED request's amount can only be
  changed by an approver. Quotes rely on the gate: their money moves through a dozen line,
  shipping and billing paths, and the next send, commit or portal acceptance is refused
  until the new figure is approved.
- **Notifications**: an in-app `APPROVAL_REQUEST` row and an email to every approver for
  the type (not the requester) with the record, party, amount, why, the lines and who
  asked; the decision goes back to the requester the same way. Email goes through
  `sendBatch` (key check + test redirect). With no `RESEND_API_KEY` the action still
  succeeds and names who was told in the app and who would have been emailed. Approvers
  are addressed by capability, not by a notification opt-in.
- **Pre-existing records.** A record not yet released is judged when it is released (35
  DRAFT/REVISION orders, 2 DRAFT POs on 2026-09-16). A record released before this landed
  has no history and is not held at the later steps (8 SUBMITTED POs for receiving, 27
  QUOTE_SENT orders for committing or portal acceptance) until something raises an ask on
  it. A funding request submitted before this (v1's `FR-2026-00001` after a refresh) is
  decided from its record: the ask is created in its original requester's name and decided
  in the same step.
- **Screens.** An Approval card on the PO, funding request and order records (pending by
  whom, approved by whom and when, denied by whom and why, and the whole trail); approve
  and deny on the card (on a funding request, in its lifecycle). `/dashboard/approvals`
  lists everything waiting on the signed-in approver across types, oldest first, with the
  decision inline. The rail shows it only to approvers (`NavPage.approversOnly`, filtered
  per user by the shell, which also puts the waiting count on it). Settings → Users → an
  account has an Approvals card (super admin edits; SUPER_ADMIN reads "Always an
  approver"), and the Users list an Approves column.

### Who may do what, as built

| Action | Before Phase 6 | Now |
| --- | --- | --- |
| Raise a PO / funding request | ADMIN+ | STAFF+ |
| Edit a PO / funding request | ADMIN+ (any status bar canceled/closed) | ADMIN+ as before; STAFF their own drafts |
| Submit a PO / funding request | ADMIN+ | ADMIN+, or STAFF their own — held unless the submitter approves the type |
| Revise a PO / pull back a request | ADMIN+ | ADMIN+, or the STAFF member who raised it |
| Approve / decline a funding request | ADMIN+, three typed names | An approver for funding requests who did not ask; recorded from the session |
| Approve / deny a PO or quote | — | An approver for the type who did not ask |
| Tag approvers | — | SUPER_ADMIN only |
| Receive against a PO | ADMIN+ | STAFF+, against a cleared PO; creating a new model while receiving stays ADMIN+ |
| Cancel a PO / request; lease; mark funded / fulfilled; attach evidence | ADMIN+ | ADMIN+ (unchanged); marking funded is also gated on approval |
| Send a quote / mint its link / mark it sent / commit the order | STAFF+ (prospect hold) | STAFF+, held unless cleared or the sender approves quotes; the prospect hold folded into the same gate, now also on minting a link |
| Procurement rail, Overview | ADMIN+ | STAFF+ |

`lib/procurement/access.ts` holds the role and ownership rules; `lib/procurement/receive-gate.ts`
exports `receivingRefusal(poId, viewer)` — the one read-only answer to "may this person
receive against this PO now" (role, state, approval) for anything that offers receiving.

Not done: the funding request PDF still prints the paper form's three sign-off lines blank
rather than the recorded approver. Everything after APPROVED on an order (preparing,
shipping, activating) requires APPROVED, which only `approveReservation` and the portal's
`approveQuote` reach — both gated. A portal link minted for a DRAFT order *before* this
landed can still be accepted, since that order has no approval history.
