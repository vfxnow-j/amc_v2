# VFXNow AMC v2

Second-generation asset management, rental and sales platform for VFXNow.

v1 (`vfxnow-j/amc`) remains in production. v2 is a ground-up rebuild that keeps the
domain — assets, reservations, check-out/in, billing, CRM, leasing — while replacing the
information architecture and visual shell, and adding a new Service Center area for
work orders and QC test runs.

## Status

Early build. See `design/README.md` for the full design handoff that specifies this work.

## Stack

| Layer     | Technology                                         |
|-----------|----------------------------------------------------|
| Framework | Next.js 16 (App Router, Server Components/Actions) |
| Language  | TypeScript, React 19                               |
| Styling   | Tailwind CSS 4 + CSS variable token layer          |
| Database  | PostgreSQL 16 via Prisma                           |

## Information architecture

v1's ~28 sibling dashboard routes collapse into six clusters:

| Cluster        | Code | Contains                                                           |
|----------------|------|--------------------------------------------------------------------|
| Operate        | `OP` | Orders, Today's movements, Mobile scan, Calendar, Packages          |
| Inventory      | `IN` | Assets, Units, Locations & transfers, Audits & scan lists, Vendors  |
| Service center | `SC` | Work orders, QC test runs, Maintenance log, Coverage & RMA — **new** |
| Revenue        | `RV` | Invoices, Payments, Leases, Rate cards, Purchase orders             |
| Clients        | `CL` | Accounts, Leads, Quotes, Marketing                                  |
| Insight        | `IQ` | Reports, Insights                                                   |

## Getting started

```bash
npm install
npm run dev
```

The dev server runs on port 3001 so it can sit alongside the v1 instance on 3000.

## Repository conventions

- `main` — trunk. Always deployable; nothing lands here directly.
- `dev` — integration branch. Feature branches merge here first.
- `feat/*`, `fix/*`, `chore/*`, `docs/*` — short-lived branches off `dev`.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): summary`, one coherent change per commit.

## Layout

```
design/    design handoff — HTML references, design-system tokens, brand assets.
           Reference material, not application code.
src/app/   App Router routes.
src/       application code.
```
