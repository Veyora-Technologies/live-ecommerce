# Live API reference (verified scope)

The machine-readable contract is [`docs/openapi.json`](openapi.json). It intentionally covers only core routes with current tests; it is **not** an exhaustive contract for all 63 API route files. For an undocumented route, inspect its route handler and integration tests before relying on it. No production API hostname is configured.

## Authentication and session

- `POST /api/auth/login` accepts `{ "emailOrPhone": "…", "password": "…", "mfaCode": "…" }`. Success sets a revocable `live_token` HttpOnly cookie; the cookie value is not returned in JSON. Unknown accounts and invalid passwords receive a generic credential error. MFA is required when enabled.
- `GET /api/auth/me` returns the authenticated user or `{ "user": null }`; response is private/no-store.
- `POST /api/auth/logout` revokes the server-side session and clears the cookie. JSON requests receive `200`; native HTML form posts receive a same-origin `303` redirect.
- Session cookie: HttpOnly, SameSite=Lax, Secure in production. Server-side session rows support revocation. Cookie authentication is the only currently supported user-session mechanism.

## Health and request correlation

- `GET /api/v1/health` checks the database and core environment configuration. It returns `200` when ready and `503` when degraded. It does not expose which provider credentials are configured.
- API responses include a sanitized `x-request-id` correlation header. This is not distributed tracing or an APM integration.

## Public discovery

`GET` or `POST /api/v1/search` supports text, category, price bounds, area/location scope, stock, sorting, and pagination. GET uses query parameters; POST accepts JSON. `pageSize` is capped at 50. Price bounds are interpreted in NGN; stored product prices are represented in kobo in the database/API objects where returned.

Availability is based on merchant records, reservations, and batch restrictions. It is not proof that stock is physically present at arrival or freshly confirmed. `nearest` is straight-line distance when coordinates exist, not road distance. A barcode/QR hit is not proof of local stock or payment.

## Reservations and the planner cart

- `POST /api/reservations` requires a signed-in user and revalidates merchant status, branch, stock, active promotions, selected variant, and blocked batches server-side. `Idempotency-Key` is preferred; a matching duplicate returns the existing reservation.
- Success creates a **pending** reservation and immediately increments the stock hold. The merchant confirms later; Live does not take payment. The default pickup window is left unset rather than invented.
- A 24-hour expiry is recorded. The hold-release job must be scheduled and monitored by the operator; an expiry timestamp alone does not release inventory.
- `GET /api/reservations` returns only the signed-in consumer's records.
- `GET /api/cart` is a planning view, not an order. It excludes invalid variant prices and surfaces unreservable stock/branch states.
- `POST /api/cart/items` accepts pickup only. Delivery requests are rejected; Live does not arrange delivery.
- `POST /api/cart/submit` creates separate pending pickup reservations per item. Every item is revalidated; partial success is reported and failed items remain in the plan. No multi-merchant order, fee, payment, or delivery job is created.

## Merchant bulk CSV

- `POST /api/merchant/products/bulk` is merchant-role and branch scoped. Every row must include an explicit `currency` of `NGN`; `price` is a decimal **major-unit** amount parsed to exact kobo using the configured NGN precision. Currencyless legacy rows and non-NGN rows fail individually without conversion. An existing product in an unsupported currency is not re-priced or changed by the NGN import.
- `GET /api/merchant/products/bulk?merchantId=…&branchId=…` exports that branch only, with an explicit currency column. If any price/currency cannot be represented by the NGN import format, the request returns `409` and produces no CSV rather than relabeling the amount.

## Scheduled work

- `POST /api/jobs/process` requires `x-cron-secret`. It runs implemented saved-search/price alert and webhook handlers. Generic `BackgroundJob` event handlers are **not implemented** and are reported unsupported. This endpoint is not a scheduler.
- `POST /api/jobs/expire` requires `x-cron-secret` in production. It expires eligible holds and releases inventory transactionally when actually invoked. Configure an external scheduler and alert on failures before using reservations operationally.

## Authorization, limits, and unsupported credentials

- Protected routes use the server-side session and route-specific role/ownership checks. A UI role check is not authorization.
- The merchant Connect API-key endpoint creates/list/revokes credential records, but **no API route accepts those keys today**. Do not send them as bearer credentials expecting access.
- Current proxy rate limits are process-local: 20 auth requests/minute, 120 search/assist requests/minute, 30 image uploads/minute, 1200 media reads/minute, and 240 general API requests/minute, keyed from the apparent client IP. A trusted hosting proxy must overwrite/sanitize forwarded-IP headers. This is not a distributed or DDoS control.

## Error handling and currency

Error status/body contracts vary by route; do not assume every error is `{error}` or that every create returns `201`. Documented core statuses are in `openapi.json`. Prices and fees use integer kobo where stored; fee/payment processing is not connected. Never infer availability, distance, delivery, or provider confirmation from the presence of an API record.

## Contact release (signed-in only)

Merchant phone, WhatsApp and email are **not** part of public discovery responses. They are released on demand:

- `GET /api/products/[id]/contact` — `401` with `code: "SIGN_IN_REQUIRED"` when unauthenticated, `404` when the listing is not publicly eligible, otherwise `{ merchantId, businessName, phone, whatsapp, email }` with `Cache-Control: private, no-store`.
- `GET /api/merchant/[id]/contact` — same contract for an approved merchant profile.

Every successful release writes a `MERCHANT_CONTACT_REVEAL` security event containing the requesting user id, merchant id, and whether the caller is store staff. Respond to moderation or abuse questions using those events.

## Contact verification

- `POST /api/auth/verify-contact` — issues a single-use challenge for the signed-in account's unverified email or phone. Returns `{ channel, expiresInHours }`; outside production it also returns `devVerificationToken` because no sender adapter exists in this build.
- `PUT /api/auth/verify-contact` with `{ token }` — consumes the challenge, sets `emailVerifiedAt`/`phoneVerifiedAt`, and returns `{ emailVerified, phoneVerified }`. Tokens are stored only as SHA-256 hashes and expire after 24 hours.

## Notification pagination

`GET /api/notifications` now paginates before filtering. Unfiltered requests use normal `skip`/`take`. Category-filtered requests scan newest-first in bounded chunks (up to 5000 rows) and return `filteredCount`, `scanned` and `truncated` alongside `notifications`. `totalCount` remains the account-wide unfiltered count; when `truncated` is `true`, `filteredCount` is `null` because the scan window was exhausted before the category total was known.

## Metrics

`GET /api/metrics` requires `Authorization: Bearer $METRICS_TOKEN` in every environment. It returns `503` when the variable is unset and `401` (with `WWW-Authenticate: Bearer`) on a wrong token.

## Transactional email (verification and password reset)

Email is sent through Resend's HTTP API (`src/lib/email.ts`). It is **not** configured until both `RESEND_API_KEY` and `EMAIL_FROM` are set, and links additionally require an absolute public HTTPS origin (`LIVE_PUBLIC_BASE_URL` or `NEXT_PUBLIC_APP_URL`) that is not localhost or a sandbox preview host. When any of these is missing the API says so instead of pretending to deliver.

- `POST /api/auth/register` returns `verificationDelivered` (`true`/`false`) plus `verificationChannel` and `verificationExpiresInHours`. With email configured, a confirmation link is emailed; the plaintext token is returned **only** outside production (`devToken`). In production a failed delivery is reported honestly and the token is not returned.
- `PUT /api/auth/verify-contact` confirms a token from that link and sets `emailVerifiedAt` only. `src/app/auth/verify/page.tsx` is the page the link opens; it shows expired, invalid, already-used and signed-out states explicitly. `POST` re-sends the message for the signed-in account and returns `delivered`; an account without an email gets `409 NO_VERIFIABLE_CONTACT` because this deployment has no SMS provider and will not mark a phone number verified.
- `POST /api/auth/forgot` always answers with the same generic message so account existence is not leaked. In production it sends a 30-minute reset link when email is configured; when it is not configured it returns `503` with `code: "PASSWORD_RESET_DELIVERY_UNAVAILABLE"` and creates no unusable token. A provider failure after token creation burns the token (a delivery-failure security event is logged) so a half-sent link can never be redeemed.
- `POST /api/auth/reset` (existing) redeems the emailed token and rotates the session.

Delivery is attempted once per request with an 8-second timeout; there is no in-request retry loop. A provider outage is reported as `PROVIDER_ERROR`/`TIMEOUT`, never as success.

## Merchant image uploads

- `POST /api/uploads` — `multipart/form-data` with `merchantId` and `file`. Requires a signed-in member of that merchant who can edit inventory or customise the storefront. Accepted types are decided by **magic bytes** (JPEG, PNG, WebP, GIF), never by the filename or the browser-supplied `Content-Type`; 5 MB cap. Returns `{ url, type, bytes }` with a same-origin `url` of the form `/api/media/<32 hex>.<ext>`.
- `GET /api/media/<name>` serves those images with the correct `Content-Type`, `X-Content-Type-Options: nosniff` and a one-year immutable cache. Only the exact generated filename shape is served, so path traversal and arbitrary file reads are impossible.
- The returned path (or an `https://` URL) is accepted by product create/patch (`imageUrl`) and storefront customization (`imageUrl`, `coverImageUrl`). `data:`, `javascript:`, `http:` and protocol-relative values remain rejected.
- Storage is a **single local directory** (`LIVE_UPLOAD_DIR`, absolute path required). When it is unset the endpoint returns `503 UPLOAD_NOT_CONFIGURED` rather than silently discarding files. Multi-instance deployments must replace this with object storage — see `docs/DEPLOYMENT_READINESS.md`.
- Do not send identity documents, payment proofs or verification evidence here: there is no such endpoint, and these uploads are public URLs.
