# Furnivo V9 production-grade engineering report — historical snapshot (superseded)

> Current architecture, feature status, verification evidence, and release decision are maintained in [`DEPLOYMENT_READINESS.md`](DEPLOYMENT_READINESS.md). This V9 file is retained for historical context and is not current acceptance evidence.

**Assessment date:** 2026-10-21  
**Release decision:** **NOT production-ready. Do not deploy this workspace or switch `LIVE_DATA_MODE` to `production` yet.**  
**Verification references:** OWASP ASVS **5.0.0** and NIST SSDF are review guides only. No compliance assessment or certification is claimed.

## Executive outcome

The existing Furnivo application was preserved as a modular monolith and audited before the V9 changes. Targeted defects were fixed and verified locally. The current evidence includes a production build and a 114-test HTTP integration run against that build with an isolated, randomly credentialed SQLite fixture. These results do not prove production operation, PostgreSQL transaction behaviour, supported-browser compatibility, recovery, sustained capacity, or deployment.

The repository is **not approved for a real launch**. The highest-risk blockers are the absence of a production host/domain and PostgreSQL migration path, optional administrator MFA, no monitored reservation-expiry scheduler, process-local rate limiting, no central observability/incident service, no production restore drill, incomplete browser/accessibility verification, and unresolved static-analysis/development dependency debt.

## Repository audit and retained architecture

| Area | Observed state |
|---|---|
| Frontend/runtime | Next.js 16.4.2 App Router, React 19.3.0, TypeScript. Consumer, merchant, admin and API routes share one application. |
| Data access | Prisma 5.22, SQLite in local/CI fixtures. No committed Prisma migration history or tested PostgreSQL conversion. |
| Authentication | bcrypt password hashes, signed HttpOnly cookie, database-backed revocable session `jti`, server-side route authorization, TOTP support. Administrator MFA is not mandatory. |
| Search | Local database/rule-based search and geographic filters; not an external search cluster or AI provider. `nearest` is straight-line only. |
| Background work | Cron-authenticated route handlers for supported alerts/webhooks and reservation expiry exist. No scheduler, alert receiver, durable worker service, or generic `BackgroundJob` handlers are configured. |
| Integrations | No production payment, POS, delivery dispatch, routing, mail/SMS, vision, external AI, object storage, or provider credentials are configured. API credential records are not accepted as bearer authorization. |
| Operations | A coarse database/config health endpoint, request IDs, database audit/security events and local SQLite backup scripts exist. No central logs/APM/tracing/alerts/SLO is configured. |

A modular monolith remains the appropriate current shape. No microservices, Kubernetes, Redis, hosted queue, or search service was added without workload/provider evidence. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

## V9 code changes

1. **CSRF boundary corrected:** `/api/webhooks` performs session-authenticated subscription CRUD, so it is no longer exempt from Origin checks. Only `/api/jobs/*` remains exempt; production job handlers require `CRON_SECRET`. A unit regression test checks that mismatched-origin webhook creation is rejected while the cron route reaches its own secret check.
2. **Batch/variant stock safety tightened:** product-level recalled, quarantined, inactive, and expired batch quantities now cap availability for variants in direct reservation, planner submission, and cart display. Without a batch-to-variant relation, the code conservatively refuses variant stock beyond the unblocked parent-product quantity. An HTTP integration test proves both direct and planner variant requests reject a fully recalled parent batch without creating a reservation or incrementing stock holds.
3. **Synthetic seed safety:** destructive base and additive v2/v3 demo seed scripts require `LIVE_DATA_MODE=demo`, explicit `LIVE_ALLOW_DEMO_SEED=1`, a file-backed SQLite URL, and a non-production runtime. Base-seed consumer/admin passwords are generated per run and supplied through environment variables; weak repository-fixed successful-login passwords were removed. Guard tests and production-config refusal checks pass. Demo records remain clearly sample-only and must never be migrated as actual merchant data.
4. **Runtime and CI supply-chain hardening:** moved the release target from the sandbox's Node 20.20.2 (EOL 2026-04-30; see the [official release table](https://nodejs.org/en/about/previous-releases)) to tested Node 24.22.0, added the `>=24 <25` engine constraint, and pinned `actions/checkout` v7.0.1 and `actions/setup-node` v7.1.0 to full immutable SHAs. Their tag-to-commit resolutions were checked. The updated workflow has not been executed on GitHub Actions.
5. **Documentation and release controls:** added browser support policy, performance/capacity objectives and assumed staging load profile, prioritized backlog, and this V9 readiness report. Updated the v3 feature-status page to identify itself as historical.
6. **No new runtime service/dependency was added for V9.** Existing V8 auth/session hardening, planner transaction logic, bounded rate buckets, backup scripts, CI fixture, and API contract changes were retained.

## Verification evidence

| Check | Result | Conditions and limits |
|---|---|---|
| `npm ci --legacy-peer-deps` | Pass on Node **24.22.0** | Installed 474 packages; npm reported five high issues in the full dependency tree. Install emitted `otplib@12` and ESLint 9 support/deprecation warnings. `package.json` now requires Node `>=24 <25`. |
| Prisma validate/generate/SQLite `db push`/base seed | Pass on Node 24.22.0 | Fresh isolated SQLite fixture; random consumer/admin demo passwords and dummy JWT/encryption/cron secrets. No production credentials. |
| TypeScript | Pass | `./node_modules/.bin/tsc --noEmit --incremental false --pretty false`; build also completed TypeScript. |
| Default Vitest | **98 passed, 16 skipped** | 21 files, Vitest 4.1.12 under Node 24.22.0; skipped HTTP tests run only with `LIVE_INTEGRATION=1`. A non-fatal Vite warning remains about ESM syntax in `vitest.config.ts` under the native config loader. |
| Production-build HTTP integration | **114/114 passed** | Node 24.22.0 optimized Next build, loopback-only HTTP, fresh seeded SQLite fixture and per-run credentials. Covers auth/session/logout, protected routes, merchant privacy, cross-tenant list access, search, cron dry-run, delivery rejection, last-unit planner race, recalled-parent-batch variant rejection, and webhook Origin protection at proxy level. |
| Production build | Pass | Node 24.22.0 + Next.js 16.4.2; 63 static pages; production server started successfully. |
| ESLint debt budget | Pass | `npm run lint:ci` under Node 24: no per-file/per-rule regression against the stored baseline. This is not a clean lint result. |
| Strict full ESLint | **Fail: 301 errors, 25 warnings** | Across 79 files, including 274 `@typescript-eslint/no-explicit-any` findings. The debt-budget gate prevents regressions only. |
| Production dependency audit | Pass | `npm audit --omit=dev --audit-level=high`: zero production dependency advisories at assessment time. |
| Full dependency audit | **5 high, 0 critical** | Dev-only Next ESLint/transitive `fast-glob` → `micromatch` → `braces` chain. npm's suggested fix downgrades `eslint-config-next` to 14.2.35 and is incompatible with the Next 16 stack; no force downgrade was applied. Full audit exits non-zero; the CI full-audit step is blocking at high severity and currently fails after integration until a compatible fix or explicitly approved exception is recorded. |
| Synthetic-seed guard | Pass | Base/v2/v3 scripts refused a production-mode/PostgreSQL configuration before database work; unit tests cover missing opt-in, wrong mode, non-SQLite URL and production runtime. |
| Backup/restore | Pass, local SQLite scratch only | Prior local test verified checksum, SQLite `integrity_check`, and Prisma counts (10 users, 6 merchants, 62 products). No off-site, encrypted, provider-level or production recovery test. |
| Workflow/OpenAPI syntax | Pass | GitHub workflow YAML parsed locally; scoped OpenAPI 3.0.3 document parses and lists nine critical paths. GitHub Actions itself has not run. |
| Diff hygiene | Pass | `git diff --check` is clean at this checkpoint. |

### Local performance smoke — not a load test

Against the optimized Node 24.22.0 local build backed by the demo SQLite fixture, five warm-ups were followed by 30 sequential measured GETs per endpoint. All 35 responses per endpoint returned HTTP 200:

| Endpoint | p50 | p95 | max |
|---|---:|---:|---:|
| `/api/v1/health` | 2.5 ms | 3.6 ms | 5.2 ms |
| `/api/v1/search?q=paracetamol` | 11.4 ms | 13.0 ms | 14.9 ms |

These are local process/SQLite measurements. They do not measure browser rendering, real network/mobile conditions, concurrent throughput, PostgreSQL, provider latency, or capacity. The provisional staging profile is documented in [`PERFORMANCE_AND_CAPACITY_V9.md`](PERFORMANCE_AND_CAPACITY_V9.md); it has not been run.

## Authentication, UI, and browser evidence

The automated HTTP suite exercises real seeded sign-in, invalid credentials, session persistence, logout revocation, protected-route redirects, role landing and server-side authorization. Merchant reservation/appointment projections and consumer list isolation are covered. No auth bypass or fixed repository login password was introduced.

Earlier workspace browser checks covered selected consumer and merchant flows and responsive widths, but the browser version/engine metadata was not retained. The V9 workspace did not expose a usable cross-browser runner and `@playwright/test` is not a project dependency. No Chrome/Edge/Firefox/Safari matrix, current admin 320px fix verification, post-V9 cart browser pass, screen-reader test, or WCAG 2.2 AA audit is claimed. See [`BROWSER_SUPPORT.md`](BROWSER_SUPPORT.md).

## Security, reliability, and supply-chain posture

- Login enumeration work is equalized for unknown/deleted accounts; session revocation, lockout, encrypted TOTP secrets and server-side authorization are implemented. Account lockout is not distributed abuse protection.
- **Administrator MFA remains optional** and is a hard go-live blocker.
- CSRF mismatched-Origin protection now covers webhook subscription mutations. Missing Origin is still accepted; actual reverse-proxy and custom-domain behaviour requires staging verification.
- Rate limits are bounded but process-local; forwarded IPs must be sanitized by a trusted edge. They are not multi-instance throttling or DDoS protection.
- Reservations create temporary holds immediately. Without configured/monitored expiry cron, holds can remain. Generic background-job handlers are unsupported; webhook delivery is at-least-once.
- There is no production database, host, canonical domain/TLS, secret manager, central logs/traces/alerts, payment verification, external provider, RUM/Core Web Vitals telemetry, SLO, incident response ownership, or production restore evidence.
- OWASP ASVS 5.0.0 and NIST SSDF have not been assessed. There is no penetration test, independent security audit, or security certification.

## Geography and data provenance

The local Nigeria geography import derives from an HDX/OCHA COD administrative-boundaries dataset. Its metadata lists 37 admin-1 units (36 states plus FCT), 774 LGAs and partial ward features; the dataset page records CC BY-IGO terms and a 2025-10-30 review date. The workbook is `prisma/data/nga_admin_boundaries.xlsx`; its capital-sheet P-codes differ from admin-sheet P-codes and are not joined by P-code. Recheck currency, feature completeness, attribution and redistribution terms before production. Selectable/searchable geography does not establish merchant, stock, or delivery coverage.

## Deployment status and remaining owner actions

**No production deployment was made.** The V9 local preview used an optimized Node 24 build, disposable sample database, and random test secrets; it was stopped and its temporary environment/fixture were removed after verification. It was not a production URL or real commercial coverage. The CI workflow now targets Node 24 and pins the checkout/setup-node actions to immutable SHAs, but the workflow itself has not been executed by GitHub Actions. No production provider credentials or hosting permissions were available in this workspace.

Before launch, owners must select and provision the production environment, convert and migrate to PostgreSQL, require admin MFA, configure external expiry scheduling, shared rate controls, monitoring/alerts, backups/PITR and restore drills, verify geography licensing and real listing provenance, run browser/accessibility tests, execute the provisional PostgreSQL load profile, resolve or accept dependency/static-analysis findings, and complete security/privacy reviews. The full prioritized queue is [`ENGINEERING_BACKLOG_V9.md`](ENGINEERING_BACKLOG_V9.md); release gates are [`GO_LIVE.md`](GO_LIVE.md).

**Do not claim:** production readiness/deployment, browser-matrix compatibility, WCAG conformance, provider integrations, tested production restore, RPO/RTO, SLO, ASVS/NIST verification, penetration-test completion, a fixed concurrency/RPS limit, or infinite/zero-defect reliability.
