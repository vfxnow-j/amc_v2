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

URLs stay on v1's paths, as everywhere else in the rail, so nothing that links to a PO or a
request breaks. Roles: `SUPER_ADMIN`, `ADMIN` — what Accounting had. Whether STAFF should
raise POs is an open call (below).

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
2. **Funding requests.** Port `lib/actions/funding-requests.ts`, `lib/utils/funding.ts` and
   `lib/funding/lease-sync.ts` from v1. List, record, create and edit. Lifecycle controls on
   the record (submit, revise, approve with the three sign-offs, decline with reason, mark
   funded against a lease, mark fulfilled, cancel). Attach POs and client orders as evidence;
   show the payback markers v1 computes, labelled as the requester's estimates. The
   `FUNDING_REQUEST` document v1 raises.
3. **Purchase orders raised in v2.** Today receiving works and raising does not. Create and
   edit forms over the ported actions; submit, revise, cancel on the record. Assign a PO to a
   lease and to funding requests (v1's `assignPurchaseOrderToLease`,
   `assignPurchaseOrderToFundingRequest`). "Raise a PO" from an approved funding request, and
   "start a funding request" from a PO (v1's `getFundingRequestPrefillFromPO`). Receiving
   stamps `purchaseOrderId` and inherits the lease onto every unit, as v1 does.
4. **Receiving is where assets are born.** The receive flow becomes the main way a model and
   its units enter the fleet: create a model inline with its build (`AssetComponent`), bulk
   barcodes and serials, a location per unit. The unit and asset records show the trail
   (PO → funding request → lease). Inventory's register action points at Procurement as the
   primary route; hand registration stays for units that did not come through a PO.
5. **Overview.** `/dashboard/procurement`: committed spend (submitted, not yet received),
   what is awaiting receipt and what is past its expected date, the funding pipeline by
   status, and spend by vendor. Every figure from stored rows; nothing projected that the
   data cannot support.

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

- **Vendors** stay in Inventory. They arguably belong in Procurement; not moved without asking.
- **Who raises a PO or a request** — default: SUPER_ADMIN and ADMIN only, as under Accounting.
  v1 lets any editor (STAFF included) write both.
- **Accounting's view of POs** — default: none. The payable side of a received PO (a vendor
  bill) is not modelled in either version.
