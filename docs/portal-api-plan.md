# Portal API — implementation plan (drafted 2026-09-26)

This plan builds the owner's binding contract in `docs/portal-api.md`. It was drafted by a read-only planning pass
while the Flow port was running. **Nothing is built yet**, and Phase 1 waits on the owner decisions at the end.

The pass turned up two security findings. Both were checked by hand on 2026-09-26 and belong to the roadmap's
security check:

- **Leads API:** `GET /api/v1/leads` accepts **any** valid API key, whatever its role
  (`authorizeLeadApi(..., { editor: false })`). So a portal token must never live in `ApiKey`.
- **Status history:** `recordStatusChange` (`src/lib/actions/status-history.ts`) is a `'use server'` export with
  **no auth check**. Any signed-in user can write status history.

## 0. What exists

**Framework and routing**
- The app runs Next 16.2.12. Route-handler `params` is a Promise, and `RouteContext<'/…'>` is global.
- `src/proxy.ts` replaces middleware. Its matcher excludes `api/v1`, and `KEYED_PREFIXES` skips the session gate.
- The contract's `/v1/*` paths will be served by handlers at `src/app/api/v1/portal/**`, through a `rewrites()`
  entry in `next.config.ts` (`/v1/:path*` → `/api/v1/portal/:path*`). The proxy runs before rewrites, so its matcher
  must also exclude `v1`.

**API auth** (`src/lib/api-auth.ts`)
- It looks up the SHA-256 hash of the bearer token in `ApiKey` and gets back a **staff `UserRole`**.
- Rate limiting is `checkRateLimit`, held in memory.
- Errors come back as `{error}`, results as `{data}` or `{data, pagination}`.
- `logAudit` also works from route handlers.

**Writes are session-bound**
- The order actions are `'use server'` + `requireEditor()`: `createReservation`, `extendOrder`, the moves in
  `order-stage.ts`, `swapReservationItemUnit` and `createInvoice`.
- A route that authenticates by token can't call them. Portal writes need session-free "core" functions, following
  the pattern of `lib/leads/api.ts`.

**Availability**
- The shared rules are in `lib/inventory/availability.ts`.
- Availability over a date window is `availabilityFor` in `lib/queries/order-builder.ts`. It takes the fleet, minus
  `HOLDS_STOCK` order quantities, with a `freeFrom` date.
- It does **not** subtract units in maintenance, or units checked out with no order.
- Outbound transit days are in `SPEED` in `lib/orders/shipping.ts`.

**Pricing**
- Rentals take the asset's own rates through `deriveRentalRate`, then `calculatePeriods` and `computeItemSubtotal`.
- The `RateCard` model is **not** used by pricing.
- Flow prices through `priceFlowLines`, `flowConfigFromSettings`, `flowClientQuote`, `loadFlowBases` and
  `loadFlowDefaults`.
- `FLOW_TERMS` is 12/24/36/48/60 months. The portal is limited to 12–48.

**Data (2026-09-26)**
- About 230 assets and 381 workstation units. Only about 90 assets have a monthly rate.
- **`Asset.specs` is empty on every asset**, and there's no software-compatibility data.
- There are 2 package templates, 62 cloud products and 99 clients. None has `customPricing`.
- Nothing models sites, verification level or credit tier. The Client Tracker's A/B/C tier ranks client value; it
  isn't credit.

**v1 sync risk**
- On a unique-key clash the sync lets v1 win. A reservation that v2 created, whose number v1 later issues, **is
  deleted**.
- So portal orders can't go live while the v1 sync runs, unless they use their own number prefix.

**Cron**
- There's one crontab line: `/api/cron/reports`, hourly. Webhooks need their own line, every minute.

**Reusable**
- `renderInvoicePdf(id)` returns a Buffer and doesn't depend on a session.
- `getClientEnvironment` describes kit the client owns elsewhere. The contract's "on-prem assets" means our units at
  their sites, so it doesn't fit as-is.

## 1. Auth and scoped tokens

There is **a separate model**, so a portal token has no path to staff access.

**`PortalClient`**
- `id`, `name`
- `tokenHash` (unique, SHA-256), `tokenPrefix` (`vfxp_`)
- `scopes text[]`: `portal:read`, `portal:quote`, `portal:write`, `portal:billing`
- `webhookUrl`
- `webhookSecretEnc`: AES-256-GCM using the new env key `PORTAL_SECRET_KEY`, because the HMAC secret has to be
  recoverable
- `allowedCidrs text[]`: the WireGuard subnet
- `rateLimitPerMin`, `isActive`, `expiresAt`, `lastUsedAt`, `createdById`, timestamps

**`src/lib/portal/auth.ts`, `authorizePortal(req, scope)`**
- Checks the token, that it's active and unexpired, and the CIDR (fail closed).
- Checks the scope and the rate limit (per client).
- Never returns a role or a userId.

**Settings → API keys: a "Portal clients" section** (admin)
- Create a client; the token and secret are shown once.
- Rotate the token, rotate the secret, revoke.

**Redaction by construction**
- Every response goes through a DTO mapper built on `select` allowlists (`src/lib/portal/dto.ts`).
- A deep key scan test fails on any key matching
  `/cost|basis|margin|lease|financ|loan|purchase|depr|trueCost|internal|funding|landed|salvage/i`.

**Audit**
- `AuditEntityType` gets a `'Portal'` value. Every write is logged with `via:'portal'`.
- A new `portal_request_log` table records method, path, status, ms, client and account, **never bodies**, and is
  kept for 30 days.

## 2. Endpoints → v2

| Endpoint | Uses | New (v2-only, additive `prisma/manual/2026-10-xx-portal-api-*.sql`) |
|---|---|---|
| `GET /offers`, `/public/price-ranges` | Asset (+category, AssetComponent), PackageTemplate, CloudProduct | `portal_offers`: slug, kind ASSET/PACKAGE/POOL, target id, title, blurb, `solutions[]`, `termsBySolution`, `software[]`, curated `specs`, `isPublic`, `isVisible`, sortOrder |
| `GET /capacity?pool=` | pool assets' units, CLOUD orders | `portal_capacity_pools`: slug, name, assetIds[] or categoryId, unitLabel |
| `PUT /accounts/{pid}` | Client | `portal_accounts`: portalAccountId, clientId, portalClientId, verificationLevel, creditTier; `portal_account_sites` |
| `POST /rates/quote` | rental + Flow engines | `portal_rate_quotes`: rate_id, account, request hash, lines (internal basis and knobs kept, **never returned**), total, validUntil, consumedBy |
| `POST/DELETE /holds` | availability | `portal_holds` (ACTIVE/RELEASED/EXPIRED/CONVERTED, window, expiresAt, rateId), `portal_hold_lines` (heldQty, overage) |
| `POST /orders`, `GET /orders/{id}`, `GET /accounts/{id}/orders` | Reservation | `portal_orders` (reservationId, account, portalQuoteId, rateId, holdId, lastEmittedStatus, siteId), `portal_idempotency` |
| change requests | extend/scale/return/swap cores | `portal_change_requests` (type, payload, PRICED/SUBMITTED/APPLIED/DECLINED, price) |
| `GET /accounts/{id}/environment` | our units on the account's active orders (serial, config, site, term_end); CLOUD order lines | `portal_cloud_resources` (placeholder until the cloud system is integrated) |
| billing | Invoice + Payment, `renderInvoicePdf` | none (v2 invoices until QuickBooks) |
| webhooks | outbox | `portal_webhook_events` (event id, type, payload, status, attempts, nextAttemptAt, lastError, deliveredAt), `portal_emitter_state` |

Also: `asset_categories."refurbBufferDays" INT NOT NULL DEFAULT 2`.

**Tenant isolation.**
- Every account route first resolves `(portalClientId, portalAccountId)`.
- Order and invoice reads return **404** unless the record's `clientId` is linked to the calling client.
- This lives in one place: `src/lib/portal/tenancy.ts`.

## 3. Availability and capacity

The pure calculation is `src/lib/portal/capacity.ts` `computeCapacity`; the loader is `capacity-load.ts`. Figures are
per asset, and a pool sums them:

- **`total`**: units in the fleet.
- **`reserved`**: `HOLDS_STOCK` order quantities overlapping today, plus units in MAINTENANCE, plus open checkouts
  with no order.
- **`tentative`**: active portal holds, plus overlapping QUOTE_SENT orders.
- **`available_now`**: `max(0, total − reserved − tentative)`.
- **`next_available`**: the expected returns and maintenance completions, plus return transit days (from
  `returnMethod`), plus the category's `refurbBufferDays`.
  - **Overdue returns are dropped.**
  - The status is `confirmed` with tracking or a scheduled `returnDate`, `expected` when only the end date is known,
    and `none` otherwise.
- **`demand`**: `high` at 80% or more committed, otherwise `normal`.

Also:
- Export `HOLDS_STOCK`.
- Show portal holds to staff as a separate "held" figure in the builder.
- Fix `availabilityFor` so it subtracts units in maintenance.

## 4. Pricing (`POST /rates/quote`)

`src/lib/portal/quote.ts` only calls existing engines.

**Rental and RTO**
- Uses the rate chain `createReservation` uses. Package template rates override asset rates.

**Flow (12–48 months)**
- Chain: `loadFlowBases` → defaults + the tier's knobs → `flowConfigFromSettings` → `priceFlowLines` →
  `flowClientQuote`.
- `unit_price` = the month-1 payment per unit; `line_total` = the line's contract value.
- **Lease funding is never loaded**, because the client price doesn't depend on it.

**Credit tiers**
- The Setting `portal_credit_tiers` holds, per tier: allowed solutions and terms, `priceAdjustPct`,
  `flowMarginPct`, `maxOrderTotal`, `requiresVerification`.

**Per line**
- `allowed` and `reason`. The reasons are `offer_not_visible`, `solution_not_allowed`, `term_not_allowed`,
  `verification_required`, `credit_limit`, `unpriced` and `insufficient_capacity`.
- `demand`, from §3.

**Snapshot**
- Each quote is stored in `portal_rate_quotes` with a `valid_until`.
- `POST /orders` honours a valid `rate_id`: it writes the snapshot's rates, and for Flow its basis and knobs, so
  `repriceFlowTx` reproduces the same figures.
- An expired or mismatched rate returns `409 rate_expired|rate_mismatch`.

**Public ranges**
- Every public offer is priced at the default tier, across its allowed solutions and terms.
- The band is rounded to $25. When min = max, it is widened by ±10% first.
- **No exact price can come out**, and a unit test pins that.

## 5. Orders and change requests

**Session-free cores (after the Flow merge)**
- Extract `src/lib/orders/create-core.ts` `createReservationCore(tx, input, actor)`, and the same for extend,
  add-line, set-quantity and swap.
- The actor is `{kind:'portal', portalClientId}`.

**`POST /orders`**
- The `Idempotency-Key` header is **required**. The same key with the same request replays the stored response; the
  same key with a different request returns 422.
- Creates a **DRAFT** with `actionRequired` set ("Portal order — review") and the normal numbering, and raises the
  Phase 6 approval.
- The hold becomes CONVERTED.

**What the portal may set:** account, site, lines (offer and quantity), solution and term, start date, project,
delivery method and speed, notes, rate_id, hold_id.

**What it never sets:** rate, discount, tax, knobs, status, cost.

**Status map**

| v2 status | Portal status |
|---|---|
| DRAFT / QUOTE_SENT / REVISION | `pending_review` |
| APPROVED | `confirmed` |
| PREPARING | `preparing` |
| SHIPPED | `in_transit` |
| ACTIVE | `active` |
| COMPLETED | `completed` |
| CANCELLED / LOST | `cancelled` |

**Change requests** return a **priced change**, recorded with a `ClientAsk` for staff. **Nothing applies until staff
approve** (docs/client-portal.md: "nothing a client does commits stock, money or a price without a staff approval").

| Type | Pricing |
|---|---|
| extend | `quoteExtension`, recurring-cycle maths, or Flow's extension % |
| scale | the add/set-line cores; Flow uses `quoteAddition` |
| return | Flow `earlyReturn()` (it needs a per-loan pass first, see its TODO); rentals set `returnDate` |
| swap | the swap core |

## 6. Webhooks

**Signing**
- `hex(HMAC-SHA256(secret, ts + "." + rawBody))`.
- Headers: `X-VFX-Event-Id` (outbox id, stable across retries), `X-VFX-Timestamp` (unix seconds),
  `X-VFX-Signature` (`v1=<hex>`).
- Tested against fixed vectors.

**Delivery**
- Runs from `/api/cron/portal-webhooks` (gated by `CRON_SECRET`) every minute.
- Due rows are claimed with `FOR UPDATE SKIP LOCKED`, 50 at a time.
- Backoff is `min(30s·2^n, 1h)` plus jitter, for 24 hours; after that the event is `dead`.
- Replay: admin "Resend", plus `GET /v1/events?after=<id>` for polling.

**Emitters: a diff reconciler in the same cron.** Status changes happen in about 37 places plus the v1 sync, so
hooking each call site is fragile.

| Event | Emitted when |
|---|---|
| `order.status_changed` | an order's `lastEmittedStatus` differs from its current status |
| `invoice.issued` | an invoice leaves DRAFT (watermark) |
| `invoice.paid` | an invoice is paid (watermark) |
| `return.checked_in` | `checkedInAt` passes the watermark |
| `asset.updated` | a unit on an active linked order changes |
| `availability.changed` / `capacity.changed` | a snapshot hash changes (coalesced to 5 minutes) |
| `hold.expired` | the expiry sweep runs |
| `hold.overage` | staff book a held unit |
| `usage.recorded` | dormant until a cloud usage source exists |

Events from the portal's own writes go into the outbox inside the same transaction.

## 7. Security

- WireGuard is assumed but not trusted. Each client has a CIDR allowlist, and the listener is bound to the wg
  interface.
- Tokens are hashed with SHA-256 and scoped.
- Rate limits are per client: 300 reads, 60 writes and 30 quotes per minute.
- DTO allowlists and the redaction test keep internal figures out.
- An account only ever sees its own data.
- Request bodies are never logged, and webhook secrets are encrypted at rest.

### Hosting checklist

Before /v1 is reachable from anywhere but this box:

- **Serve /v1 on the WireGuard listener only.** Bind the /v1 vhost to the wg interface, or block `/v1` (and
  `/api/v1/portal`) on the public vhost. A token's CIDR allowlist is a second wall, not the first.
- **The reverse proxy must overwrite the client-IP header, never append to it.** The app never trusts a header a
  caller can set. Pick one and set its env var:
  - `proxy_set_header X-Real-IP $remote_addr;` and `PORTAL_CLIENT_IP_HEADER=x-real-ip` — only that header is read,
    and it must hold one address. (Or `proxy_set_header X-Forwarded-For $remote_addr;` with
    `PORTAL_CLIENT_IP_HEADER=x-forwarded-for`.)
  - Or, if the proxies append (`$proxy_add_x_forwarded_for`), `PORTAL_TRUSTED_PROXY_HOPS=<number of proxies>` —
    the address that many entries from the right of `X-Forwarded-For` is used; anything to its left is ignored.
  - With neither set, a client that has an allowlist is refused with `403 ip_unverifiable` (logged once); a client
    with no allowlist is not checked. Leave the allowlist blank only for a token that never leaves the box.
- **Set `PORTAL_SECRET_KEY`** to 32 random bytes as hex or base64 (`openssl rand -hex 32`). Anything else is
  refused, and no webhook secret can be made without it. Each secret is bound to its client's id, so rotating the
  key means rotating every client's webhook secret.
- **Rate limits** are per client and per kind of call, per minute: 300 reads (`portal:read`, `portal:billing`),
  60 writes (`portal:write`), 30 quotes (`portal:quote`). A client's own `rateLimitPerMin` replaces its read limit
  only. The limiter is in memory, so the limits hold per app instance; run one instance or move it to a shared
  store.
- **Webhook URLs are https only**, including on the WireGuard network.

## Phases

**Phase 1: what the portal team can build against** (~2.5k LOC, ~1.5 weeks)
- Migration: `portal_clients`, `portal_accounts`, `portal_account_sites`, `portal_offers`,
  `portal_capacity_pools`, `portal_rate_quotes`, `portal_request_log`, and `refurbBufferDays`.
- `src/lib/portal/{auth,tenancy,dto,errors,capacity,capacity-load,offers,price-ranges,quote,tiers}.ts`.
- Routes: `offers`, `public/price-ranges`, `capacity`, `accounts/[id]`, `rates/quote`.
- Plumbing: the rewrite and proxy matcher.
- Screens: Portal clients console, offers and pools editors, and the refurb field on categories.
- Tests: capacity and next_available, range rounding, tier reasons, the redaction scan, auth scopes and CIDR.
- `scripts/smoke-portal.ts`: a throwaway client in a rolled-back transaction.

**Phase 2: holds, orders, webhooks** (~3k LOC, ~2 weeks)
- Starts after the Flow merge, and either after the v1 cutover or with a portal number prefix.
- Holds, orders, idempotency, the outbox, the create core, the delivery and reconcile cron, and the crontab line.

**Phase 3: change requests, environment, billing** (~2k LOC, ~1.5 weeks)
- Change-request cores, the environment endpoint, and invoice list and PDF behind the tenancy guard.

## Owner decisions that block Phase 1 (recommended defaults)

1. **What an offer is.** A curated `portal_offers` row pointing at one asset or one package template.
   **Opt-in**: nothing shows until staff publish it. Staff write the portal specs and software tags, because v2 has
   no spec data.
2. **Credit tiers.**
   - **A**: all solutions, Flow 12–48, list price.
   - **B**: rental and RTO, Flow 12–24, list price.
   - **C**: rental only, list price, orders up to $10k.
   - Editable in Settings, with no tier discounts until set.
3. **Verification levels.** `none` = catalog and quotes; `id_verified` = holds; `agreement_and_coi` = orders and Flow.
4. **Orders an account sees.** Its linked client's orders from QUOTE_SENT on, plus portal-placed orders. Internal
   drafts stay hidden.
5. **Account ↔ Client on PUT.** A new `portal_account_id` creates a new client. Staff re-link to an existing client
   from the client record; PUT never auto-merges.
6. **Capacity pools.** A named set of server/GPU-node assets, computed like availability. No cloud-system
   integration in Phase 1.
7. **Numbers.**
   - Refurb buffer: 2 business days (workstations and laptops 3).
   - Demand threshold: 80%.
   - Quote validity: 7 days (Flow 72 hours).
   - Hold TTL: 48 hours.
   - Public ranges rounded to $25, with a ±10% floor on the band.
8. **v1 coexistence.** Phase 1 (read-only) can run while the v1 sync is live. Phase 2 writes wait for the cutover, or
   use a `PRT-` number prefix.

## Owner answers (2026-09-26)

1. **Offers:** curated, opt-in, as recommended.
2. **Credit tiers:** **one tier for now.** Everyone gets list price and every solution. Keep `portal_credit_tiers`
   in the design so tiers can be added later without an API change, but seed a single tier.
5. **Account ↔ Client:** a new client, and staff re-link it. Never auto-merge. As recommended.
8. **v1 coexistence:** a **`PRT-` number prefix** for portal-placed orders, so Phase 2 doesn't wait for the cutover
   and the v1 sync can never delete them.

Decisions 3 (verification levels), 4 (which orders an account sees), 6 (capacity pools) and 7 (default numbers) take
the recommended defaults unless the owner says otherwise.

## Owner answers, round 2 (2026-09-26)

- **RTO on the portal:** held off. `rto` is not offered until the owner defines what a portal RTO price is based on.
  (In the app, the RTO payment is the order total ÷ term, which is not the monthly rental rate.)
- **Public price bands:** keep ±10% / $25. The owner: "doesn't matter — we'll be porting rates and products from the
  inventory system," so the portal's catalog prices come from AMC anyway.
