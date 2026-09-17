# Client portal — specification (queued, not built)

Asked for by the owner, 2026-09-16:

> I want the portal, and eventually will need to integrate it to a site as we have a point
> system and I'd want that tracked, it would be login based, they see their orders, can
> request against actual inventory available, book — we need to approve (it is self serve
> combo really) and when we give it a green, customer sees a Order Confirmed message, all
> goes in the general pipeline, orders, prepare, check out, deliver. They can see that process
> on the portal cleanly, see what they are charged per month, eventually we'll allow it for
> payments with stripe integration.

Queued behind the notifications revamp (`docs/notifications.md`). Nothing here is built.

## What it is for

A client's own window onto the business: sign in, see their orders and where each one is,
ask for hardware that is actually available, and see what they are paying. Self-serve on the
asking side, staff-approved on the committing side. Nothing a client does commits stock,
money or a price without a staff approval.

## What exists today

- `/quote/[token]` — a tokenised, sign-in-free page for one quote: approve, request changes,
  deny. Fixed colours, not themed. The token is the authorization.
- `/requirements/[token]` — the requirements/agreement portal, also tokenised.
- Orders already run the pipeline the portal would show: `DRAFT → QUOTE_SENT → APPROVED →
  PREPARING → SHIPPED → ACTIVE → COMPLETED`, with `REVISION`, `CANCELLED`, `LOST` branches
  (`lib/orders/lifecycle.ts`).
- Phase 6 approvals (`docs/procurement.md`) already hold a quote until it is cleared — a
  portal booking request plugs into that gate rather than adding a new one.
- **Not modelled anywhere, v1 or v2:** client logins, a points system, Stripe.

## Build phases — each confirmed before the next

1. **Client sign-in.** A client-side identity separate from staff `User` (a contact of a
   `Client` account, invited by staff, email + password or magic link, MFA optional). Staff
   sessions and client sessions never share a cookie or a route tree (`/portal/**`). Every
   portal read is scoped to the signed-in contact's account server-side.
2. **My orders.** List and record for the account's orders: the stage timeline in plain
   words ("Order confirmed", "Being prepared", "Out for delivery", "With you", "Returned"),
   lines, dates, documents (quote, agreement, invoices). The existing quote approval moves in
   here for signed-in clients; the token link keeps working for everyone else.
3. **What I'm charged.** Per-order and account-level: current recurring charge per billing
   cycle, invoices and their status, next billing date. Must use the one billing definition
   (`lib/utils/billing.ts`, `runBillingCycle`) — and note no stored column holds "one cycle's
   cost"; it is derived. No figure the data cannot prove.
4. **Request / book against available inventory.** Browse the catalog a client is allowed to
   see (models, builds, rates from their rate card), pick dates, see real availability for
   those dates (the same availability check the order builder uses), and submit. It lands as
   a `DRAFT` order in the normal pipeline, raised by the portal, held behind the Phase 6
   quote approval. Staff review, adjust, approve; the client then sees **Order confirmed**
   and a notification/email. Stock is not reserved until approved — say so on the page.
5. **Points.** Track the site's point system against portal activity (bookings, spend).
   Needs the owner's definition first: what earns points, what they are worth, whether they
   redeem against orders, and which system is the source of truth (the website or v2).
6. **Website integration.** The portal (or its booking and points pieces) embedded in or
   linked from the public site, with single sign-on if the site has accounts.
7. **Payments (Stripe).** Pay invoices and deposits online; Stripe customer per account,
   webhooks reconcile `Payment` rows, QuickBooks sync stays the books' source. Separate
   secrets for v2; test mode until go-live.

## Rules

- **The client can ask; only staff commit.** No portal action changes stock, price or order
  stage past DRAFT/request without a staff approval.
- **Scope every read to the account server-side.** A portal page never trusts an id from the
  URL without checking it belongs to the signed-in contact's client.
- **No internal data leaks:** cost prices, margins, other clients, staff notes, tracker
  temperature, loan data — none of it reaches a portal response, not just the rendered page.
- **Email** goes through `sendEmail` and the test redirect until go-live.
- **No fabricated figures** — "charged per month" is only shown where the order's billing
  cadence makes it true.

## Open calls for the owner (before Phase 1)

- Who gets a login: every contact on an account, or only ones staff invite?
- Magic link or password (or both)? MFA for clients?
- Which catalog a client can book from — everything rentable, or a per-account list?
- Can a client cancel or change a request before approval? After?
- Points: definitions above, and where the site's points live today.
- Domain: `portal.<site>` or a path on the existing app host?
