# Live — deployment readiness and platform specification

**As of:** 2026-10-21  
**Decision:** **NO-GO for production.** No deployment, production database write, migration, domain cutover, or provider activation was performed.  
**Canonical status document:** this file is the current source of truth for the architecture, feature status, scope, and latest verification evidence. Earlier readiness records are historical snapshots only.

The recent changes address specific, evidenced defects and strengthen fail-closed behavior; they do not constitute production approval, legal review, security certification, or proof of operating readiness.

## 1. Product and operating boundary

Live is a Nigeria-first merchant-discovery and reservation-request platform. It is not currently a payment processor, delivery network, escrow/custody service, POS/supplier sync service, international marketplace, or external-AI product.

The candidate initial service scope, **only after the gates in §7 are closed**, is deliberately narrow:

1. Nigeria-only product discovery from real, permissioned merchant listings that have passed human review and have a truthful price, location, stock/freshness state, and provenance label.
2. No payment, payout, refund, wallet, escrow, deposit, or custody of customer/seller money by Live.
3. No delivery promise. Pickup may be offered only as a merchant-confirmed request; the platform does not invent a pickup window or confirm fulfilment.
4. Keep stock-holding reservation requests **disabled until** the expiry scheduler, monitoring, expiry/reconciliation procedure, and support ownership are proven in the selected production environment. Discovery-only is the safer interim scope.
5. Keep service bookings, regulated/high-risk categories, public seller contact/enquiry workflows, other countries/currencies, cross-border trade, and provider-dependent features off until their separate legal, safety, operational, and provider gates are approved.

Sample or demo records are not commercial inventory. A geography node is not proof of merchant coverage, stock, delivery, or support.

## 2. Architecture and persistence

| Layer | Current implementation | Readiness boundary |
|---|---|---|
| Application | Next.js 16.4.2 App Router, React 19.3.0, TypeScript; consumer, merchant, admin and API in one modular monolith. | Buildable locally; no selected production host or verified deployment. |
| Runtime | `package.json` targets Node `>=24 <25`; checks used Node 24.22.0. | GitHub Actions has not been run from this workspace. |
| Request boundary | `src/proxy.ts` applies security headers, payload limits, request IDs, Origin checks on mutations, and per-process rate limits. | Forwarded-IP trust and rate limits need the selected edge/shared-store design; this is not DDoS protection. |
| Domain/data layer | Route handlers plus `src/lib/*` domain helpers and Prisma Client. | Some policy/business logic remains in route handlers; not a fully separated service architecture. |
| Database | `prisma/schema.prisma` uses SQLite; local/CI fixtures use disposable SQLite files. | No committed Prisma migration history or verified production PostgreSQL/provider-conversion path. Do not use `db push` as a production migration. |
| External services | No production provider is connected or verified. | Provider records/configuration are not proof of a working integration. |

A read-only audit of the local SQLite file at `prisma/prisma/dev.db` found schema drift (including no `MarketplaceListing` table), six merchants and two branches without `countryCode`, and 62 products with `NGN`. This is local-file evidence only; it is not a production database. No historical country backfill was attempted. Database creation, schema push, seeding, and HTTP tests used disposable `/tmp` SQLite fixtures only; the latest HTTP suite used `/tmp/live-e2e-65b24e779b5b.sqlite`. No production database was available or written.

The source tree had no Prisma migrations directory/history. A reviewed baseline migration, provider conversion, representative-data rehearsal, rollback, and restore path remain owner/engineering work. Preserve the modular monolith until measured workload justifies additional infrastructure.

## 3. Market, location, and money rules

### Market scope

- The version-controlled allow-list contains **Nigeria (`NG`) only**. The app also requires an active persisted `Country` row whose currency, locale, and timezone match the registry; a database row alone cannot enable another market.
- Current defaults: `en-NG`, `Africa/Lagos`, `NGN` with two minor-unit places, metric system, `+234`.
- Country-less legacy merchants/branches are treated as Nigeria **only** by the Nigeria compatibility filters. Their values were not guessed or rewritten. Account country, user-selected search area, merchant operating country, transaction currency, and settlement arrangements must remain distinct.
- No other market, currency, payment/settlement provider, fulfilment provider, identity provider, or cross-border feature is configured. Schema/UI presence is not activation.

### Geography

The generated Nigeria tree contains 850 active nodes: country, 36 states, FCT, 768 LGAs, six FCT area councils, and 38 city/capital candidates. The importer represents the 774 admin-2 areas as 768 LGAs plus six area councils. Data tests verify the shape; they do not certify that each boundary/name is current, establish commercial coverage, or settle redistribution rights. The source metadata reports CC BY-IGO; re-check the current licence, attribution, completeness, and source version before production use. Do not infer service or merchant coverage from location search.

### Money and transactions

- `src/lib/money.ts` parses major-unit strings to integer minor units without rounding excess precision and uses `BigInt` for exact calculations/formatting. Existing product/transaction schema fields are integer minor units (legacy NGN=kobo); reservation totals are bounded by a signed 32-bit Prisma `Int` field.
- The current market config supports only NGN. Do not silently change a listing's agreed price, convert historical amounts, or backfill transaction country/currency assumptions.
- Reservation rows do not provide a complete transaction currency/market snapshot for future multi-market use. Before adding currencies, design versioned currency/market snapshots and migrate with evidence; do not infer historical values.
- Payments, settlement, refunds and fund custody remain disabled. No fees, provider, exchange rate, or safeguarded-money arrangement is asserted.

## 4. Feature inventory and availability decision

“Verified locally” means the named automated/local checks passed under the stated fixture; it does not mean production-ready, externally connected, legally approved, or commercially available.

| Capability | Current status | Evidence / deployment gate |
|---|---|---|
| Sign-up and role assignment | **Local consumer registration only; verification/provider incomplete** | `POST /api/auth/register` creates only `CONSUMER` and ignores client-supplied privileged roles, then issues a session immediately. The latest fresh-fixture HTTP suite verifies role non-escalation, but not verified email/phone or provider-backed signup. `emailVerifiedAt`/`phoneVerifiedAt` fields exist, but no account-verification routes or delivery adapters were found. |
| Sign-in, server-side sessions, logout | **Custom local auth only; external provider not selected** | The latest fresh-fixture local HTTP suite covers valid/invalid login, session lookup, logout revocation, protected pages and role checks. Current code uses bcrypt/JWT and Prisma `Session` over SQLite; no Supabase/Firebase SDK or provider-backed session is configured. This does not satisfy the requested provider integration or production-domain test. |
| Email verification | **Implemented; requires a configured sender** | `POST /api/auth/register` issues a single-use token and, when `RESEND_API_KEY` + `EMAIL_FROM` + a public HTTPS origin are set, emails `/auth/verify?token=…`; `PUT /api/auth/verify-contact` redeems it and sets `emailVerifiedAt`. Without a sender the response says `verificationDelivered: false` and returns no token in production. The token is still not required before a session is issued. **Phone/SMS verification is not implemented.** |
| Merchant image uploads | **Implemented locally; single-instance storage** | `POST /api/uploads` + `GET /api/media/[name]` (`src/lib/image-upload.ts`). Type is decided by magic bytes, 5 MB cap, random filenames, traversal-proof reads. Storage is one local directory (`LIVE_UPLOAD_DIR`, absolute path); multi-instance/CDN deployments must swap in object storage. Unconfigured deployments return `503 UPLOAD_NOT_CONFIGURED` instead of discarding files. |
| Password recovery | **Implemented; requires a configured sender** | Production sends a 30-minute single-use reset link through Resend when `RESEND_API_KEY`, `EMAIL_FROM` and a public HTTPS origin are configured; a failed delivery burns the token and logs `PASSWORD_RESET_DELIVERY_FAILED`. Without a sender it returns `503 PASSWORD_RESET_DELIVERY_UNAVAILABLE`, creates no unusable token and never claims delivery. Unknown accounts get the same generic answer. Development keeps a `devResetToken` path for isolated tests. A verified sending domain and a human support recovery path remain owner tasks. |
| Authentication provider and production configuration | **Blocked pending owner selection** | The owner selected “provider undecided.” No Supabase/Firebase SDK, provider credentials, production database, canonical domain, or production recovery sender is configured. SQLite is the only Prisma datasource and production data mode remains blocked. Do not claim the mandatory authentication acceptance criteria passed. |
| TOTP MFA | **Partial** | Authenticated enable/confirm/disable flow and encrypted secret storage exist. Admins can still sign in without MFA and receive a warning; enforcing admin MFA requires an approved bootstrap, enrollment, recovery and break-glass process. |
| Product discovery/search | **Implemented; data-dependent** | Local database/rule-based search, geography filters and freshness/availability labels are present. Search is not an external engine or LLM. `nearest` is straight-line distance, not routing. Production requires genuine, permissioned, human-approved, fresh listings. |
| Listing review/publication | **Implemented workflow; operator-dependent** | New projections default to review-required; a listing is not public merely because a projection exists. Human moderation is required. Synthetic fixture helper `approveFixtureProduct` is test-only and does not approve real listings. |
| Merchant inventory, branches, CSV | **Partial / owner-operated** | Existing workflows and stock checks are present. Provider sync is not connected. Do not infer a branch/country or trust sample stock. |
| Reservation requests and holds | **Implemented locally; disabled for production until operations prove readiness** | Local HTTP tests cover server revalidation, idempotency/stock race, and cart submit. A submission creates a temporary hold, not an order or payment. No monitored production expiry scheduler, reconciliation, or support rota is configured. |
| Planner cart | **Implemented; separate reservations only** | The server revalidates each line and creates separate per-merchant pickup requests; it is not a single multi-merchant checkout. Delivery is rejected. Keep out of a commercial flow until reservation operations are ready. |
| Service appointments/bookings | **Partial / defer** | Code and unit coverage exist; no production service-category/legal/provider/operational readiness is verified. Do not enable merely because UI/schema exists. |
| Seller enquiries, reviews, requests/quotes | **Partial / defer pending operations** | Some workflows and access controls exist. Do not expose personal contact or promise a response/redress service until privacy, trust-and-safety, moderation, complaint and staffing arrangements are confirmed. |
| Lists, saved searches, price alerts, in-app notifications | **Partial** | In-app records/controls and tests exist. Scheduled alert evaluation requires an operator-run scheduler; email, SMS and push delivery are not active. |
| Legal/privacy/complaints admin workflows | **Partial; professional review required** | Forms and deployment gates exist. No signed operator identity, current approved policies, qualified professional review record, legal compliance determination, privacy impact assessment, processor arrangements or redress operation has been evidenced. |
| Payment, payout, refund, wallet, escrow | **Disabled** | No verified provider or authorized reviewed funds arrangement. Do not accept, hold, transfer or safeguard funds. |
| Delivery, routing, POS, supplier sync, external AI/vision, SMS/email/push | **Unavailable / unconfigured** | No verified adapter/provider. A key, database record, label, or UI control is not a connection. |
| Other country/currency, cross-border commerce, multi-country inventory | **Disabled/planned** | Nigeria is the only active market; no international commercial availability is implied. |
| Merchant API credentials | **Record-only / no bearer access** | API-key records are not accepted by route handlers currently; do not present them as working developer API authentication. |
| SEO | **Public-only intent** | Only public, published listing pages may be indexed. Private accounts, drafts, sample/unreviewed records, and personal data must remain out of sitemaps/search engines. Crawl behavior still needs staging verification. |

### Server-side control rule

For production, disabled features must fail closed at the route/domain layer, not merely disappear from the UI. Current payment/delivery controls are disabled server-side; the production-data-mode guard also blocks operational market access while the SQLite-only/no-migration deployment profile remains unapproved. Before launch, test every disabled control by direct HTTP/API request as well as through the UI.

## 5. Security, privacy, seller and consumer protection

### Verified locally

- Password hashes use bcrypt; session tokens are HttpOnly/SameSite cookies with a server-side revocable session record and hashed `jti`; role/merchant checks are server-side.
- Registration ignores client-supplied privileged fields; the new HTTP test covers this.
- Existing local tests cover invalid credentials, logout, protected pages, merchant/customer data separation, and cross-owner shopping-list access.
- `src/proxy.ts` has request IDs, security headers, body limits, mutation Origin checks, and a bounded in-memory rate-limit map. The normal production auth bucket is 20 requests/minute per apparent IP and is **process-local**. The test-only override is described in §6.
- Production secret storage for supported encrypted values requires `LIVE_SECRET_ENCRYPTION_KEY`; loss/rotation recovery is not implemented. Existing encrypted values must be migrated/verified before production use.

### Blockers and limits

- **Admin MFA is not mandatory.** Do not grant production admin access until MFA enforcement, first-admin bootstrap, support-assisted recovery and break-glass procedure are implemented and tested.
- The rate limiter is not shared across instances. Reverse-proxy/forwarded-IP trust is not configured or verified; high-cardinality IPs are not a substitute for edge abuse controls.
- Database audit/security events are not tamper-evident centralized logs. No central logs, APM, traces, alert receiver, incident ownership, SLO, on-call rotation, or uptime monitor is configured.
- Reservation expiry is an operator-invoked job route; no durable schedule/monitor/retry/reconciliation evidence exists. Stale holds can affect inventory until expiry is run.
- No independent penetration test, threat-model verification, OWASP ASVS assessment, or NIST SSDF assessment has been completed. This document does not claim compliance or certification.
- No human seller identity/listing verification was performed for real merchants in this pass. Verification decisions must remain human-reviewed and must not be inferred from a badge, uploaded document, or sample seed.

### Qualified review required — not legal advice

Before any real transactions or consumer-facing commercial launch, have qualified Nigerian counsel/privacy professionals review Live's actual operator role, data flows, categories, user terms, privacy notice, seller terms, pricing/disclosures, complaint and redress handling, cancellation/refund treatment, product-safety and IP processes, tax/fee/settlement design, retention, processor arrangements, data-subject rights, incident duties, and any sector-specific rules. Do not claim compliance from the presence of admin forms or an `approved` field.

Official/source material for review (not a legal determination):

- [Nigeria Data Protection Act 2023 (NDPC-hosted)](https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf)
- [Nigeria Data Protection Act General Application and Implementation Directive 2025 (NDPC-hosted)](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf)
- [Federal Competition and Consumer Protection Act 2018 (FCCPC-hosted)](https://fccpc.gov.ng/wp-content/uploads/2022/07/FCCPA-2018.pdf)
- [FCCPC e-commerce business guidance](https://fccpc.gov.ng/business-guidance-on-e-commerce-2/)
- [FCCPC consumer rights and responsibilities](https://fccpc.gov.ng/consumers/consumer-rights-responsibilities/rights-responsibilities/)
- [NCC 2026 Internet Code of Practice](https://ncc.gov.ng/sites/default/files/2026-02/Internet-Code-of-Practice-2026.pdf) — applicability and final status require qualified review; no legal conclusion is made here.
- [HDX/OCHA Nigeria administrative-boundaries source](https://data.humdata.org/dataset/cod-ab-nga) — confirm current licence, attribution and redistribution terms before production use.

The FCCPC 2026 consumer-protection exposure draft is not treated as a binding final rule. Secondary-source claims not verified against an official source are not deployment gates here.

## 6. Recent changes and verification evidence

### Changes in this final acceptance pass

- Repaired the two cart-submit HTTP test fixtures to explicitly mark their synthetic listings `PUBLISHED`/`APPROVED`. Projection sync alone leaves a listing in `PENDING_REVIEW`; no application route defect was established by those earlier 404s.
- Fixed password-recovery UI request shape (`emailOrPhone`), visible error handling, and network-error/busy-state handling on forgot/reset pages.
- Removed the production recovery route's misleading “sent” success when `RESEND_API_KEY` happened to be present without a real sender. Production now reports `503` and explicitly says no email was sent; development-only reset tokens remain unavailable in production.
- Added HTTP coverage for registration privilege-field rejection, unavailable production recovery, and invalid reset tokens.
- Added a fail-closed production environment gate: unknown `LIVE_DATA_MODE` values and a production Node runtime using `LIVE_DATA_MODE=production` are marked invalid; the latter is blocked because this workspace still has a SQLite-only schema and no reviewed production migration/deployment path. The proxy returns 503 for page/API requests (except GET `/api/v1/health`); health reports degraded, legal/market gates deny production access, and direct operational-market access returns 503. `PRODUCTION_DATA_MODE_ENABLED` must not be flipped until the gates above are independently evidenced.
- Kept the ordinary production rate limit unchanged. For the isolated HTTP suite only, `LIVE_TEST_RELAXED_RATE_LIMITS=1` raises the auth bucket to 200/min when **all** of these are true: Node production runtime, `LIVE_DATA_MODE=demo`, and a `file:` SQLite URL. CI sets it only on the disposable test-server process; unit coverage proves production-mode and non-SQLite configurations do not get the override.

### Checks run

| Check | Latest result | Conditions / limits |
|---|---|---|
| Optimized production build | **Pass** | `npm run build` under Node 24.22.0 / Next 16.4.2; completed after the current source edits. A local build is not a deployment. |
| TypeScript | **Pass** | `tsc --noEmit --incremental false --pretty false`; the optimized build also ran TypeScript. |
| Default test suite | **129 passed; 30 skipped** | 22 files passed and five skipped. HTTP integration tests are gated unless explicitly enabled. Node 24.22.0 / Vitest 4.1.12. |
| Fresh-fixture HTTP integration suite | **159/159 passed; 27 files** | Against the optimized local production build and a seeded disposable `/tmp` SQLite fixture. The test-only relaxed rate limit was active only for the demo-mode SQLite server; this does not verify shared production throttling, provider auth, or browser behavior. |
| Production-mode gate smoke | **Expected 503s verified previously** | With `NODE_ENV=production`, `LIVE_DATA_MODE=production`, and an isolated SQLite fixture, `/` returned plain-text 503 (no sample page), `/api/v1/health` returned 503/degraded with `configValid=false`, and `/api/v1/search` plus `/api/auth/login` returned 503. No production write was made. |
| Prisma schema validation | **Pass** | `prisma validate --schema prisma/schema.prisma`. Schema push and seeding for the latest HTTP run targeted only a disposable `/tmp` SQLite fixture. No `migrate deploy`, production write, or migration rehearsal. |
| Clean dependency install | **Pass** | `npm ci --legacy-peer-deps --no-audit --no-fund` under Node 24.22.0 after repairing the lockfile. npm emitted deprecation warnings for otplib 12 and ESLint 9.39.5. |
| ESLint CI budget | **Pass, not lint-clean** | 282 errors / 24 warnings versus stored baseline 301 errors / 25 warnings; no per-file/rule regression. Strict full ESLint still has debt. |
| Runtime dependency audit | **Pass** | `npm audit --omit=dev --audit-level=high`: zero runtime advisories. |
| Full dependency audit | **Fail / unresolved** | `npm audit --audit-level=high`: five high-severity dev-tooling advisories, zero critical, in the `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces` chain. A forced fix would downgrade `eslint-config-next` to 14.2.35; no forced fix was applied. The full-audit CI/go-live gate remains unresolved. |
| Browser E2E | **Not run — tooling missing** | `@playwright/test` is absent from `package.json`/lockfile. No visual/browser/mobile/responsive/accessibility claim. |
| Deployment, production database, external providers | **Not performed** | Hosting, database/storage, domain and provider remain unselected; no production credentials were supplied. No deployment or provider activation is claimed. |

The latest integration run used the guarded Nigeria geography seed before marketplace/demo seeding; the fresh fixture reported 850 active geography nodes and 60 product projections. The missing active `Country` fixture that caused the earlier HTTP failures was corrected, and the rerun passed. The local `prisma/prisma/dev.db` was not used for schema push, seed, or integration writes. Archived local SQLite backup/restore checks are not production recovery evidence. GitHub Actions has not run from this workspace. The full dependency audit and missing browser workflow still prevent a clean CI/go-live sign-off.

### Authentication acceptance results from the current source audit

The fresh-fixture HTTP integration suite passed, but these local custom-auth checks do not complete the requested provider-backed authentication system or the required desktop/mobile browser acceptance matrix.

| Required scenario | Current result | Evidence / limitation |
|---|---|---|
| Register a customer and verify the account | **Code path exists; delivery not exercised** | Registration always assigns `CONSUMER`, ignores client-supplied privileged roles, and issues a local session. A single-use email token and `/auth/verify` page now exist, but no unit/integration test in this repository sends a real email, and no sender was configured here. **Do not claim a verified-account journey passed.** |
| Sign in; keep session after refresh | **Local HTTP session lookup passed; browser refresh not run** | The suite exercised valid login and `/api/auth/me` using the HttpOnly cookie. No real browser/device refresh test or external identity provider was used. |
| Restrict logged-out protected pages; logout revokes access | **Local HTTP integration passed** | The suite verified logged-out redirects for `/profile` and `/admin`, logout cookie clearing, and that the revoked cookie no longer resolves a user. This is not provider-backed or browser evidence. |
| Complete successful password reset | **Code path exists; delivery not exercised** | Invalid/expired/reused tokens are rejected in unit tests. Delivery is implemented but was never exercised against a real provider from this environment, and the earlier suite only proved the 503 path when no sender is configured. Live verification needs a configured domain. |
| Duplicate registration and invalid login | **Partial / incomplete** | The suite verified invalid credentials return 401 without issuing a session. It did not test duplicate registration, normalization edge cases, or concurrent duplicate registration. |
| Merchant registration and customer/merchant/admin boundaries | **Partial** | The suite exercised local merchant login and server-side role/tenant boundaries, including customer denial of merchant/admin surfaces and redaction of customer identity from merchant responses. Merchant onboarding was not a required successful browser journey here. |
| Production-domain redirects and recovery links | **Not run** | No canonical production domain or authorized redirect URL is selected. |
| Supabase/Firebase security rules and provider sessions | **Not implemented / not testable** | Provider remains undecided; there is no provider SDK/configuration, RLS policy set, or Firebase security-rule set to exercise. |
| Desktop/mobile end-to-end journey | **Not run** | Browser tooling is absent from the project install; no browser, device, responsive, or accessibility verification is claimed. |

The inspected local `.env` contains no Supabase/Firebase or email/SMS provider variables; its secret values were not output. Hosting, database/storage, production domain, sender, and provider selection remain unresolved. **Authentication remains NO-GO for the user's mandatory provider-backed acceptance criteria.**

## 7. Go-live gates and accountable actions

No owner identities or provider contracts were supplied. The roles below are responsibilities to assign, not fabricated people or approved providers.

| Gate | Accountable role | Required evidence before GO |
|---|---|---|
| Hosting/domain/network | Platform owner / SRE | Select host, canonical HTTPS domain, staging/prod separation, TLS, trusted proxy/CORS/origin policy, request-size limits, deployment permissions and monitored rollback. |
| Database/migrations | Platform + database owner | Select production database; convert Prisma provider; review/baseline migrations; rehearse upgrade, rollback and restore from clean and representative sanitized data; validate concurrency on that provider. Preserve all legacy relationships and never guess null country codes. |
| Real catalogue/seller trust | Marketplace operations | Remove synthetic records; collect permission/provenance; verify real seller identity and ownership; human-review listings; confirm refresh/staleness and takedown responsibilities; document coverage without inventing it. |
| Authentication/admin | Security + operations owner | Select and integrate Supabase Auth or Firebase Auth; reconcile the selected provider with the authoritative database and current Prisma model; add provider-backed verified email/phone flows, authorized callback/recovery URLs, server-side role mapping, RLS/security rules, least-privilege staff memberships, admin MFA bootstrap/recovery, session revocation and password recovery; complete the real provider/domain desktop/mobile acceptance matrix. |
| Reservations and support | Marketplace operations + support owner | Keep holds off until scheduled expiry, alerting, retry/reconciliation, duplicate protection, stock-release audit, complaint/refund/cancellation procedure, pickup confirmation and on-call ownership pass rehearsal. |
| Legal/privacy | Qualified Nigerian counsel/privacy professional + operator | Establish legal operator identity/contact; review current law and actual data flows/categories; publish reviewed policies and complaint/redress contact; complete privacy/DPIA/retention/processor assessment as applicable; store review evidence; do not claim compliance before sign-off. |
| Email/SMS/notifications | Provider owner | Either keep password recovery unavailable and define a verified manual support path, or implement a real sender adapter with verified From/domain, secrets, retries, delivery/bounce handling, generic anti-enumeration behavior and monitored tests. An API key alone is insufficient. |
| Finance/payments | Finance + qualified legal/compliance + chosen provider | Keep payments/payouts/refunds off until actual provider, signed webhooks/idempotency, fees, settlement, reconciliation, tax and funds-handling responsibilities are approved. Live must not custody funds absent an authorized reviewed arrangement. |
| Operations/continuity | Platform owner / SRE | Shared rate/abuse controls; centralized redacted logs, metrics/traces, alerts/on-call; encrypted off-site backups/PITR; documented RPO/RTO; independent restore drill; incident, breach, rollback and support runbooks. |
| Quality/security | Engineering + independent reviewers | Add/install approved browser runner; run supported browser/device matrix, keyboard/screen-reader/zoom/contrast and WCAG 2.2 AA review; production-provider integration and load/failure tests; dependency remediation or documented risk acceptance; independent security review/penetration test. |
| Geography/brand | Product/data owner | Review data freshness/licensing/attribution and all public listing/SEO copy; inspect the static asset gallery/brand output before replacing or publishing any asset. |

### Deployment decision rule

**Remain NO-GO** until all critical gates are evidenced, the full CI workflow (including the blocking dependency audit) is green or formally risk-accepted, staging browser/security/recovery tests pass, the initial feature scope is server-gated, and the accountable business/operator owners sign the deployment decision record. No one should switch `LIVE_DATA_MODE` to `production` or deploy this workspace on the basis of the local test results alone.

## 8. Historical records and maintained docs

This file is the canonical current architecture, feature and readiness record. Supporting procedure and interface docs remain scoped references:

- [`GO_LIVE.md`](GO_LIVE.md) — concise go-live checklist and current decision.
- [`TESTING.md`](TESTING.md) — commands, test boundaries, and verification evidence.
- [`API.md`](API.md), [`openapi.json`](openapi.json) — documented API surface; not a complete proof of all routes.
- [`DEPLOYMENT.md`](DEPLOYMENT.md), [`SECURITY.md`](SECURITY.md), [`THREAT_MODEL.md`](THREAT_MODEL.md), [`INTEGRATIONS.md`](INTEGRATIONS.md) — operational/security/integration boundaries.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`FEATURE_STATUS.md`](FEATURE_STATUS.md) now point here for current status. Older readiness docs, feature snapshots, and backlog/performance artifacts are historical records, not current acceptance.

## 9. Audit remediation 2026-10-24

A read-only repository audit was followed by a remediation pass on the branch `arena/bf3e275f-live-ecommerce`. The deployment decision is unchanged (**NO-GO**); these changes remove defects that were not dependent on provider or owner decisions.

### Fixed in source

| Finding | Change | Evidence |
|---|---|---|
| `npm run lint:ci` referenced a missing `scripts/` directory and failed with `MODULE_NOT_FOUND` | Added `scripts/check-eslint-baseline.mjs` (debt-budget gate with `--update`) | `npm run lint:ci` → `OK — 282 errors / 24 warnings` |
| `db:encrypt-secrets` referenced a missing script | Added `scripts/encrypt-existing-secrets.ts` (dry-run by default, refuses non-file DBs, never prints values) | Script parses and runs to the Prisma client construction |
| `@prisma/client` was a devDependency | Moved to `dependencies`; added `postinstall: prisma generate` | `package.json` |
| `test:e2e` had no runner installed and its spec used a selector that does not exist | Added `@playwright/test`; rewrote `tests/e2e/flow.spec.ts` against real landmarks; added a dedicated CI `e2e` job | Local run not possible (browser binaries are not fetchable in the audit sandbox) |
| Spoofable `X-Forwarded-For` left-most entry | Trusted-proxy resolver `src/lib/client-ip.ts` + `TRUSTED_PROXY_HOPS` | `tests/unit/client-ip.test.ts` (11 assertions incl. spoofing, short chain, IPv6) |
| `isAdmin` alone authorised merchant suspension, feature flags, freshness policy, analytics | `src/lib/admin-roles.ts` + `src/lib/admin-access.ts`; those routes now require the persisted `adminRole` | `tests/unit/admin-roles.test.ts` |
| `/api/metrics` unauthenticated outside production | Fails closed in every environment | `src/app/api/metrics/route.ts` |
| Merchant phone/email/WhatsApp harvested from public JSON and HTML | Removed from public responses; signed-in, audited reveal endpoints; masked UI | `src/app/api/products/[id]/contact/route.ts`, `src/app/api/merchant/[id]/contact/route.ts`, `tests/e2e/flow.spec.ts` |
| Unset `LIVE_DATA_MODE` in a production build behaved like demo | Production requests blocked with 503 unless explicitly `demo`; health degraded | `src/proxy.ts`, `src/lib/env.ts` |
| Product/storefront image URLs accepted `http:`/`data:`/`javascript:` | https-only validation | `tests/unit/image-url-validation.test.ts` |
| Concurrent duplicate registration returned 500 | Maps unique-constraint violation to `409 ACCOUNT_EXISTS` | `src/app/api/auth/register/route.ts` |
| No email/phone verification route existed | Added `POST/PUT /api/auth/verify-contact` (hashed, single-use, 24h) | `src/app/api/auth/verify-contact/route.ts` |
| Notifications filtered categories after the DB page was fetched | Paginate before filter, bounded scan, explicit `truncated` flag | `src/app/api/notifications/route.ts` |
| `JWT_SECRET` reused as the audit IP-hash salt | `IP_HASH_SECRET` with documented fallback | `src/lib/security.ts` |

### Corrected documentation

- The dependency-audit row above recorded five high-severity dev-tooling advisories. Re-running `npm audit --audit-level=high` on 2026-10-24 reported **0 vulnerabilities** (production and full). That gate is currently green.
- The ESLint debt budget is now enforced by a working script at 282 errors / 24 warnings.
- Uploads and image validation are covered by `tests/unit/media-upload.test.ts` (magic bytes, traversal-shaped names, SVG/HTML rejection, fail-closed `LIVE_UPLOAD_DIR`).

### Still blocked (owner or provider decision)

SQLite→PostgreSQL conversion and committed migrations; `PRODUCTION_DATA_MODE_ENABLED`; shared rate-limit store; enforced admin MFA with bootstrap/recovery; an owner-supplied Resend account, verified sending domain and `EMAIL_FROM` (the code path exists, the provider account does not); SMS sending; payments/payouts/refunds; object storage/CDN to replace single-directory image storage when running more than one instance; upload of seller identity documents (deliberately out of scope — do not improvise); seller-created service/rental/quote/auction listings; independent security review and browser matrix sign-off.
