# Remediation, round 2 — what changed and what still cannot be done here

This is the plain-language companion to commits `3f2ac55`, `0da3dac` and `0f00b86` on branch
`arena/bf3e275f-live-ecommerce`. Everything below cites the file it lives in, because a claim
without a path is a guess.

---

## 1. Email now actually gets sent (or says it cannot)

**Why this matters.** Password reset used to be theatre: the endpoint returned a friendly message
but produced nothing a user could act on. A person who forgot their password was locked out with a
false reassurance.

**What changed**

| File | Change |
|---|---|
| `src/lib/email.ts` *(new)* | One small sender built on `fetch` + Resend's HTTP API. Returns `{delivered:true}` or an explicit `NOT_CONFIGURED` / `PROVIDER_ERROR` / `TIMEOUT`. 8-second timeout, no retry loop, and it never writes message bodies, tokens or the API key to logs. |
| `src/app/api/auth/forgot/route.ts` | Production sends a 30-minute single-use reset link when a sender **and** a public HTTPS origin exist. Without them it returns `503 PASSWORD_RESET_DELIVERY_UNAVAILABLE` and creates no token at all. If the provider fails *after* a token was created, the token is burned and `PASSWORD_RESET_DELIVERY_FAILED` is logged. Unknown accounts get exactly the same reply as real ones. |
| `src/app/api/auth/register/route.ts` | The verification link is emailed. The response reports `verificationDelivered: true/false`; in production the raw token is never returned. The in-app notification is written *after* delivery and states the real outcome. |
| `src/app/api/auth/verify-contact/route.ts` | `POST` re-sends the email and reports `delivered`; `PUT` redeems the token. |
| `src/app/auth/verify/page.tsx` *(new)* | The page the emailed link opens. Distinguishes success, expired/invalid, already-used and "sign in first". |
| `src/lib/env.ts` | `integrations.email` is only true when **both** `RESEND_API_KEY` and `EMAIL_FROM` exist — an API key alone proves nothing. |

**Honesty fix inside the fix.** Verification is now **email-only**. The deployment has no SMS
provider, so `PUT /api/auth/verify-contact` sets `emailVerifiedAt` and nothing else; an account with
no email gets `409 NO_VERIFIABLE_CONTACT` instead of a `phoneVerifiedAt` timestamp that no message
ever justified.

**To turn it on** (all three, or it stays off):
`RESEND_API_KEY`, `EMAIL_FROM` (an address on a domain verified with Resend), and
`LIVE_PUBLIC_BASE_URL` (an absolute `https://` origin; localhost and preview hosts are rejected).
See `.env.example`.

---

## 2. Merchants can upload product and storefront images

**Why this matters.** Until now the product form had a bare "Image URL" text box: merchants had to
host a photo somewhere else and paste a link. That is friction, and every pasted URL is a small
trust problem.

**What changed**

| File | Change |
|---|---|
| `src/lib/image-upload.ts` *(new)* | Decides the file type from its **magic bytes** (JPEG/PNG/WebP/GIF), not the filename or the browser-declared `Content-Type` — so an SVG or an HTML file renamed `photo.png` is rejected. 5 MB cap. Random 32-hex filenames, written `0644`. |
| `src/app/api/uploads/route.ts` *(new)* | `POST multipart/form-data` with `merchantId` + `file`. Requires a signed-in member of that merchant who can edit inventory or customise the storefront. `503 UPLOAD_NOT_CONFIGURED` when `LIVE_UPLOAD_DIR` is missing or not absolute. |
| `src/app/api/media/[name]/route.ts` *(new)* | Serves a stored image. Accepts **only** the exact generated name shape, so `../` and percent-encoded traversal are impossible. Sends the stored content type, `X-Content-Type-Options: nosniff`, and a one-year immutable cache. |
| `src/lib/media-path.ts` *(new)* | Dependency-free rule shared by server and browser: what a valid `/api/media/…` path looks like, plus the 5 MB constant. |
| `src/components/ImageUploadField.tsx` *(new)* | Upload button, preview and error text. Submits the returned URL through a hidden form field, so the existing product/storefront APIs did not need rewriting. |
| `src/lib/validate.ts`, `src/app/api/merchant/customize/route.ts` | Product and storefront image values now accept **an `https://` URL or our own `/api/media/…` path**. `data:`, `blob:`, `javascript:`, `http:` and `//host` remain rejected. |
| `src/lib/marketplace.ts` | `safeListingImageUrl` renders uploaded media paths; everything else still has to pass the SSRF-safe https check. |
| `src/app/merchant/MerchantClient.tsx`, `src/app/merchant/connect/ConnectClient.tsx` | Product form uses the uploader; the storefront form gained **logo** and **cover photo**. Saving the storefront only sends an image when one was just uploaded, so it cannot silently wipe an existing image. |
| `src/proxy.ts` | `/api/uploads` is allowed the 5 MB body cap, and `/api/media/` gets its own generous rate-limit bucket (a single listing page legitimately loads many thumbnails). |
| `tests/unit/media-upload.test.ts` *(new, 15 tests)* | Magic bytes, SVG/HTML/EXE rejection, traversal-shaped names, `LIVE_UPLOAD_DIR` fail-closed, and media paths accepted/rejected by the product schema. |

**Scope limit, stated plainly.** Storage is **one local directory on one machine**. With two or more
app instances, or a CDN, this must be replaced with object storage. The `503` when unconfigured is
deliberate: the endpoint must not accept a file and then throw it away.

**Do not** send identity documents, payment proofs or verification evidence to `/api/uploads` — it
returns public URLs. There is no endpoint for those, by design.

---

## 3. What was actually verified, and what was not

Run in this sandbox on 2026-10-24:

| Command | Result |
|---|---|
| `npm run lint:ci` | `OK — 282 errors / 24 warnings (baseline 282 / 24)`. No new lint debt; the one new violation the uploader introduced was fixed, not baselined. |
| `npx vitest run tests/unit/media-upload.test.ts` | 15 passed. |
| `npx vitest run` (5 pure specs) | 38 passed. |
| `npx vitest run` (full) | 91 passed, 18 skipped, 8 files blocked at import. |
| `npx tsc --noEmit` | 375 errors, **every one** of the known stub classes (`TS7006` implicit `any`, `TS2694` missing Prisma namespace members, `TS2305` missing model export, `TS2339` on model shapes). **No error is reported in any file added or edited in this round.** |

**Not verified, and not claimed:** no email was ever delivered (no provider key, no public origin);
no upload was served over HTTP; the app was never built or run end-to-end. `prisma generate` cannot
download its binaries here, so every database-backed test file stops at `@prisma/client did not
initialize yet`.

---

## 4. What is still genuinely outside this sandbox

| Item | Why it is not done | What the owner must decide |
|---|---|---|
| PostgreSQL conversion + committed migrations | No PostgreSQL server, `psql` or `initdb` exists in this sandbox. A migration could be *written* but never executed, and an untested data migration is worse than none. | Choose a managed Postgres, run a real migration rehearsal, then flip `PRODUCTION_DATA_MODE_ENABLED` in `src/lib/env.ts`. |
| Email that actually arrives | Code path, fail-closed behaviour and config are in place. A Resend account and a verified sending domain are commercial/identity steps. | Create the Resend account, verify the domain, set `RESEND_API_KEY`, `EMAIL_FROM`, `LIVE_PUBLIC_BASE_URL`. |
| SMS / phone verification | Would need a provider (Twilio etc.). Rather than fake it, phone verification was removed from the code path. | Decide whether phone verification is required at all. |
| Payments, orders, refunds, payouts | No payment provider exists anywhere in the repo; inventing one would be the single most harmful thing this pass could do. | Choose a provider (e.g. Paystack) and a legal/refund policy, then build deliberately. |
| Delivery fulfilment | Furnivo intentionally stops at pickup reservations. | Decide whether delivery is in scope at all. |
| Image storage at scale, EXIF stripping, antivirus | Single-directory storage is enough for one instance. EXIF removal and scanning need real libraries and real files to test against. | Choose object storage (S3/R2) and a scanning policy before multi-instance deployment. |
| Dependabot alert #1 | `gh api …/dependabot/alerts` returns `403` for this token, so its contents are unknown. Guessing would be fabrication. | Open the alert link GitHub printed on push and apply the fix it names. |
| 282 remaining lint errors | Mostly `any` in older UI code. Paying that down is mechanical but large, and re-recording the baseline without reviewer sign-off would hide regressions. | Schedule a cleanup pass; `npm run lint:baseline` re-records only after the debt is actually paid. |
| API keys accepted by no route | Now stated honestly in the merchant UI ("grants no access today"). Implementing key authentication is a design decision (scopes, rotation, revocation semantics), not a typo fix. | Decide whether third-party API access is a product requirement. |
| `security.txt` contact placeholder | A contact address must be real. Inventing one would misroute security reports. | Supply the security contact. |

---

## 5. If you only do one thing next

Create the Resend account and a verified sending domain, then set the three email variables. That is
the difference between "password recovery is implemented" and "password recovery works" — and it is
the only remaining blocker for the two user-facing flows finished in this round.
