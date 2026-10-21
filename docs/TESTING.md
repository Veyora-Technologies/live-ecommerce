# Testing and verification

**Current deployment decision:** NO-GO. Tests below ran locally on synthetic SQLite fixtures. They are not production, legal, security-certification, browser-compatibility, capacity, recovery, or deployment evidence. The current authoritative architecture/readiness record is [`DEPLOYMENT_READINESS.md`](DEPLOYMENT_READINESS.md).

## Commands

```bash
npm ci --legacy-peer-deps
./node_modules/.bin/prisma validate --schema prisma/schema.prisma
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
npm run lint:ci
npm test -- --reporter=dot
npm run build
```

Do not point tests, `prisma db push`, or seed scripts at `prisma/prisma/dev.db` or any valuable/production database. Integration tests refuse non-loopback target URLs. Use a disposable SQLite file, `LIVE_DATA_MODE=demo`, explicit random per-run secrets/passwords, and the guarded seed opt-in.

The production-build HTTP suite is enabled with `LIVE_INTEGRATION=1` and a loopback `LIVE_BASE_URL`. CI sets `LIVE_TEST_RELAXED_RATE_LIMITS=1` **on the temporary server process only** to allow the complete suite to finish inside one minute. The override works only with `NODE_ENV=production`, `LIVE_DATA_MODE=demo`, and a `file:` SQLite URL; it does not apply to production data or an external database. Ordinary rate limits remain unchanged (auth bucket 20/minute per apparent IP, process-local). The override is test infrastructure, not a production recommendation or proof of distributed throttling.

## Latest local results

| Check | Result | Scope / limit |
|---|---|---|
| Clean install | **Pass on Node 24.22.0** | `npm ci --legacy-peer-deps --no-audit --no-fund` after lockfile repair. `package.json` targets `>=24 <25`. |
| Prisma validation | **Pass** | `prisma validate --schema prisma/schema.prisma`. The latest fixture push/seed used disposable `/tmp/live-e2e-65b24e779b5b.sqlite`; no production migration or write. |
| TypeScript | **Pass** | `tsc --noEmit --incremental false --pretty false`; the latest production build also ran TypeScript. |
| Default Vitest | **129 passed, 30 skipped** | 22 files passed and five skipped. Integration tests are gated unless `LIVE_INTEGRATION` is set. Vitest 4.1.12. |
| Fresh-fixture HTTP integration | **159/159 passed; 27 files** | Against the local optimized build, loopback-only HTTP, and seeded disposable `/tmp` SQLite data. The test-only auth-rate override was active only in the server process. |
| Production-mode gate smoke | **503 as intended in earlier isolated smoke** | Under production Node + `LIVE_DATA_MODE=production` + isolated SQLite: `/` returned plain-text 503; health returned 503/config invalid; search and login APIs returned 503. No production DB write. |
| Optimized production build | **Pass** | Node 24.22.0 / Next.js 16.4.2, completed after the current source edits. It is a local artifact; it was not deployed. |
| ESLint budget | **Pass, not clean** | `npm run lint:ci`: 282 errors / 24 warnings against baseline 301 / 25, with no per-file/rule regression. Strict lint debt remains. |
| Runtime dependency audit | **Pass** | `npm audit --omit=dev --audit-level=high` reported zero runtime advisories. |
| Full dependency audit | **Unresolved: 5 high, 0 critical** | Findings are in development tooling. A forced fix would downgrade `eslint-config-next` to 14.2.35; no forced fix was applied. The blocking full-audit CI step remains unresolved. |
| Browser E2E | **Not run — tooling missing** | `@playwright/test` is not in project dependencies/lockfile. No browser, responsive, assistive-technology, or visual audit was run. |
| GitHub Actions | **Not run** | Workflow changes were exercised locally where practical; the workflow has not run on GitHub-hosted infrastructure. |

The latest geography seed reported 850 active nodes and marketplace seeding reported 60 projections. The fresh-fixture HTTP suite includes local authentication/session/logout, role and tenant boundaries, private-data projections, registration privilege-field rejection, production recovery-unavailable behavior, invalid reset-token rejection, marketplace/reservation APIs, cart submissions, stock/idempotency, search and cron dry-run coverage. It does not implement or verify provider-backed registration or email/phone verification. The cart-submit fixtures explicitly approve their synthetic listings; a newly synchronized projection alone remains pending review. No test writes to a production database.

## Known verification gaps

- No production PostgreSQL/provider conversion, migration/rollback rehearsal, provider-level race test, real seller/listing verification, or transaction currency snapshot migration.
- No browser E2E because the runner/browser is missing; no Chrome/Edge/Firefox/Safari matrix, responsive widths, screen-reader/keyboard/contrast/reduced-motion/WCAG 2.2 AA review.
- No sustained throughput/load test, failure-injection, DDoS test, external provider contract test, production secret rotation, or independent penetration/security assessment.
- No production backup/restore or off-site/PITR drill, measured RPO/RTO, centralized observability, SLO, on-call or incident response rehearsal.
- No legal/privacy professional review or compliance assessment.
- No production host/domain, deployment, or provider activation.

Archived local SQLite backup/restore and sequential health/search timing checks are historical evidence only. They must not be described as production recovery, performance, capacity, or SLO results.
