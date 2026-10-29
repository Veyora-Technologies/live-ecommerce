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
| Default Vitest | **91 passed, 18 skipped, 8 files blocked at import** | Run on 2026-10-24 in an environment where `prisma generate` cannot download its engines, so eight files stop at `@prisma/client did not initialize yet` (assertions never run). The same eight files failed identically at the pre-round-2 commit `0da3dac`, verified in a detached worktree, so no test regressed. Integration files are gated unless `LIVE_INTEGRATION` is set. Vitest 4.1.12. A machine with a generated client should report roughly 129 passed / 30 skipped. |
| Fresh-fixture HTTP integration | **159/159 passed; 27 files** | Against the local optimized build, loopback-only HTTP, and seeded disposable `/tmp` SQLite data. The test-only auth-rate override was active only in the server process. |
| Production-mode gate smoke | **503 as intended in earlier isolated smoke** | Under production Node + `LIVE_DATA_MODE=production` + isolated SQLite: `/` returned plain-text 503; health returned 503/config invalid; search and login APIs returned 503. No production DB write. |
| Optimized production build | **Pass** | Node 24.22.0 / Next.js 16.4.2, completed after the current source edits. It is a local artifact; it was not deployed. |
| ESLint budget | **Pass, not clean** | `npm run lint:ci` runs `scripts/check-eslint-baseline.mjs`: 282 errors / 24 warnings against the recorded baseline with no per-file/rule regression. Re-record after deliberately fixing debt with `npm run lint:baseline`. Strict lint debt remains. |
| Runtime dependency audit | **Pass** | `npm audit --omit=dev --audit-level=high` reported zero runtime advisories. |
| Full dependency audit | **Unresolved: 5 high, 0 critical** | Findings are in development tooling. A forced fix would downgrade `eslint-config-next` to 14.2.35; no forced fix was applied. The blocking full-audit CI step remains unresolved. |
| Upload/media unit spec | **15 passed** | `npx vitest run tests/unit/media-upload.test.ts` (2026-10-24). Pure-logic coverage: magic-byte identification, SVG/HTML rejection, traversal-shaped names, `LIVE_UPLOAD_DIR` fail-closed rule, and media paths accepted (or not) by the product schema. No HTTP request and no file was written. |
| Email delivery | **Not executed** | `src/lib/email.ts` is only exercised through type checking; no provider key exists here, so neither success nor provider-error behaviour was tested against a live endpoint. |
| Browser E2E | **4/4 pass in CI** | `@playwright/test` is a devDependency; the `e2e` job installs Chromium, builds, starts the optimized server, waits for `/api/v1/health`, and points Playwright at it via `LIVE_BASE_URL`. The suite covers the home-page search journey, compare-page copy, manual area selection and the "no merchant phone numbers in public HTML" check. Four defects the first runs exposed are fixed (`textbox` vs `searchbox` role, dev-compile timeouts, the header search form shadowing the hero, and a missing `phoneVerifiedAt` select). No responsive, assistive-technology, or visual audit is included. |
| GitHub Actions | **Green on PR #1** | Run `40088710530`: `verify` (Prisma validate/generate, TypeScript, lint budget, unit tests, production dependency audit, `db push`, seed, **production build**, HTTP integration suite, full audit) and `e2e` (Chromium, fixture seed, production build, 4/4 browser smoke tests) both pass. The previous `main` run was red only because `main` declared `lint:ci` → `scripts/check-eslint-baseline.mjs` without containing that file; this branch adds it. CI still runs against a disposable SQLite fixture with seeded demo data, not a production database. |

The latest geography seed reported 850 active nodes and marketplace seeding reported 60 projections. The fresh-fixture HTTP suite includes local authentication/session/logout, role and tenant boundaries, private-data projections, registration privilege-field rejection, production recovery-unavailable behavior, invalid reset-token rejection, marketplace/reservation APIs, cart submissions, stock/idempotency, search and cron dry-run coverage. It does not implement or verify provider-backed registration or email/phone verification. The cart-submit fixtures explicitly approve their synthetic listings; a newly synchronized projection alone remains pending review. No test writes to a production database.

## Known verification gaps

- No production PostgreSQL/provider conversion, migration/rollback rehearsal, provider-level race test, real seller/listing verification, or transaction currency snapshot migration.
- No browser E2E because the runner/browser is missing; no Chrome/Edge/Firefox/Safari matrix, responsive widths, screen-reader/keyboard/contrast/reduced-motion/WCAG 2.2 AA review.
- No sustained throughput/load test, failure-injection, DDoS test, external provider contract test, production secret rotation, or independent penetration/security assessment.
- No production backup/restore or off-site/PITR drill, measured RPO/RTO, centralized observability, SLO, on-call or incident response rehearsal.
- No legal/privacy professional review or compliance assessment.
- No production host/domain, deployment, or provider activation — including a real Resend sender/domain, so verification and password-reset email has never been delivered anywhere.
- Image storage is a single local directory; no multi-instance, object-storage, CDN, antivirus or EXIF-stripping behaviour was tested.

Archived local SQLite backup/restore and sequential health/search timing checks are historical evidence only. They must not be described as production recovery, performance, capacity, or SLO results.
