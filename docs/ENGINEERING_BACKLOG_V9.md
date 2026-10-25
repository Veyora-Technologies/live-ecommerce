# Furnivo V9 engineering backlog — prioritized by release risk

This backlog follows the repository audit and distinguishes code-level work from owner/provider work. Items marked “external” cannot be evidenced by a local build alone.

## P0 — release blockers

1. **Choose and provision the production environment (external).** Select host/domain/region, PostgreSQL tier, networking, staging/prod separation, pool limits, secret manager, storage, provider accounts, and budget. None is currently configured.
2. **Create the production database path.** Convert Prisma from SQLite in a dedicated change; commit a reviewed baseline migration; run upgrade/rollback/recovery tests on PostgreSQL; verify transaction isolation, unique/idempotency constraints, reservation races, and batch/variant quarantine races. There is no migration history or PostgreSQL verification.
3. **Enforce administrator MFA.** Design first-admin bootstrap, recovery, break-glass, key rotation, and least-privilege policy, then require MFA in production. Today, admins without MFA may sign in with a warning.
4. **Operate reservation expiry.** Configure an external scheduler, authenticate it with `CRON_SECRET`, alert on non-2xx/failures, reconcile stuck pending holds, and exercise duplicate/retry behaviour. Without this, reservations can hold stock indefinitely.
5. **Operate visibility and incident response.** Configure central structured logs, metrics, traces/APM, alert routing, retention/redaction, on-call ownership, dashboards, incident playbooks, and deploy/rollback controls. Request IDs and database audit rows are not centralized observability.
6. **Complete staging browser/accessibility verification.** Add an approved browser runner, test Chrome/Edge/Firefox/Safari and real iOS/Android workflows, then do keyboard/screen-reader/reduced-motion/contrast/text-zoom checks against WCAG 2.2 AA targets. The V9 pass did not run cross-browser E2E or an accessibility audit.
7. **Rehearse production recovery (external).** Implement managed encrypted backups/PITR, retention and access policy; run isolated production-like restore drills; assign RPO/RTO and alert on missed backups. Existing evidence covers only local SQLite scratch restore.
8. **Validate the geographic and commercial data before launch.** Recheck the HDX/OCHA source version, feature completeness, license/attribution and redistribution terms; verify every real merchant/listing and coverage boundary. A geography picker is not proof of commercial coverage.

## P1 — high priority before a public launch

1. **Dependency remediation.** Production-only audit is zero findings, but full audit has five high dev-tooling findings in the Next ESLint dependency chain. Keep the blocking production audit; resolve or formally risk-accept a compatible dev-tooling upgrade. Do not force the incompatible Next 14 downgrade.
2. **Reduce static-analysis debt.** Strict ESLint reports 301 errors and 25 warnings across 79 files, mostly 274 explicit `any` findings. The current `lint:ci` is a non-regression budget, not a clean static-analysis gate.
3. **Complete API security/contract review.** OpenAPI intentionally describes only nine verified critical paths; complete route inventory, schemas, auth/error/pagination/idempotency contract tests, tenant isolation and privacy projection review for every sensitive endpoint.
4. **Adopt shared abuse controls.** Replace process-local rate limits with edge/shared-store controls after the host/proxy is chosen; explicitly configure trusted forwarded-IP handling, quotas, timeouts, request-size enforcement and overload behaviour.
5. **Measure production-like performance.** Add privacy-reviewed RUM, set release budgets, run the provisional 50-VU/20-read-RPS/2-reservation-RPS staging profile on PostgreSQL, profile actual bottlenecks and document capacity. Current local SQLite numbers are sequential smoke only.
6. **CI/CD execution and scanning.** Run the actual GitHub Actions workflow (checkout/setup-node are now SHA-pinned); add approved secret scanning/SAST/license policy, lock deployment permissions, migration gate and post-deploy smoke. Local equivalent commands are not evidence of a GitHub run.
7. **Business workflow verification.** Execute consumer, merchant, admin, notification, upload, booking and failure/retry journeys on the chosen production database. Payment, delivery, POS, routing, mail/SMS, image recognition, AI, and API-key bearer integrations remain disconnected.
8. **Secrets/CSRF operational review.** Establish key rotation and migration, verify reverse-proxy Origin/Host behavior and cookie settings on the real domain, and ensure webhook management remains Origin-protected while cron-only endpoints are secret-authenticated.

## P2 — maintainability and controlled scale-up

- Extract stable domain services from route handlers; add explicit domain error types and consistent response schemas without a broad rewrite.
- Add PostgreSQL contract/concurrency tests and migration rehearsal automation.
- Add supported E2E tests for sign-in/session restoration, navigation, inventory, reservation, logout, deep links, back/forward and network failure.
- Improve job idempotency, durable retry ownership, dead-letter/alert behaviour, and event-handler inventory before adding more job types.
- Add synthetic dependency and browser compatibility checks to release cadence.
- Set retention/deletion policies for consumer searches, recent views, reservations, security/audit records, uploads, and analytics.
- Upgrade deprecated `otplib@12` and unsupported ESLint packages only through API-compatible, tested migration work.

## Defects addressed during the V8→V9 engineering pass

- Fixed the broad CSRF exemption: `/api/webhooks` subscription CRUD now receives the Origin check; only `/api/jobs/*` is exempt because production handlers require a cron secret. A proxy unit regression test covers the distinction.
- Prevented product-level recalled/quarantined/expired batch blocks from being bypassed by a variant's own stock counter in direct and planner reservations, and capped planner display availability. A local HTTP integration regression test covers the case.
- Added explicit demo-only guards to synthetic base/v2/v3 seed scripts; base seed no longer embeds weak repository-fixed account passwords. It requires random environment passwords and refuses a production runtime, non-demo mode, missing opt-in, or non-file database URL.

These fixes do not close the external infrastructure, migration, monitoring, browser, accessibility, recovery, dependency, or capacity release gates above.
