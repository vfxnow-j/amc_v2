# Portal API — the contract AMC serves to the client portal

**Status:** specified by the owner on 2026-09-26. **Not built.** It's queued after the v1 port (Flow and the orders
pull), and before hosting goes live.

The client portal runs on its **own external server**, which is being built separately. AMC (v2) is the system of
record: it is the only authority on price, orders and availability. The portal reads and writes through this API.
Updates reach the portal by **signed webhooks, with polling as the safety net**.

## Transport and auth (owner)

- Every endpoint lives under **`/v1`**.
- The API is reachable **over WireGuard only**. It is not exposed on the public internet.
- Authentication is by **service token**, issued from AMC's Settings → API keys. Today a key carries a staff
  `UserRole`, so a portal token needs its own **scope** limited to these endpoints.

## Endpoints (owner's specification, verbatim in substance)

### 1. Catalog
- `GET /offers?solution=&category=&software=` returns offers with product details (specs, category, and software
  compatibility for filtering), the allowed solution and term combinations, and price **ranges** that don't depend
  on the account.
- `GET /public/price-ranges` returns ranges only, for the public site. **It must never include exact prices.**

### 2. Capacity
- `GET /capacity?pool=` returns private-cloud capacity in the same shape as availability:
  - `available_now`, `total`, `reserved`, `tentative`
  - `next_available { date, status: expected | confirmed | none }`
  - `demand: normal | high`
- `next_available` is worked out as return date + transit + a refurb buffer per category.
  **Overdue returns are never promised.**

### 3. Accounts
- `PUT /accounts/{portal_account_id}` creates or updates company, verification level, credit tier and sites. AMC
  uses these to decide which terms and prices an account gets.

### 4. Pricing
- `POST /rates/quote` returns account-specific prices from the existing rate engine, **including FLOW (12–48
  months)**.
- Per line it returns `unit_price`, `line_total`, `demand`, `allowed` and `reason`.
- For the quote as a whole it returns `rate_id`, `valid_until` and `total`.
- **AMC is the only authority on price.**

### 5. Holds
- `POST /holds` creates a tentative hold with an expiry. It returns `hold_id` plus, per line, `held_qty` and
  `overage`.
- `DELETE /holds/{id}` releases it.

### 6. Orders
- `POST /orders` places an order. It **requires an `Idempotency-Key`**, which the portal sets to its
  `portal_quote_id`.
- `GET /orders/{id}` and `GET /accounts/{id}/orders` read orders back.
- **AMC is the system of record for orders.**

### 7. Change requests
- `POST /orders/{id}/change-requests` takes `type: extend | scale | return | swap`. It returns either a priced
  change or a confirmation.

### 8. Customer environment
- `GET /accounts/{id}/environment` returns:
  - on-prem assets: serial, config, site, `term_end`;
  - cloud resources: `resource_id`, access details, usage summary.

### 9. Billing
- `GET /accounts/{id}/invoices` and `GET /invoices/{id}/pdf`, proxied from accounting.

### 10. Signed webhooks
- **Events:** `availability.changed`, `capacity.changed`, `hold.expired`, `hold.overage`, `order.status_changed`,
  `asset.updated`, `return.checked_in`, `invoice.issued`, `invoice.paid`, `usage.recorded`.
- **Signing:** HMAC-SHA256 of `timestamp + "." + raw_body`, sent in the `X-VFX-Event-Id`, `X-VFX-Timestamp` and
  `X-VFX-Signature` headers.
- **Delivery:** retries with exponential backoff for 24h.

## What v2 already has (checked 2026-09-26)

- **API keys:** an `ApiKey` model (hashed, with prefix, expiry and last-used date) and a Settings → API keys screen
  (`src/components/settings/api-key-console.tsx`, `src/lib/actions/api-keys.ts`).
- **Key authentication:** `src/lib/api-auth.ts`.
- **Existing `/api/v1` routes:** leads, and service QC runs.
- **Flow pricing:** the engine lands with the Flow port (`src/lib/pricing/flow*.ts`, `docs/superpowers/plans/2026-09-26-flow-order-type.md`).
  `/rates/quote` for FLOW will call it.

## Gaps to design before building

These are open questions for the owner or the portal builder. Settle them in the implementation plan.

- **Token scope:** a portal token must not be a staff role. It needs scoped keys (for example `portal:read`,
  `portal:write`) and must never return cost, basis, margin, lease or other internal economics.
- **Account mapping:** how `portal_account_id` maps to AMC `Client` (new column or link table). Verification level,
  credit tier and sites need somewhere to live; none of them exist in v2 today.
- **Offers:** v2 has assets, packages and a rate card, but no "offer" or "solution" concept. Decide what an offer is,
  and which assets are opted in to the portal.
- **Account-specific pricing:** credit tier → terms and prices is a new rule set. The owner needs to define the tiers.
- **Holds:** there's no hold or tentative-reservation model today. Decide how a hold relates to a draft or quote
  order, and how it expires.
- **Capacity pools:** private-cloud capacity has no model in v2 yet. v2 keeps cloud handling light; cloud is a
  separate system to integrate with later.
- **Next-available:** needs transit days (v2's shipping speed has assumed transit days) and a refurb buffer per
  category, which is a new setting.
- **Environment:** usage summary and cloud access details have no source in v2 yet.
- **Billing proxy:** accounting is QuickBooks, which is not integrated yet. Until it is, invoices come from v2's own
  invoices.
- **Webhooks:** they need an outbox table, a signing secret per portal, a retry worker (v2 has a cron) and an event
  log.
- **Transport:** WireGuard exists only once v2 is hosted. That's the owner's roadmap step 5.
