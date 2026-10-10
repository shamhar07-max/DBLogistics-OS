> Free cloud deployment: [Oracle + Cloudflare, with optional Supabase](infrastructure/free-cloud/README.md). Existing Railway deployment remains available.

# DigitalBurj Logistics OS

> **One system. Every operation.** — multi-tenant operating system for freight forwarding, customs brokerage and bonded warehousing, built as a **Business-OS core + Logistics industry pack**.

This repository contains the **brand & design system**, the **dashboard designs**, and a **working full-stack foundation** that implements the blueprint's first milestone — *enquiry → approved quotation → job → booking → cargo execution → delivery evidence → customer invoice → supplier-cost reconciliation → collection → job closure* — with the hardest invariants enforced by PostgreSQL and proven by tests.

> **Read first:** [`specifications/architecture/status.md`](specifications/architecture/status.md) — an honest ledger of what is built/verified, scaffolded, and not started.

**Enterprise scope:** [147-area assessment and delivery plan](specifications/enterprise/README.md), using ElvoraLogisticsOS as a reference. [Carrier rate procurement](specifications/enterprise/rate-procurement.md) is available through **Enquiries & quotes → Rate procurement**: prepare/issue RFQs, preserve supplier response revisions, compare current rates and independently award an approved rate. [Work control and governance](specifications/enterprise/work-control.md) adds business-calendar SLAs, department queues, capacity, handover, controlled knowledge, a formal risk register, membership/token revocation and operational health. Open **Today → Work control / Knowledge & risk** and **Administration → Access control / Operations health**. [Reviewed accounting periods](specifications/enterprise/period-control.md) are available in **Money → Accounting periods**, with exact period movement and independent close/reopen decisions. The enterprise scope remains partially implemented; provider and production acceptance are tracked separately.

## Quickstart (no Docker needed)
```bash
npm install
infrastructure/local/pg-local.sh start                       # PostgreSQL 16 on :54329 + roles (dbl_app / dbl_worker / dbl_migrator)
psql -h /tmp -p 54329 -U postgres -c "CREATE DATABASE dbl OWNER dbl_migrator" && psql -h /tmp -p 54329 -U postgres -d dbl -c "CREATE EXTENSION pgcrypto"
npm run db:migrate
(cd apps/api && DEV_AUTH_SECRET=dev-secret-dev-secret-dev-secret-00 npx tsx src/main.ts)     # API :3001   (run tsx from apps/api: it needs that tsconfig)
(cd apps/api && npx tsx scripts/seed-dev.ts)                 # demo tenant + realistic scenario through the real API
(cd apps/staff-web && SESSION_SECRET=… DEV_AUTH_SECRET=… API_BASE_URL=http://localhost:3001 npm run dev)   # http://localhost:3000 → "Local development login": subject `layla` (owner) — or `omar` sales, `nadia` pricing, `faisal` finance, `sana` accountant, `yusuf`/`hamad` warehouse, `rami` freight ops, `hana` HR, `qadir` quality — tenant id from the seed output
```
Partner portal: `(cd apps/partner-portal && SESSION_SECRET=… DEV_AUTH_SECRET=… API_BASE_URL=http://localhost:3001 npm run dev)` → http://localhost:3002 with the seeded portal users `pharma-user` / `foods-user` (customers of two different companies), `agent-user` (air agent) and `haulier-user` (transporter).
Without MinIO/S3 (`S3_ENDPOINT` unset) the API stores documents on local disk behind signed, expiring URLs (`DEV_STORAGE_DIR`), so uploads and previews work in development. The worker's disk scanner checks the EICAR signature and marks them clean; in tests you can flip `scan_status` directly.

**Document safety & extraction (free engines):** the worker scans every upload with ClamAV (`CLAMD_HOST`/`CLAMD_PORT`, run the `clamav` compose service; fails closed without it), then reads text with `pdftotext` or Tesseract OCR (English + Arabic, `OCR_LANGS`) and stores suggested fields for staff. **Customer messaging:** set `SMTP_URL` (Mailpit locally at :8025, Microsoft 365 / any SMTP in production) and, for WhatsApp, `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`; create the approved templates named `dbl_<template>` (see `packages/contracts/src/notifications.ts`) in the Meta console. WhatsApp is only used for contacts who opted in. All variables are in `.env.example`.

**Branded PDFs:** invoices, quotations and shipment reports download from staff and portal screens (`/invoices/:id/pdf`, `/quotes/:id/pdf`, `/shipments/:id/report`).

With Docker: `docker compose up -d postgres redis minio keycloak` (then `--profile apps up --build`).

## Run everything locally (one command)
```bash
bash scripts/local-up.sh      # PostgreSQL · Redis · ClamAV · Mailpit (Docker if present, else local binaries) → migrate → demo data → API · worker · staff · portal
bash scripts/local-down.sh    # stop the apps (add --infra to stop the containers too)
```
Needs Node 22 and Docker (or PostgreSQL 16 + redis-server). It prints the URLs and the demo **tenant id**: open http://localhost:3000 (staff) or http://localhost:3002 (portal), use "Local development login" with subject `layla` (owner) / `pharma-user` (customer) and paste the tenant id. Development mode only: dev sign-in, documents on local disk, emails land in Mailpit (http://localhost:8025).

## Verify
```bash
npm run check:boundaries && npm run typecheck && npm test      # 60+ tests; API/worker suites hit real PostgreSQL (and Redis)
npm run e2e                                                    # seeds a FRESH tenant, then runs the staff (≈24) and portal (11) browser suites against the live stack (use `next dev`; `next start` refuses dev auth by design)
# API tests must run from apps/api (`cd apps/api && npx vitest run`): that config runs files sequentially against one database
```

## Layout
```
apps/        api (NestJS) · worker (BullMQ) · staff-web · partner-portal (Next.js) · logistics-mobile (Expo skeleton) · platform-admin (not built)
packages/    documents (branded PDFs) · contracts (Zod + route table → OpenAPI) · api-client · gateway (BFF) · ui · design-tokens · localization · offline-sync · configuration
database/    migrations/001–016 · invariants.sql · reference-data/ · development-seeds/
specifications/  architecture · domains · workflows · permissions · accounting · integrations · acceptance-tests · recovery
infrastructure/  local (pg-local.sh, keycloak realm) · containers (Dockerfile) · terraform (DRAFT)
brand/ design/  brand kit, guidelines page, dashboard v1/v2 designs
tools/       check-boundaries (architecture guard) · gen-specs (permission matrix, event/API catalogs)
```

---
> **One system. Every operation.** — The operating system for an international freight forwarder, customs broker and bonded-warehouse operator.

| Open | What it is |
|---|---|
| `brand/brand-guidelines.html` | Full brand & design-system guide (logo rules, colour, type, shape, components, sector environments, motion, icons) |
| `brand/brand-board.png` | Full-page image of the guide |
| `design/dashboard-v2.html` | **Current** Owner dashboard — soft bento + frosted glass, map hero, all 14 product areas (animated) |
| `design/dashboard-v2.png` | Full-page image of dashboard v2 |
| `design/dashboard.html` / `.png` | v1 (dark-sidebar, dense operations layout) |

## Brand kit
```
brand/
  assets/logo/   digitalburj-logistics-os-logo.png  ← master, byte-identical to the supplied logo
                 mark-only.png · icon-512/192/180/64/32.png · favicon.ico
  tokens/        tokens.css · tokens.json
  css/           components.css · guidelines.css
  js/            icons.js (40-icon set) · motion.js (reveal, count-up, pause-motion)
  fonts/         Chakra Petch · Barlow · Barlow Condensed · IBM Plex Mono (all OFL, self-hosted)
design/          dashboard.html · dashboard.css · dashboard.png
```

## Design in one paragraph
Container-green and signal-red come straight from the logo. Freight vocabulary does the rest: sea = blue, air = sky, road = hi-vis amber, warehouse = kraft, customs = stamp indigo. Type is signage-driven (Chakra Petch headings, Barlow UI, Barlow Condensed shipping-label caps/KPIs, IBM Plex Mono for BL/AWB/container/HS codes). Shapes carry a chamfered "container casting" corner; textures are corrugation, hazard stripe and barcode. Motion mirrors digitalburj.com — staged reveals, floating live cards, count-up KPIs, flowing lanes, global **Pause motion** — and respects `prefers-reduced-motion`.

## Rules worth remembering
* The logo is a **transparent PNG with near-black ink** — always place it, unmodified, on a pure-white plate.
* White text on brand Signal Red (#F5280A) is only 4.05:1. Filled buttons/badges use **Action Red #E12509 (4.7:1)**.
* Estimated ≠ actual: tracking events always show their source; inferred values are hatched.
* Status dimensions (execution · customs · documents · finance · e-invoice) are never collapsed into one.

All figures, names and entities in the dashboard are fictional sample data.
