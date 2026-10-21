# Live threat model and residual-risk register

Living engineering reference. OWASP ASVS 5.0.0 and NIST SSDF guide review activity; this document is not an assessment or certification. No independent penetration test has been completed.

## Assets and trust boundaries

**Assets:** passwords (bcrypt hashes), session cookies/revocation state, TOTP and webhook secrets, consumer contact/location/history, merchant inventory and batches, reservations, in-app notifications, audit/security events, and demo/source data.

**Boundaries:** browser/PWA → Next.js `src/proxy.ts` → route handlers → Prisma/database; scheduler → authenticated job routes; outbound webhook delivery → merchant endpoint. External payment, POS, delivery, mail/SMS, routing, vision, and LLM providers are unconfigured.

## Threats, controls, and residual risks

| Threat | Existing control/evidence | Residual risk / required action |
|---|---|---|
| Credential stuffing/account enumeration | bcrypt cost 12; dummy comparison for unknown/deleted users; generic invalid-credential response; 5-failure/15-minute lockout; auth rate limit. Login flow exercised in HTTP tests. | Per-process/IP throttling is not distributed; no bot defense or monitoring; review timing on real deployment. |
| Session replay/theft | HttpOnly, SameSite=Lax, Secure-in-production cookie; hashed `jti` in revocable DB session; logout/password changes revoke; 7-day absolute and 4-hour admin idle expiry. | XSS, secret exposure, DB outage, and production key rotation need separate testing. |
| Admin takeover | TOTP enrollment/verification; secret encrypted with AES-GCM; warning for administrators without MFA. | MFA is not hard-required. Define bootstrap/recovery and enforce before launch. |
| Broken access control / tenant leak | Server-side role/ownership checks; cross-user list read/update tests; consumer identity withheld in merchant reservation/appointment projections. | Route-by-route review remains open; test PostgreSQL and staff memberships. Current fixture has limited staff coverage. |
| Reservation oversell / invalid stock | Transactional revalidation, batch exclusions, product/variant compare-and-swap; isolated SQLite last-unit planner race test passes. | PostgreSQL isolation and concurrent batch quarantine/status changes are untested; reservation direct-route concurrency also needs provider-specific testing. |
| Expired/held inventory never released | Expiry timestamp and transactional release endpoint exist. | No scheduler is configured; without it, pending holds can remain. Configure, alert, and reconcile before operations. |
| CSRF / cross-origin mutations | SameSite=Lax; mismatched Origin rejected on state-changing routes; only `/api/jobs/*` is Origin-exempt because production routes require `CRON_SECRET`; webhook subscription CRUD remains cookie/Origin protected. | Missing Origin is accepted; custom domain/subdomain/proxy behavior needs review. CSP uses inline allowances. |
| SSRF through webhook | URL validation at create and send; private/reserved IP rejection; DNS pinning; redirects blocked; timeouts/payload bounded. | No production egress allowlist or external penetration test. |
| Sensitive-data disclosure | Private/no-store auth responses; password hash/MFA secret excluded from auth view; tested merchant privacy projections. | Broader API schemas, backups, admin access, exports, retention, and production logs require review. |
| Malicious upload | Image magic-byte and size checks; in-memory processing; no external vision provider connected. | Parser/library risk remains; no AV scanning because files are discarded; recognition is not claimed. |
| Secret compromise/key loss | No secrets in source; encrypted TOTP/webhook secret envelope; fail-closed unreadable MFA; key length validated at use. | No key rotation/versioning, KMS or provider secret manager is configured; losing key breaks decryption. |
| Denial of service | Body `Content-Length` cap and bounded process-local rate buckets. | No WAF/global limiter/shared store; forwarded-IP source must be sanitized; per-instance control is not DDoS protection. |
| Supply-chain findings | Lockfile; production-only audit currently 0; Vitest 4.1.12; Node 24 target; checkout/setup-node actions pinned to immutable SHAs; CI runs full high-severity audit after integration. | Full audit currently has 5 high dev-tooling advisories in the Next lint dependency chain, so the CI gate will fail until remediation/owner decision; lint backlog remains. |
| Operational outage/data loss | Health route checks DB/config; local checksum backup + scratch restore script was exercised. | No production DB, PITR/off-site backup, central monitoring, on-call alerting, restore drill, SLO, or recovery objective. |
| Accidental synthetic-seed wipe/contamination | v1/v2/v3 sample seeds require demo mode, explicit opt-in, file-backed SQLite, and non-production runtime; unit tests cover refusals. | A developer can still explicitly opt in against a valuable local SQLite file. Exclude all synthetic seeds from production deployment jobs and reconcile data before launch. |
| Unsupported credential/provider assumption | API-key records are not accepted by routes; Connect records do not imply provider connection; payment/delivery not connected. | Keep user-facing availability explicitly unavailable until actual adapters pass end-to-end verification. |

## Production hardening gates

- Enforce admin MFA with approved bootstrap/recovery; establish support/admin separation of duties.
- Select PostgreSQL and execute reviewed migrations, production transaction/concurrency tests, and restore drills.
- Configure a shared/edge abuse control and trusted proxy IP handling.
- Configure the scheduler, supported-job handlers, alerting, and expiry reconciliation.
- Configure central logs/APM/alerts with retention, access controls, redaction, and incident runbooks.
- Remediate or explicitly accept the development audit findings; reduce the strict lint backlog rather than treating the baseline as clean.
- Independently test ASVS-oriented controls, privacy, WCAG 2.2 AA, and hostile inputs.
