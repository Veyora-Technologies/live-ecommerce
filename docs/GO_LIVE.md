# Go-live checklist — **NO-GO**

**Current authority:** [`DEPLOYMENT_READINESS.md`](DEPLOYMENT_READINESS.md) contains the canonical architecture, feature status, verification evidence, safe initial scope, blockers, and accountable deployment actions. This checklist is an execution index, not a separate readiness certification.

> **Prior warning, preserved verbatim:** “NOT production-ready. Do not deploy this workspace or switch `LIVE_DATA_MODE` to `production` yet.”

No production deployment, production database write, migration, domain cutover, or provider activation occurred. Local passes do not change the NO-GO decision.

## Critical gates — all must be evidenced before a GO decision

- [ ] Select and provision a production host, HTTPS domain, staging environment, network policy, trusted proxy, and separate credentials.
- [ ] Convert the SQLite-only Prisma datasource to the selected production provider in a dedicated reviewed change. Add a baseline and versioned migrations; rehearse on clean and sanitized representative data; test rollback/recovery, stock races, and idempotency. Never `db push` against valuable/prod data.
- [ ] Keep the production data-mode kill gate closed until provider conversion, migrations, deployment, legal, data, and operations gates pass. Do not set `PRODUCTION_DATA_MODE_ENABLED=true` or `LIVE_DATA_MODE=production` as a shortcut.
- [ ] Remove synthetic/demo records from any future production environment. Verify real merchant identity, listing permission/provenance, truthful price/availability/freshness, approved public status, and merchant/location assignment. Do not guess country values for legacy records.
- [ ] Keep the initial deployment market Nigeria-only. Verify state/FCT geography source/version/licence/attribution and treat all geography as search context, not merchant or delivery coverage.
- [ ] Enforce admin MFA with a safe first-admin enrollment, recovery, rotation, and break-glass procedure; verify least-privilege admin/staff accounts.
- [ ] Keep reservation holds disabled until a monitored expiry scheduler, retry/reconciliation, duplicate handling, stock release audit, support ownership and runbook pass staging rehearsal.
- [ ] Keep payments, payouts, refunds, wallet/escrow/custody, delivery, other countries/currencies, unreviewed services/categories, and all unconfigured providers disabled at the server/API layer.
- [ ] Obtain qualified Nigerian legal/privacy review of the real operator, categories, data flows, policies, pricing, cancellation/refund/redress, seller/IP/safety process, retention, processor contracts, incident obligations and tax/funds arrangements as applicable. Do not claim compliance from application features.
- [ ] Either keep password-reset email unavailable with an owner-approved verified support path, or implement and verify an actual sender/domain adapter, delivery/retry handling and privacy-preserving messages. An API key alone is not email delivery.
- [ ] Configure and test shared rate/abuse controls, centralized redacted logs, metrics/traces, alerting, incident response, backups/PITR, encrypted off-site retention and independent production restore. Document real RPO/RTO and on-call owners.
- [ ] Resolve the blocking full dependency audit or record a narrowly scoped, owner-approved risk decision; reduce lint debt or explicitly maintain its budget with ownership.
- [ ] Install and approve browser test tooling. Run cross-browser/device/responsive, keyboard/screen-reader/zoom/contrast, WCAG 2.2 AA review, production-provider load/failure, security and recovery tests. Record actual versions and results.
- [ ] Run the full CI workflow from GitHub Actions and verify all gates after the final production build. The local HTTP suite used only a disposable SQLite fixture and a test-only auth-rate-limit override.

## Before any deployment

1. Assign named accountable owners for every row in §7 of `DEPLOYMENT_READINESS.md`; no owner identity/provider was supplied in this pass.
2. Use isolated staging, never the ignored local DB or the temporary isolated test database. Protect and rotate all actual secrets through the selected secret manager.
3. Obtain explicit business, operator, security, privacy/legal, and platform-owner sign-off against the actual artifact and actual environment.
4. Record a rollback decision and independent recovery evidence. Do not infer deployment success from a local `next start` server.

## Decision rule

The current status remains **NO-GO**. Change it only when every critical gate has evidence and accountable sign-off. Do not represent Furnivo as deployed, production-ready, legally compliant, accessible, load-tested, provider-connected, or geographically covered until those facts are independently verified.
