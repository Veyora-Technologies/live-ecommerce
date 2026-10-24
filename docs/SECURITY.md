# Live security posture and deployment gates

**Verification references:** OWASP ASVS 5.0.0 and NIST SSDF are used as review references. Live has not completed an ASVS assessment, NIST SSDF assessment, penetration test, security certification, or independent audit.

## Authentication and sessions

- Passwords are stored as bcrypt hashes (cost 12). Registration requires a minimum-length password. Login returns generic credential errors for unknown/deleted accounts and compares against a process-generated dummy bcrypt hash. Suspended/locked state is revealed only after a correct password.
- Five failed password attempts trigger a 15-minute account lock. Auth endpoints are also limited by a per-process IP bucket; distributed/credential-stuffing protection is not proven.
- A successful login creates an HttpOnly, SameSite=Lax cookie with Secure enabled in production. The signed token has a `jti`; only its SHA-256 hash is stored in a revocable `Session` record. Seven-day absolute expiry; admin sessions idle-expire after four hours. Logout/password-change/session revocation invalidates server-side records.
- TOTP enrollment and verification use `otplib`; encrypted TOTP secrets use AES-256-GCM with `LIVE_SECRET_ENCRYPTION_KEY`. If a secret cannot be decrypted, MFA sign-in fails closed.
- **Administrator MFA is optional today.** An admin without MFA can still sign in and receives a warning. Before launch, enforce MFA with an approved initial bootstrap, recovery, break-glass, and key-rotation procedure.

## Authorization and privacy

- Protected route handlers perform server-side session, merchant membership/role, ownership, or admin-role checks. Client role/UI state is never treated as authorization.
- Consumer searches/addresses/contact and reservation records are private by default. Merchant projections withhold consumer identity where not necessary. This needs continuing route-by-route review and staging verification on the chosen production database.
- Merchant Connect API-key records are hashed and revocable, but no route accepts those keys as bearer authorization. Do not share them with a client expecting access.
- Database records are not application-layer encrypted by this app except secret-vault values. Production database encryption, backup encryption, key management, and retention remain provider/operator responsibilities.

## Request and browser protections

- `src/proxy.ts` adds CSP, `X-Frame-Options: DENY`, `nosniff`, referrer/permissions policies, HSTS in production, request IDs, request-size checks, same-origin checks for state-changing requests with a mismatched supplied Origin, and rate-limit headers.
- The Origin check rejects a mismatched `Origin` but does not reject a missing Origin. Only `/api/jobs/*` is exempt because production job requests require `CRON_SECRET`; webhook subscription management is cookie-authenticated and remains Origin-protected. CSRF protections must be reviewed with the actual hosting proxy and future custom domains.
- CSP currently permits inline script/style for framework compatibility. This is not a strict nonce-based CSP; assess the impact before production.
- The body-size check uses request `Content-Length` (1 MB general, 5 MB image); it is not a substitute for a proxy-level streaming limit/WAF.
- Rate limits (20 auth/min, 120 search/assist/min, 240 general API/min) live in one process-local map. It is bounded against unbounded bucket growth but is not shared across instances or a DDoS control. The host must sanitize `x-forwarded-for` before it is trusted.
- Request IDs are correlation labels, not trace spans. There is no configured APM, OpenTelemetry collector, central log shipper, or alert target.

## Input, inventory, and outbound requests

- Route-level Zod validation exists for key authentication, reservations, cart, and other APIs, but not every route has a uniform schema/error contract. Payload limits and API response standards need continued review.
- Reservation and planner flows revalidate merchant, branch, variants, batch blocks, price, and stock server-side. Product/variant stock counters use conditional compare-and-swap updates inside Prisma transactions. One isolated SQLite HTTP test confirms only one of two planner submissions can reserve a last unit; PostgreSQL/batch-quarantine race behavior is not verified.
- Active/expired/recalled/quarantined batch quantities are excluded from reservable availability. A successful pending reservation creates a temporary stock hold immediately. Hold release depends on an external expiry job being scheduled and monitored.
- Outbound webhook URLs are revalidated at delivery, disallow private/reserved destinations, pin public DNS resolution, limit payloads/timeouts, and do not follow redirects. Residual risk remains without production egress policy, partner review, and independent penetration testing.
- **Merchant images are stored, not just sniffed.** `POST /api/uploads` (`src/lib/image-upload.ts`) authorises the caller against the target merchant (inventory-edit or storefront-customise permission), enforces a 5 MB cap, and decides the type from magic bytes only — the filename and the browser-declared `Content-Type` are ignored, so an SVG or HTML payload renamed `x.png` is rejected (`415`). Files are written under random 32-hex names to one absolute directory (`LIVE_UPLOAD_DIR`); an unset or relative path fails closed with `503`, never a silent discard.
- **Serving is traversal-proof.** `GET /api/media/[name]` accepts only the exact `[a-f0-9]{32}.{jpg|png|webp|gif}` shape, so `../` and percent-encoded variants can never escape the directory. Responses carry the stored content type, `X-Content-Type-Options: nosniff` and a one-year immutable cache (names are never reused). Uploaded images are public URLs: identity documents and payment proofs must never be sent there.
- The separate `/api/v1/image` recognition boundary still checks and discards bytes; no image-recognition provider is configured, and that endpoint never claims a match.

## Secrets, audit, and supply chain

- Core environment validation fails closed for missing database/JWT settings; production JWT minimum is 32 characters. A development fallback is not used for authentication.
- Webhook/TOTP secrets use AES-256-GCM envelopes. Production secret encryption requires a strong 32+ character `LIVE_SECRET_ENCRYPTION_KEY`; key rotation/versioning is not implemented. API keys are bcrypt-hashed and shown only at creation, but they are not accepted by routes.
- Security/audit/risk events are database records. Some security logging is best-effort and can fail without blocking sign-in. No centralized tamper-evident log shipping is configured.
- Synthetic v1/v2/v3 seeds are explicitly demo-only; destructive/additive sample seeds require demo mode, `LIVE_ALLOW_DEMO_SEED=1`, file-backed SQLite, and non-production runtime. Base seed account passwords are random environment values, hashed at bcrypt cost 12; integration tests use the same per-run values. This does not make a seeded demo database production-safe.
- Current lockfile: `npm audit --omit=dev --audit-level=high` returned **0 production advisories**. Full audit reported **5 high development-tooling advisories** in the `eslint-config-next` / `@next/eslint-plugin-next` transitive `fast-glob` → `micromatch` → `braces` chain. npm's offered fix downgrades to `eslint-config-next@14.2.35`, incompatible with the Next 16 stack; no blind downgrade or force-fix was applied. The CI full-audit gate is blocking at high severity and currently fails until an upstream-compatible fix or an explicitly approved exception is recorded.
- `otplib@12` and ESLint 9 packages produce deprecation/support warnings on install. Review a compatible upgrade path and test API behavior before changing majors.
- The latest strict ESLint run reported 282 errors and 24 warnings, mostly explicit `any`; `lint:ci` compares findings against a per-file/rule baseline and passed without regression. Strict lint is not clean.

## Verification snapshot

The latest fresh-fixture HTTP integration suite passed 159/159 tests across 27 files against a local optimized build and disposable SQLite data. Coverage includes sign-in/session revocation, role and tenant boundaries, private-data projections, registration role non-escalation, unavailable password recovery, marketplace, cart, reservation, stock/idempotency, search, and related APIs. TypeScript, Prisma validation, and the optimized build passed. This is local evidence only—not provider-backed auth, browser/mobile, deployment, production database, or recovery evidence. See `docs/TESTING.md` for exact conditions.

## Not claimed / required before launch

No production database or migrations, hard-blocked admin MFA, global/shared rate limiting, production scheduler, centralized observability, external providers, independent penetration test, ASVS/NIST assessment, WCAG conformance audit, production backup/restore, load capacity, SLO, or production deployment is verified. See `docs/GO_LIVE.md`.

## Hardening applied 2026-10-24

These changes close findings from the repository audit. They do not change the NO-GO deployment decision.

- **Trusted-proxy client IPs.** `X-Forwarded-For` is no longer parsed by taking the left-most value (which a caller controls). `src/lib/client-ip.ts` counts back `TRUSTED_PROXY_HOPS` entries from the right, validates the result as an IP, and returns `null` when the chain is shorter than configured. Set `TRUSTED_PROXY_HOPS=0` when the app is directly internet-facing.
- **Separate IP-hash key.** Audit IP hashes use `IP_HASH_SECRET` when set, falling back to `JWT_SECRET`. Rotating the JWT signing key no longer invalidates stored IP hashes.
- **Stronger CSRF signal.** Mutations with no `Origin` header are now checked against `Sec-Fetch-Site`; a browser-asserted `cross-site` value is rejected. Non-browser clients (cron, server-to-server, integration tests) send neither header and are unaffected.
- **Merchant contact details are no longer public.** Phone, WhatsApp and email were previously returned by `GET /api/products/[id]` and `GET /api/v1/merchants` and embedded in server-rendered HTML (`tel:` links), which made every approved merchant trivially harvestable. They are now released only to signed-in accounts via `GET /api/products/[id]/contact` and `GET /api/merchant/[id]/contact`, and each release writes a `MERCHANT_CONTACT_REVEAL` security event.
- **Admin roles are enforced, not decorative.** `src/lib/admin-access.ts` requires the persisted `adminRole`, not just `isAdmin`, for merchant moderation and platform analytics. Feature flags and freshness policies are `SUPER`-only. An account with `isAdmin=true` and `adminRole="NONE"` can no longer suspend merchants or change platform configuration.
- **`/api/metrics` fails closed everywhere.** It returns 503 when `METRICS_TOKEN` is unset and 401 on a wrong bearer token, in every environment. It previously exposed cross-tenant counters whenever `NODE_ENV !== "production"`, which includes staging and preview deployments.
- **Explicit production data mode.** In a production build, an unset `LIVE_DATA_MODE` now blocks requests with 503 and marks health degraded, instead of silently behaving like demo mode.
- **Image URLs are https-only, or our own uploads.** Product create/patch and storefront customization reject `http:`, `data:`, `javascript:` and protocol-relative (`//host`) image values; the only non-https form accepted is the exact same-origin `/api/media/<32 hex>.<ext>` path produced by `/api/uploads` (`src/lib/media-path.ts`). Marketplace media keeps the https check via `safeListingImageUrl`.
- **Concurrent duplicate sign-up returns 409.** A unique-constraint violation during registration maps to a clean `ACCOUNT_EXISTS` response instead of an unhandled 500.
- **Contact verification is delivered, not just issued.** `POST/PUT /api/auth/verify-contact` issues and consumes a single-use, hashed, 24-hour challenge and sets `emailVerifiedAt`/`phoneVerifiedAt`. When a sender is configured the token travels only inside the emailed link (`/auth/verify?token=…`); the plaintext token is returned in JSON **only** outside production. Accounts remain unverified until the challenge is consumed; sign-in behaviour is unchanged.
- **Email delivery fails closed.** `src/lib/email.ts` calls Resend over HTTPS with an 8-second timeout, never logs message bodies, tokens or the API key, and returns an explicit `NOT_CONFIGURED | PROVIDER_ERROR | TIMEOUT` instead of a fake success. A password-reset mail that fails to send burns its token and logs `PASSWORD_RESET_DELIVERY_FAILED`, so an undelivered link can never be redeemed later. Reset links require a public HTTPS origin (localhost, `.local` and preview hosts are rejected), and unknown accounts receive the same generic response as real ones.

Residual gaps after this pass: per-process rate limiting (no shared store), optional admin MFA, **no SMS delivery** (email only), no payments, image storage is a single local directory — with more than one app instance you need object storage/CDN, and there is no virus scanning or EXIF stripping — and a SQLite-only datasource with no committed migration history.
