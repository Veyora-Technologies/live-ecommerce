# Live Connect — current integration contract

This document describes what the repository currently does, not a list of active providers. No POS, supplier, delivery, payment, mapping, email/SMS/WhatsApp, push, or external AI provider is connected or verified. A connection record is not a connection. Never treat a saved integration record as evidence that inventory, delivery, or payment has synced.

## Secret storage and migration

- New webhook signing secrets and MFA TOTP secrets are encrypted at rest using AES-256-GCM in `src/lib/secret-vault.ts`. API keys are bcrypt-hashed; raw API keys are returned once. Integration creation accepts no provider credentials and stores `config: null`.
- Production secret storage requires `LIVE_SECRET_ENCRYPTION_KEY` to be configured as a strong, random value of at least 32 characters. Keep it outside source control and back it up separately from the database. Losing or rotating this key currently makes existing encrypted values unreadable; key rotation/versioned re-encryption is not yet implemented.
- Legacy MFA, webhook, or integration configuration values must be migrated before deploying the encrypted-secret reader. First back up the database, set the production key, then run `npm run db:encrypt-secrets` for a dry run and `npm run db:encrypt-secrets -- --apply` to migrate. The script prints counts only. Any legacy integration config is encrypted and its record marked `DISCONNECTED`; no adapter is implemented to use it.
- Webhook secret is returned once at creation and omitted from reads. Do not put provider credentials in ordinary integration `config` JSON.

## POS, supplier, and delivery providers

The merchant UI can create an integration *record* for `POS`, `DELIVERY`, or `SUPPLIER`; it remains `DISCONNECTED`. The route does not accept credentials, launch a provider OAuth flow, sync inventory, create delivery requests, or verify partner callbacks. There is no live inventory reconciliation or delivery-state integration in this release.

When adapters are built, use provider-specific credential references backed by encrypted storage or a secrets manager; map source stock to explicit product/branch records; preserve branch separation; reconcile conflicts without silently overwriting merchant values; and verify signed partner callbacks before changing delivery state. Until then use the existing manual/CSV inventory workflows and clearly explain their limits.

## Outbound webhooks

- Merchant owners/managers can create/list/delete merchant subscriptions via `/api/webhooks`. A validated public HTTPS URL is required in production; localhost, private/reserved IPs, credentials in URLs, and unsafe DNS answers are rejected. Outbound requests pin the validated DNS answer, do not follow redirects, cap payload/response sizes, and time out.
- Only event types currently emitted by the code can be selected: `batch.created`, `batch.updated`, and `transfer.acknowledged`. Other event families (including product, reservation, order, payment, service booking, and delivery events) are not emitted here.
- Creation accepts `{ merchantId, url, events }`. The raw HMAC secret is returned once. Delivery headers are `X-Live-Event`, `X-Live-Delivery-Id`, and `X-Live-Signature: sha256=<hex>`; the signature is HMAC-SHA256 over the exact request body.
- `POST /api/jobs/process` requires `x-cron-secret` to match `CRON_SECRET`. It attempts up to 10 due deliveries per call, uses 8-second timeouts, and retries eligible failures up to five attempts with increasing delay. Receivers should deduplicate by `X-Live-Delivery-Id`: delivery is at-least-once, not proof that the partner performed the requested work.
- URL checks reduce SSRF/DNS-rebinding risk, but external egress allowlists and monitoring remain recommended. This is not a penetration-test result.

## Developer API credentials

- Owners/managers can create/revoke merchant credential records via `/api/api-keys`. Raw material is shown once; only a bcrypt hash, prefix, scope label, and metadata are stored.
- The credential is **not accepted by any API route in this release**, so it grants no access today. Public read endpoints remain unauthenticated. Private/customer-data and write scopes are not enabled. Do not send the key to a service expecting bearer authorization to work.
- Listing is merchant-scoped and owner/manager protected. Revocation is available in the merchant Connect UI.

## Subscriptions and payments

Paid subscription checkout, payment creation, and server-side signed verification are not implemented. The paid-plan endpoint returns `503`, does not activate a paid plan, and does not attempt a charge, even if payment environment variables are present. The page displays plan information without a fake checkout control. No wallet or multi-merchant checkout exists.

## Notifications and AI

In-app notification records and read-state controls work without an external provider. Email, SMS, WhatsApp, and push delivery are not configured or claimed. No external AI provider is configured; ordinary search and service/reservation workflows remain available without AI.

## Job endpoints

- `POST /api/jobs/process` — requires `CRON_SECRET`; runs implemented saved-search/price-alert and webhook handlers. Generic `BackgroundJob` event handlers are not implemented and are reported as unsupported instead of falsely marked successful.
- `POST /api/jobs/expire` — production requires `CRON_SECRET`; development mutations require an authenticated admin when the cron secret is absent. It expires eligible reservation holds transactionally and releases at most the recorded reserved amount. `GET` is not a mutation route.

Keep cron credentials server-side and use an external scheduler that records request outcomes. Do not infer production readiness from a successful local request.
