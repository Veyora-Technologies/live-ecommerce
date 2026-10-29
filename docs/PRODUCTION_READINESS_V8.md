# Furnivo V8 production-readiness engineering report — historical checkpoint

> Current status is maintained in [`DEPLOYMENT_READINESS.md`](DEPLOYMENT_READINESS.md). This V8 file and [`PRODUCTION_READINESS_V9.md`](PRODUCTION_READINESS_V9.md) are historical evidence snapshots only.

**Assessment date:** 2026-10-21  
**Decision:** **NOT production-ready. Do not deploy this workspace or switch `LIVE_DATA_MODE` to `production` yet.**  
**Standards reference:** OWASP ASVS 5.0 and NIST SSDF are review references only; no assessment or certification is claimed.

## Executive summary

V8 preserved Furnivo's identity and existing stack. Work concentrated on evidence-backed auth, inventory, cart, request-boundary, recovery-script, API-contract, seed-safety, and CI improvements. Local checks now include a full optimized build and a 113-test HTTP integration suite against that build with an isolated SQLite fixture. That is meaningful local evidence, not production evidence.

The largest release blockers remain: SQLite-only persistence with no committed migrations/production DB, optional administrator MFA, process-local rate limiting, no configured scheduler or observability, unresolved strict-lint debt and five high development-tooling advisories, incomplete browser/accessibility testing, and no production restore/load/security verification.

## Architecture and scope retained

- **Modular monolith:** Next.js 16.4.2 / React 19.3.0, TypeScript, Prisma 5.22, SQLite fixture. Existing Next App Router and Prisma remain; no new platform/service architecture was added.
- **Server-side security:** revocable session cookie, `jti` hash in database, server-enforced route authorization, merchant memberships, admin roles, security headers, origin checks, request ID correlation, payload-length limits, per-process rate limits.
- **Inventory/reservation:** batch exclusions and reserved quantities affect reservable availability. Product/variant stock mutations now use a compare-and-swap helper within a Prisma transaction. A submitted pending reservation creates a temporary hold immediately; no payment is taken by Furnivo.
- **Planner cart:** item-by-item pickup submissions recheck current merchant/branch/stock/variant/price; separate reservations allow partial success; deterministic idempotency keys and cart-item deletion are in the same transaction; unsupported delivery is rejected; pickup windows are left unset rather than fabricated.
- **External capabilities:** no payment, POS, supplier, delivery dispatch, road routing, mail/SMS, vision, external AI, shared cache/queue, production database, or production host is configured. API-key records are not accepted as bearer credentials. Generic background-job event handlers are not implemented.

More detail: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`API.md`](API.md), and [`INTEGRATIONS.md`](INTEGRATIONS.md).

## Changes implemented in this checkpoint

1. **Authentication enumeration hardening:** unknown/deleted login identifiers perform dummy bcrypt work; suspended/locked state is disclosed only after a correct password. Existing session revocation and generic login responses remain.
2. **Reservation correctness:** added conditional product/variant stock claims to reject changed stock snapshots and return a retryable conflict. Added unit coverage for CAS success/stale snapshots.
3. **Planner cart correctness and honesty:** server rejects delivery requests, verifies approved merchant/open branch/pickup support and variant ownership, checks blocked/expired batches, applies current price/promotion, creates one pending reservation per item, stores idempotency, and records notifications/audit. The UI now explains that the stock hold begins on successful submission and is released only by an operating expiry job. Fake “today until 6pm” pickup windows were removed.
4. **Proxy and health boundary:** migrated from deprecated `middleware.ts` convention to Next 16 `src/proxy.ts`; rate-limit categories are independent and bucket memory is bounded; oversized request IDs are replaced. Public health no longer exposes provider-credential presence or stale `3.0` version metadata.
5. **Recovery scripts:** backup uses SQLite's consistent backup API (`sqlite3` or Python stdlib) rather than plain copy fallback; restore checks checksum, SQLite integrity, and Prisma reads in a scratch file. Scripts are executable.
6. **Build and seed safety:** CI now defines Prisma validation, typecheck, lint debt budget, unit tests, production dependency audit, isolated seed, build, and HTTP integration against the production build. CI secrets and demo account passwords are generated per run. Destructive/additive synthetic seeds require explicit demo opt-in, file-backed SQLite, and a non-production runtime; seeded passwords are supplied by environment, not committed.
7. **API contract:** OpenAPI was narrowed to verified critical routes; unsupported bearer API-key authentication was removed from the advertised security schemes.
8. **Test tooling:** Vitest moved from 3.2.7 to the audited patched 4.1.12. The lockfile was installed with `npm ci --legacy-peer-deps`; no Playwright/Chromium was installed.
9. **Demo seed guard:** base, v2, and v3 synthetic seed scripts now require demo mode, an explicit `LIVE_ALLOW_DEMO_SEED=1` opt-in, a local `file:` SQLite URL, and a non-production runtime. Base account passwords are generated outside the repository and bcrypt-hashed at cost 12.

## Geography data provenance

The local geography import is based on the Nigeria COD administrative-boundaries dataset published through HDX (metadata lists 37 admin-1 units—36 states plus FCT—and 774 LGAs; the dataset page records CC BY-IGO terms and a 2025-10-30 review date). The bundled workbook is `prisma/data/nga_admin_boundaries.xlsx`; its capital-sheet P-codes differ from admin-sheet P-codes, so capitals are not joined by P-code. Unit tests cover the supported geography records, but feature completeness/currentness, attribution obligations, and redistribution licensing must be rechecked before production. A selectable/searchable geography is not proof of Furnivo's merchant or delivery coverage.

## Authentication, UI, backend, and security tests

### Latest automated outcomes

| Check | Outcome | Conditions |
|---|---|---|
| `npm ci --legacy-peer-deps` | Pass | Lockfile install; current full audit still has five high dev-tooling findings. |
| `prisma validate`, generate, isolated SQLite `db push`, `npm run db:seed` | Pass | Fresh isolated fixture; base seed guard and per-run random demo passwords verified. No PostgreSQL provider/migration tested. |
| `tsc --noEmit --incremental false --pretty false` | Pass | Also passed the TypeScript step inside `next build`. |
| Default `npm test -- --reporter=dot` | **97 pass, 16 skip** | 21 files; Vitest 4.1.12; skipped HTTP groups are enabled only by `LIVE_INTEGRATION=1`. |
| `LIVE_INTEGRATION=1` against dev server | **106/106 pass (earlier run)** | Loopback, seeded local SQLite, before the additional seed-safety unit and recalled-batch tests. |
| `LIVE_INTEGRATION=1` against optimized production build | **113/113 pass (latest)** | Fresh isolated SQLite database, demo seed with random CI passwords, random CI JWT/encryption/cron secrets, loopback only. |
| `npm run build` | Pass | Next 16.4.2; 63 static pages generated; production server started. |
| `npm run lint:ci` | Pass | No per-file/per-rule regression against `eslint-baseline.json`. Not a clean lint result. |
| `npm audit --omit=dev --audit-level=high` | Pass | Zero runtime dependency advisories at assessment time. |
| `npm audit` (all dependencies) | **5 high, 0 critical** | Dev tooling chain described below. Command exits non-zero; CI displays it as non-blocking. |
| `scripts/backup.sh` + `scripts/restore.sh` | Pass, scratch only | SQLite integrity passed; Prisma read counts: 10 users, 6 merchants, 62 products. No production/offsite recovery claim. |

Integration coverage includes valid/invalid login, cookie/session persistence, logout revocation, protected routes, merchant landing, admin-analytics denial for a consumer, list tenant isolation, privacy projection, search, job dry-run, unsupported delivery rejection, a **two-user/one-unit planner race** with exactly one reservation, and a recalled-parent-batch case that blocks both direct and planner variant submissions. Seed safety has unit tests and the production configuration refusal was exercised for all three sample seed scripts. The new reservation CAS helper has unit tests; production PostgreSQL and direct reservation-route concurrency still require provider-specific tests.

An initial production-mode integration attempt returned 503 on job expiry because the CI server lacked `CRON_SECRET`; CI and the test request were corrected to generate/use a per-run CI-only secret. The latest optimized-build suite then passed 113/113. Demo account passwords are randomly generated per run; no repository-fixed successful-login password or production credential was used.

### Browser and responsive work

Prior browser runs verified sign-in/logout/protected routes, merchant-owner landing, consumer privacy projections, invalid-login messaging, and no horizontal overflow for homepage/merchant views at 320, 375, 430, 768, 1024, 1280, 1440, and 1920px; Products was checked at 320px. After the browser-tool environment reset, the latest cart UI copy/flow and administrator 320px wrapping edit were **not rechecked in a browser**. The admin fix was previously made after observing 355px document width at 320px; it remains unverified.

`playwright-cli` is unavailable in the current environment; `@playwright/test` is not in the project lockfile. `playwright.config.ts` and `tests/e2e/flow.spec.ts` are not evidence of an E2E pass. No current WCAG 2.2 AA, assistive-technology, or full post-V8 viewport audit is claimed. The local production-build preview is running with `LIVE_DATA_MODE=demo` and an isolated sample database.

## Performance evidence (local smoke only)

Against the optimized local build backed by a demo SQLite fixture, five warm-ups were followed by 30 sequential measured requests per endpoint. All 35 responses per endpoint were HTTP 200:

| Endpoint | p50 | p95 | max |
|---|---:|---:|---:|
| `/api/v1/health` | 4.3 ms | 6.1 ms | 9.3 ms |
| `/api/v1/search?q=paracetamol` | 16.9 ms | 28.0 ms | 45.6 ms |

Not a load test, device/network benchmark, concurrency capacity estimate, SLO, or production target. No sustained load, saturation, failure injection, Core Web Vitals, or production telemetry was run.

## Reliability, recovery, observability, and CI/CD

- Health checks database/config readiness and returns coarse 200/503 status. Responses carry sanitized `x-request-id`; this is correlation only. There is no configured APM, OpenTelemetry, central logs, alert receiver, error budget, or SLO.
- Rate limits (20 auth/min, 120 search/assist/min, 240 API/min) are in-process; the host must sanitize forwarded IPs. Multi-instance/global abuse protection is not verified.
- Reservation expiry and supported alerts/webhooks require an operator-configured, monitored cron. Generic `BackgroundJob` handlers are unsupported; webhook delivery is at-least-once. Without a functioning expiry job, a pending hold may remain.
- A local SQLite backup/restore scratch drill passed. Off-site retention, backup encryption, provider PITR, production restore, and RPO/RTO are unverified.
- `.github/workflows/ci.yml` defines the expanded checks and parses as YAML locally, but GitHub Actions has not run this workflow. Equivalent important steps ran locally. Actions are referenced by version tags, not immutable SHAs.

## Dependency and static-analysis risk

- Current runtime-only audit: 0 advisories.
- Full audit: 5 high findings in dev-only `eslint-config-next` / `@next/eslint-plugin-next` transitive `fast-glob` → `micromatch` → `braces` packages. npm's proposed remediation downgrades `eslint-config-next` to 14.2.35, which is incompatible with Next 16.4.2. No unreviewed force fix was applied. Track a compatible upstream resolution or explicitly risk-accept before any CI change.
- `otplib@12` and ESLint 9 packages emit deprecation/support warnings; test a compatible upgrade plan.
- Strict `npm run lint` fails with **301 errors and 25 warnings across 79 files** (274 explicit-`any` findings plus hooks, unused variables, and image findings). `lint:ci` prevents new file/rule debt; it does not satisfy “lint clean.”

## Production blockers and external setup

Before go-live: select production host/domain and PostgreSQL; convert schema with reviewed migrations; configure HTTPS/secrets/secret rotation; enforce admin MFA with safe bootstrap/recovery; configure trusted proxy IP/rate limiting, job scheduler/monitoring, database backup/PITR and production restore, centralized logs/APM/alerts, incident response, privacy retention, actual providers as needed, full accessibility/browser testing, load/concurrency testing on PostgreSQL, audit remediation, and independent security review.

Do not claim production deployment, provider integrations, payment verification, security certification, penetration test, ASVS/NIST verification, WCAG conformance, tested production restore, SLO, capacity, or production readiness. See [`GO_LIVE.md`](GO_LIVE.md) for release gates.
