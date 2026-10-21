# Deployment and operations

> **Current authority:** [`DEPLOYMENT_READINESS.md`](DEPLOYMENT_READINESS.md). The decision is **NO-GO**. The current code deliberately rejects `NODE_ENV=production` with `LIVE_DATA_MODE=production` until the database/provider/migration path and deployment gates are verified. Do not deploy or enable production data mode yet.

## Runtime baseline

Use Node.js 24 (the repository declares `>=24 <25` and CI targets Node 24.22.0). Node 20, which was present in the base sandbox, reached end of life; see the [official Node.js release table](https://nodejs.org/en/about/previous-releases). A clean Node 24 install, build, default tests, and optimized-build HTTP integration suite passed locally. The GitHub Actions workflow itself remains unexecuted.

## Current production boundary

This workspace is an engineering checkpoint, **not a production deployment or go-live approval**. This workspace is a Next.js 16 / React 19 modular monolith using Prisma 5.22 and a SQLite development fixture. No production host, domain, PostgreSQL database, credentials, mail/SMS, payment, routing, POS, delivery, object storage, scheduler, or monitoring provider is configured.

`LIVE_DATA_MODE=demo` is the safe default and displays a sample-data warning. Keep it enabled until each visible listing has an approved owner, real source, and refresh process. Do not copy the demo SQLite fixture into production.

## Local development

```bash
npm ci --legacy-peer-deps
cp .env.example .env
# Set a strong random JWT_SECRET; keep .env private.
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

The SQLite URL in `.env.example` is `file:./prisma/dev.db`, resolved relative to `prisma/schema.prisma`; the default fixture path is `prisma/prisma/dev.db`. Use a disposable local database for tests. Base `db:seed` deletes/recreates sample records; all synthetic v2/v3 seeds are guarded and require `LIVE_DATA_MODE=demo`, `LIVE_ALLOW_DEMO_SEED=1`, a `file:` SQLite URL, and a non-production runtime. Base accounts require random `LIVE_DEMO_USER_PASSWORD` / `LIVE_DEMO_ADMIN_PASSWORD` values, not repository-fixed passwords. Never set the opt-in on valuable or production data.

## Environment and secrets

See `.env.example`. Runtime validation requires `DATABASE_URL` and `JWT_SECRET` (at least 32 characters in production); `LIVE_DATA_MODE` must be `demo` or `production`. The current production-data profile is marked invalid because this workspace still uses SQLite and has no reviewed production migration/deployment path. Health, legal gates, authentication and operational market APIs fail closed for invalid production configuration. Before a future owner-approved re-enable, configure/verify the selected production database, versioned migrations, strong `LIVE_SECRET_ENCRYPTION_KEY`, `CRON_SECRET`, canonical HTTPS `NEXT_PUBLIC_APP_URL`, sender/provider settings where used, and a secret-manager/rotation/recovery process. Keep all secret values out of source control.

Optional provider variables do not imply a working integration. Payment checkout/verification, external email/SMS/push, road routing, POS/supplier sync, delivery dispatch, external vision/AI, and API-key authentication are not operational in this release. The Connect UI record does not prove a provider is connected. Paid plans remain disabled without a verified payment adapter.

If encrypted secrets were stored using a previous key/format, back up first and follow `docs/INTEGRATIONS.md`; rotation/versioned re-encryption is not implemented. Loss of the key can make encrypted values unreadable.

## Database and schema deployment

There is no committed Prisma migration history. Local development may use `prisma db push`; do **not** point a production service at SQLite or use `db push` as an unreviewed production migration.

Before a first PostgreSQL deployment:

1. Select hosting, managed PostgreSQL, backup/PITR, region, network policy, and staging/prod separation.
2. Convert the Prisma datasource in a dedicated change; audit SQLite-specific schema/default/transaction behavior and test from an empty database.
3. Generate and review a baseline migration; test upgrade, rollback/recovery, data preservation, indexes/constraints, last-item reservation races, batch quarantine races, and idempotency on PostgreSQL.
4. Do not migrate demo data as real merchant data. If any valuable data requires migration, write a separate reconciled ETL and rehearse on a copy.
5. Back up production, apply only reviewed migrations in a maintenance window, and record a rollback/recovery decision.

No PostgreSQL conversion or production migration has been run.

## Build and verification

```bash
./node_modules/.bin/prisma validate
./node_modules/.bin/prisma generate
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
npm run lint:ci
npm test -- --reporter=dot
npm run build
```

`npm run lint` is the strict full ESLint command and currently fails on an existing repository-wide backlog. `lint:ci` compares per-file/per-rule findings with `eslint-baseline.json`; it prevents regressions but does **not** mean lint is clean. See `docs/TESTING.md`.

The CI workflow additionally creates and seeds an isolated SQLite DB, builds the app, starts that production build on loopback, runs HTTP integration, and then enforces a blocking full-dependency high-severity audit. It has not been executed by GitHub Actions yet; the current five high dev-tooling advisories will make that last gate fail until compatible remediation or a narrowly scoped, owner-approved exception is implemented. `tests/e2e/flow.spec.ts` exists, but `@playwright/test` and a browser are not installed; `npm run test:e2e` currently fails because `playwright` is not found. Browser verification is not configured as a verified CI job.

## Runtime requirements and operational controls

- Bind the Node server to the platform host/port. Use HTTPS, secure cookies, managed database networking, secret-store access, least privilege, and explicit health checks.
- The rate limiter lives in `src/proxy.ts` as a bounded in-process map. It is not shared between instances and is not a DDoS control. The selected edge/reverse proxy must overwrite client-supplied forwarded-IP headers before this app trusts them.
- `GET /api/v1/health` is a coarse database/config readiness check, not a full dependency monitor. There is no configured APM, distributed trace collector, centralized log destination, alerting target, or SLO.
- The session store is the application database. A multi-instance production database/transaction design must be tested before horizontal scaling.
- `POST /api/jobs/process` and `POST /api/jobs/expire` require production cron authentication. Configure an external scheduler, record HTTP outcomes, monitor retries/backlog, and test the failure path. Generic background-job event handlers are not implemented.
- Reservations create a temporary inventory hold immediately; expiry releases it only when the expiry job is invoked successfully. Do not enable operational reservations without a monitored scheduler and recovery procedure.
- The service worker caches public/static content only. It does not confirm offline reservations or cache private API records.

## Backup and restore

For the local SQLite fixture:

```bash
./scripts/backup.sh
./scripts/restore.sh backups/live-<timestamp>.db
```

The scripts require `sqlite3` or Python 3 with SQLite support, create a consistent snapshot/checksum, and verify a scratch restore with SQLite integrity and Prisma reads. A local scratch restore was exercised in this workspace. This does **not** prove encrypted/off-site backups, a production restore, a recovery point/time objective, or a provider-level disaster recovery plan. For PostgreSQL, define and rehearse a managed backup/PITR and restore runbook instead.

A historical backup was made before a local fixture schema push on 2026-10-20. It is not a production backup and should only be retained if the fixture matters to the operator.

## Release blockers

Before production, assign owners and evidence for:

- PostgreSQL provider conversion, reviewed migrations, backup/PITR, off-site retention, and production restore drill.
- Admin MFA enforcement with safe initial enrollment/recovery; least-privilege admin membership and account recovery.
- Shared-store/edge rate limiting, trusted forwarded-IP configuration, and abuse monitoring.
- External scheduled-job delivery, alerts, retries, and expired-hold reconciliation.
- APM/log/alert configuration, retention/access controls, incident contacts, SLO/error budget and measured service capacity.
- Full ESLint debt reduction; remediation/exception review of development-dependency audit findings.
- Verified browser/mobile/keyboard/screen-reader workflows, full API contract coverage, independent security review, and staging sign-off.

No security certification, penetration test, production SLO, production capacity, provider integration, production restore, or go-live approval is claimed. See `docs/DEPLOYMENT_READINESS.md` for current deployment readiness, plus `docs/SECURITY.md`, `docs/BROWSER_SUPPORT.md`, and `docs/GO_LIVE.md`. Older readiness/performance/backlog documents are historical snapshots.
