# Live — Know what is available. Act on it instantly.

Live helps people discover merchant listings, compare reported prices and availability, and submit pickup reservation requests. It is not a generic social network or checkout marketplace. Each reservation is revalidated server-side and belongs to one merchant; Live does not take payment.

> **Deployment status: not approved for production.** `LIVE_DATA_MODE` defaults to `demo`, and the included records are samples. Production data mode remains blocked until the SQLite-only datasource, unreviewed migration/deployment path, and operational deployment gates are resolved. See the [deployment readiness report](docs/DEPLOYMENT_READINESS.md); do not deploy or set `LIVE_DATA_MODE=production` yet.

## Current engineering scope

The repository is a Next.js 16 / React 19 / Prisma modular monolith. It includes consumer, merchant, and admin surfaces; server-side session and role checks; discovery and location filtering; inventory/availability confidence; a planning cart with separate reservations; merchant inventory and CSV workflows; service bookings; saved lists/searches; in-app notifications; and limited authenticated job/webhook handling.

A planner cart is not an order. A successful submission creates separate pending pickup reservations and temporarily holds stock. Merchant confirmation is still required; holds are released by the scheduled expiry job only when an operator configures and monitors it. Live does not arrange delivery, quote delivery fees, or take payment. No external payment, POS, supplier, routing, delivery, SMS, vision, or AI provider is configured. Email is the one optional integration with real code: when `RESEND_API_KEY` + `EMAIL_FROM` + a public HTTPS origin are set, registration and password-reset links are delivered; otherwise those endpoints say delivery is unavailable instead of pretending. Merchant product images can be uploaded through `/api/uploads` when `LIVE_UPLOAD_DIR` points at a writable absolute directory (single-instance storage).

See the [deployment readiness report](docs/DEPLOYMENT_READINESS.md) for maintained architecture, feature status, test evidence, scope and deployment blockers. Live is **not production deployed or approved for go-live**.

## Product and safety boundaries

- Search uses local merchant records and rule-based query parsing. Displayed availability is not a guarantee of physical stock on arrival; timestamps/confidence matter.
- `nearest` is straight-line distance when coordinates are available, not a road route or travel time.
- Barcode/QR are discovery aids, not proof of local stock, authenticity, payment, or authentication.
- Delivery is unavailable through Live; a merchant record or flag is not proof of a configured delivery service.
- Regulated products are not autonomously substituted or medically recommended; direct questions should be referred to a pharmacist.
- Offline data is not confirmation: private API records are not cached and offline actions cannot confirm reservations.

## Local setup

Use Node.js 24 (the package declares `>=24 <25`; Node 20 is EOL). See `docs/DEPLOYMENT.md` for production boundaries.

```bash
npm ci --legacy-peer-deps
cp .env.example .env
# Set a strong random JWT_SECRET in .env. Keep .env private.
export LIVE_DATA_MODE=demo
export LIVE_ALLOW_DEMO_SEED=1
export LIVE_DEMO_USER_PASSWORD="$(openssl rand -hex 32)"
export LIVE_DEMO_ADMIN_PASSWORD="$(openssl rand -hex 32)"
./node_modules/.bin/prisma validate
./node_modules/.bin/prisma generate
./node_modules/.bin/prisma db push
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. The base seed is destructive and now refuses to run unless demo mode, explicit `LIVE_ALLOW_DEMO_SEED=1`, a file-backed SQLite URL, and a non-production runtime are all present. It requires random demo passwords supplied through environment variables; integration tests use those values to exercise the real auth flow. Never use demo credentials or data in production. SQLite is a local/CI fixture, not a production database.

## Verification commands

```bash
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
npm run lint:ci          # ESLint debt budget (fails only if lint debt grows)
npm test -- --reporter=dot
npm run build
npx playwright install chromium   # one-off, for the browser tests
npm run test:e2e
```

`npm run lint` is the strict full ESLint command; it currently reports a large pre-existing backlog. `lint:ci` enforces a per-file/per-rule non-regression baseline and does not mean lint is clean; `npm run lint:baseline` re-records it after deliberately paying debt down. HTTP integration tests require a seeded local server, the same `LIVE_DEMO_*_PASSWORD` values used for seeding, and refuse non-loopback targets. The Playwright runner is now a devDependency and CI installs Chromium, but the browser suite has not been executed in the audit sandbox (browser binaries are not downloadable there) — treat its first CI run as the real verification.

## Deployment and standards

See [`docs/DEPLOYMENT_READINESS.md`](docs/DEPLOYMENT_READINESS.md) for current architecture and feature status, plus [`docs/API.md`](docs/API.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/BROWSER_SUPPORT.md`](docs/BROWSER_SUPPORT.md), and [`docs/GO_LIVE.md`](docs/GO_LIVE.md). OWASP ASVS 5.0.0 and NIST SSDF are review references, not a compliance claim. No production database, migration, deployment, security certification, penetration test, load capacity, SLO, provider integration, or production restore has been evidenced.

