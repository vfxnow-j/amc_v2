# Portal API — the contract AMC serves to the client portal

**Status (2026-09-26):** Phase 1 and Phase 2 are built and live on AMC's dev server. This is the contract as built, and
it's what the portal builds against. The portal keeps its own copy (`docs/inventory-api-v1.md` in the portal repo).
The original owner spec and the design gaps are in `docs/portal-api-plan.md`.

AMC (v2) is the system of record: it's the only authority on price, availability and orders. The portal reads and
writes through this API. **There are no webhooks for now: the portal polls, about once a minute.**

## Transport and auth

- **Base URL:** `http://10.8.0.2:3002/v1`, over WireGuard only. cp01 is the hub at `10.8.0.1`. AMC dials out as
  `10.8.0.2`, and AMC's tunnel firewall opens only TCP 3002.
- **The relay:** `scripts/portal-relay.mjs` listens on `10.8.0.2:3002`. It forwards `/v1/` only, writes the TCP
  socket's address to `x-real-ip`, and stamps `x-portal-relay` with `PORTAL_RELAY_SECRET`. AMC trusts the caller's
  address only when the stamp matches, so a client's address allowlist is real. It stands in until hosting puts a
  reverse proxy in front of v2.
- **Auth:** `Authorization: Bearer vfxp_…`, one token per portal client. Tokens are issued in Settings → API keys →
  Portal clients, shown once, and stored hashed. They carry scopes, never a staff role.
- **Scopes:**

  | Scope | Covers |
  |---|---|
  | `portal:read` | catalog, capacity, accounts, orders |
  | `portal:quote` | pricing |
  | `portal:write` | accounts, orders |
  | `portal:billing` | billing (later) |

## Conventions

- **Success:** `{ "data": … }`. A paged list adds `"next_cursor"`, which is null at the end.
- **Errors:** `{ "error": "<sentence>", "code": "<code>", "details"?: … }`. The portal branches on `code`. The codes
  are: `unauthorized`, `forbidden_ip`, `ip_unverifiable`, `insufficient_scope`, `rate_limited`, `bad_request`,
  `validation_failed` (details `[{path, message}]`), `not_found`, `conflict`, `rate_expired`, `rate_mismatch`,
  `idempotency_key_required`, `idempotency_mismatch` and `internal_error`.
- **Money:** USD, as JSON numbers rounded to cents.
- **Dates and times:** dates are `YYYY-MM-DD`, and timestamps are ISO 8601 UTC. "Today" means today in Los Angeles.
- **Paging:** `?cursor=&limit=` (1–200, default 50).
- **Solutions:** `rental`, `flow` (12–48 months) and `sale`. Rent-to-own is staff-only and never offered here.

## Endpoints

### Catalog and stock

`GET /health` confirms the token works.

`GET /offers?solution=&category=&software=` returns the published products.
- **Per product:** `{ id, slug, kind, title, blurb, category, product, items, pool, specs, software, solutions,
  price_ranges, availability, images }`.
- **Solutions:** a solution is listed only if at least one unit is ticked for it on the unit screen (Offered as:
  Rental / Sale / Flow).
- **`price_ranges`:** bands, never exact prices. They're per month, except for sale, which is `per: "one_time"`.
- **`availability.{rental|flow|sale}`:** `{ available_now, next_available { date, status: confirmed | expected |
  none }, demand: normal | high }`.
  - Counts only units ticked for that solution, and never more than the product has free overall.
  - `available_now` is null when there's nothing physical behind the offer (services only).
- **`images`:** `[{ id, version, alt, width, height }]` in display order.

`GET /images/{id}?v={version}` returns `image/webp`.
- Images are uploaded in Settings → Portal offers and re-encoded by AMC: JPEG, PNG or WebP only, metadata stripped.
- An (id, version) pair never changes content, so the portal caches it forever.
- It returns 404 for an unpublished product or a stale version.

`GET /public/price-ranges` returns bands only, for the website.

`GET /capacity?pool=` returns private-cloud pool capacity.

### Accounts

`PUT /accounts/{portal_account_id}` takes `{ company, contact_name?, contact_email?, contact_phone?,
verification_level?, credit_tier?, sites? }`.
- **Verification levels:** `none`, `id_verified` or `agreement_and_coi`.
- **Sites:** `[{ external_site_id, label, address?, is_default }]`. The list replaces the account's sites, and
  exactly one must be the default.
- **First PUT:** creates a new AMC client. It's never auto-merged with an existing one; staff re-link if needed.
- **Response:** `{ portal_account_id, verification_level, credit_tier, sites, client_linked }`. No AMC ids are
  returned.

### Pricing

`POST /rates/quote` takes `{ account_id, window { start, end? }, lines [{ offer_id, qty, solution, term_months? }] }`
and returns `{ rate_id, valid_until, total, lines [{ …, unit_price, line_total, one_time, demand, allowed, reason }] }`.
- **Window:** rental needs `window.end`. Sale and Flow don't.
- **Prices:** rental `unit_price` is per unit per month. Flow's is the first month's payment ÷ qty. Sale's is the
  one-time price per unit.
- **Stock:** checked twice. Once per solution, counting only ticked units. Once per product across all lines,
  because a unit ticked for both rental and Flow is still one unit.
- **Validity:** 7 days, or 72 hours if any line is Flow.
- **Refusal reasons:** `offer_not_visible`, `solution_not_allowed`, `term_not_allowed`, `verification_required`,
  `credit_limit`, `unpriced` and `insufficient_capacity`. A priced line can still be refused, so the portal should
  gate on `allowed`.

### Orders

`POST /orders` takes `{ rate_id, account_id, site_id, po_number?, notes? }` plus an `Idempotency-Key` header (the
portal's quote id).
- **The order is exactly its rate.** Dates, lines and prices in the body are refused. To change them, re-quote.
- **AMC re-checks:** it re-runs the stored quote request with today's price, stock and account standing, and every
  line must still be allowed at the same price.
- **All or nothing:** an order is one solution, and one term for Flow.
- **Responses:**

  | Case | Status and code |
  |---|---|
  | Placed | `201` with the order |
  | Same key and body again | `200` with the same order |
  | Same key, different body | `422 idempotency_mismatch` |
  | No key | `400 idempotency_key_required` |
  | Rate expired | `409 rate_expired` |
  | Rate was for another account, or already ordered | `409 rate_mismatch` |
  | Price moved | `409 rate_mismatch` |
  | Stock gone, a line refused, mixed solutions, or the start date has passed | `409 conflict` |
  | Unknown site or account | `404` |

- **What AMC creates:** a `PRT-YYYY-NNNNN` order, through the same code a staff order uses.
  - An `id_verified` or better account's order arrives **approved**. It holds its stock and staff are notified.
  - Any other account's order arrives as **pending review**. It's a draft flagged for staff and holds nothing until
    approved. The rule lives in one place: `arrivesApproved` in `src/lib/portal/orders.ts`.

**Reads:**
- `GET /orders/{order_number}` returns one order.
- `GET /accounts/{portal_account_id}/orders` lists an account's orders.
- `GET /orders?updated_since=<ISO>&cursor=&limit=` is one feed across all accounts, oldest change first. Follow
  `next_cursor`, then poll again from the last `updated_at`.

The portal sees every order it placed, plus the linked client's other orders once they're past draft.

**An order:** `{ order_number, portal_quote_id, portal_account_id, status, solution, start_date, end_date, total,
currency, site_id, po_number, lines [{ name, qty }], created_at, updated_at }`.
- **Status:** `pending_review`, `approved`, `preparing`, `shipped`, `active`, `completed` or `cancelled`.
- **`total`:** what the customer accepted (the rate's total).
- **`end_date`:** null for a sale.

## Later

- **Portal access for existing clients:** staff invite a client who came in by phone, and the invite links the
  portal account to the existing client.
- **Customer environment:** on-prem assets and cloud resources.
- **Billing:** invoices, and invoice PDFs.
- **Change requests:** extend, scale, return and swap.
- **Webhooks:** only if one-minute polling isn't enough.
- **Per-customer discounts:** on week and month rates, set in AMC.
- **Configuration limits:** for configurable products.
