# Verification report — email delivery and image uploads (round 2)

**Date:** 2026-10-24  **Branch:** `arena/bf3e275f-live-ecommerce`
**Commits verified:** `0f00b86` (feature work), `a34c33d` (report), `a2013df` (hardening found during this verification)
**Base for comparison:** `0da3dac` (end of round 1). Working tree clean at the time of writing.

This report exists so that you can decide about external accounts and production configuration
**without taking my word for anything**. Every claim below is either a command I ran with its real
output, or is explicitly marked as *not verified*.

---

## 0. Bottom line

| Claim | Status |
|---|---|
| The image-upload storage and serving rules behave as described (magic bytes, random names, traversal-proof, fail-closed) | **Verified** — 23 runtime checks against the real module, plus 15 unit tests |
| Email configuration and fail-closed behaviour are correct | **Verified** — 9 runtime checks against the real module |
| An email was actually delivered to a mailbox | **Not verified** — no provider account, no public origin, so nothing was sent anywhere but the provider's own error response |
| `POST /api/uploads` works over HTTP (multipart parsing, session cookie, role check) | **Not verified** — the route handler was never executed; only the library it calls was |
| `GET /api/media/<name>` works over HTTP | **Not verified** — same reason |
| The new UI renders and submits correctly in a browser | **Not verified** — no browser run |
| The app builds | **Not verified** — `prisma generate` cannot download its binaries in this sandbox; nothing was built |
| Lint debt did not grow | **Verified** — `lint:ci` → `OK — 282 errors / 24 warnings (baseline 282 / 24)` |
| No type error exists in any file this round touched | **Verified** — `tsc --noEmit` reports none in the new/changed files (the 375 repo-wide errors are the pre-existing Prisma-stub artifact, explained in §6) |

**One real gap was found during this verification and fixed before writing this report:** uploads
shared the 240-requests/minute general API bucket, so one client could have written 240 × 5 MB to the
upload directory in a minute. Uploads now have their own 30/minute bucket (`src/proxy.ts`,
commit `a2013df`).

---

## 1. What exists now

| File | Lines added | Purpose |
|---|---|---|
| `src/lib/email.ts` | 76 (new) | Resend HTTP adapter; `NOT_CONFIGURED` / `PROVIDER_ERROR` / `TIMEOUT` results |
| `src/lib/image-upload.ts` | 101 (new) | magic-byte detection, disk storage, safe reads |
| `src/lib/media-path.ts` | 17 (new) | the one definition of a valid `/api/media/…` path |
| `src/app/api/uploads/route.ts` | 69 (new) | authenticated upload endpoint |
| `src/app/api/media/[name]/route.ts` | 31 (new) | traversal-proof image serving |
| `src/components/ImageUploadField.tsx` | 86 (new) | uploader used by product and storefront forms |
| `src/app/auth/verify/page.tsx` | 73 (new) | landing page for emailed verification links |
| `src/app/api/auth/{forgot,register,verify-contact}/route.ts` | +206 net | real delivery, honest responses, email-only verification |
| `tests/unit/media-upload.test.ts` | 80 (new) | 15 unit tests |
| `scripts/verify-round2.mts` | 110 (new) | the 32-check harness below, re-runnable |

`git diff --stat 0da3dac..HEAD` shows 27 files, 1,026 insertions, 80 deletions — all in scope; no
unrelated file was touched.

---

## 2. Commands run, with real output

### 2.1 Lint budget

```text
$ npm run lint:ci
[lint:ci] OK — 282 errors / 24 warnings (baseline 282 / 24).
```

The single violation this round initially introduced (`react-hooks/set-state-in-effect` in
`src/app/auth/verify/page.tsx`) was fixed in code, **not** baselined.

### 2.2 Unit tests

```text
$ npx vitest run tests/unit/media-upload.test.ts tests/unit/image-url-validation.test.ts
 ✓ tests/unit/media-upload.test.ts (15 tests)
 ✓ tests/unit/image-url-validation.test.ts (6 tests)
 Test Files  2 passed (2)
      Tests  21 passed (21)
```

### 2.3 Full suite

```text
$ npx vitest run
      Tests  91 passed | 18 skipped (109)
 Test Files  8 failed | 19 passed | 4 skipped (31)
```

The 8 failures are import-time crashes, not failed assertions — see §6.

### 2.4 Type check

```text
$ npx tsc --noEmit
total errors: 375
    252 error TS7006   (implicit any — Prisma query results lose their types)
     83 error TS2339   (property on a model shape the stub does not have)
     19 error TS7031   (implicit any binding)
     13 error TS2694   (missing Prisma namespace member)
      4 error TS2345   (argument of type unknown[] — stub returns unknown[])
      3 error TS7053   (any used to index a const map)
      1 error TS2305   (missing model export)
--- any error in files touched this round? ---
NONE
```

### 2.5 Runtime harness (the substantive evidence)

```text
$ npx tsx scripts/verify-round2.mts
... 32 lines ...
32/32 checks passed
```

It imports the **real** `src/lib/image-upload.ts` and `src/lib/email.ts`, writes a real 1×1 PNG to a
real temporary directory, reads it back, and then tries to abuse it.

**Uploads — 23 checks, all PASS**

| Property | Observed |
|---|---|
| A real PNG is stored | `a2e0bcf983202fdcfe6c5478a1e49003.png` |
| Filename is 32 random hex chars + true extension | matches `/^[a-f0-9]{32}\.png$/` |
| Reported type is the sniffed one | `image/png` |
| Bytes are written to disk, exactly one file | 1 file in the directory |
| Read back byte-for-byte identical | 70 bytes, `Buffer.compare === 0` |
| Served type comes from the stored name | `image/png` |
| `readImage` refuses `../<name>` | `null` |
| `readImage` refuses `../../etc/passwd` | `null` |
| `readImage` refuses an uppercased name | `null` |
| `readImage` refuses a non-existent but well-formed name | `null` |
| `readImage` refuses `<name>.png.txt` | `null` |
| `readImage` refuses `%2e%2e/<name>` | `null` |
| HTML bytes are refused even if renamed | `null`, no file created |
| SVG bytes are refused | `null` |
| Empty file refused | `null` |
| 3-byte JPEG header refused (needs ≥12) | `null` |
| Rejected uploads create no files | directory still holds 1 file |
| Relative `LIVE_UPLOAD_DIR` fails closed | `null` |
| Unset `LIVE_UPLOAD_DIR` fails closed | `null` |
| `.png` maps to `image/png`; `../x.png` is unsafe | as stated |

**Email — 9 checks, all PASS**

| Property | Observed |
|---|---|
| No variables set → not configured | `emailConfigured() === false` |
| `sendEmail` reports `NOT_CONFIGURED` (no fake success) | `{delivered:false,reason:"NOT_CONFIGURED"}` |
| An API key alone does not enable email | `false` |
| Key + `EMAIL_FROM` enables it | `true` |
| No public origin → no link base | `null` |
| `http://localhost:3000` rejected | `null` |
| Sandbox preview host rejected | `null` |
| Real `https://` origin accepted | `https://live.example.com` |
| Unreachable provider degrades honestly | `{delivered:false,reason:"PROVIDER_ERROR"}` |

That last line is the important one: the harness deliberately calls the provider with a fake key.
With network it receives a 401, without network a connection error — both must come back as a
failure, never as "sent".

---

## 3. Security properties checked by inspection (not just by test)

| Question | Answer | How checked |
|---|---|---|
| Does any new server code log a token, message body or key? | **No** — no `console`/logger call exists in any new or changed file | `grep -n "console\.\|logger\|log("` over the eight touched server files → no matches |
| Is the browser-declared MIME type ever trusted? | **No** — only `file.size` and the raw bytes are read | `grep "file\.type"` in the uploader, upload route and library → no matches |
| Can the upload route be used for someone else's shop? | **No** — `merchantRole(merchantId, user.id)` must return a role that can edit inventory or customise the storefront, else `403` | `src/app/api/uploads/route.ts:31-38` |
| Can `/api/media/…` read arbitrary files? | **No** — only `[a-f0-9]{32}.{jpg,png,webp,gif}`, then a `join()` inside the configured directory; proven at runtime above | `src/lib/image-upload.ts:39-52,91-101` |
| Do uploaded images get sniffing protection and correct typing? | **Yes** — `X-Content-Type-Options: nosniff`, stored content type, one-year immutable cache | `src/app/api/media/[name]/route.ts:22-31` |
| Did this round add any HTML injection surface? | **No** — no `dangerouslySetInnerHTML` added anywhere | `git diff 0da3dac..HEAD \| grep dangerouslySetInnerHTML` → none |
| Was any credential committed? | **No** | `git diff` scanned for `re_…`, `sk_live/test_…`, AKIA keys and PEM blocks → none |
| Can the emailed token leak through a `Referer` header? | **Not cross-origin** — `Referrer-Policy: strict-origin-when-cross-origin` is set on every response, so only the origin is sent to third parties; the page loads no third-party scripts | `src/proxy.ts:68` |
| Does the verify page stash the token anywhere persistent? | **No** — read from the URL, sent once in the `PUT` body; no `localStorage`, `sessionStorage`, cookie or `history` manipulation | `grep` over `src/app/auth/verify/page.tsx` → no matches |
| Does the emailed reset link land on a page that exists? | **Yes** — `/auth/reset?token=…` → `src/app/auth/reset/page.tsx` posts to `/api/auth/reset`, which requires `type === "PASSWORD_RESET"` and an unused, unexpired challenge | files inspected |
| Is phone verification still claimed without SMS? | **No** — `PUT /api/auth/verify-contact` sets `emailVerifiedAt` only; no-email accounts get `409 NO_VERIFIABLE_CONTACT` | `src/app/api/auth/verify-contact/route.ts` |

---

## 4. What this verification does **not** prove

Be explicit with yourself about these before promoting anything:

1. **No email has ever been sent.** Nothing in this environment can reach a mailbox. The delivery
   success path (`res.delivered === true`) has never executed against a real provider.
2. **No HTTP request was made** to `/api/uploads` or `/api/media/[name]`. The library logic is
   proven; Next.js route wiring, multipart parsing, cookie auth and the 5 MB proxy cap are not.
3. **No browser rendered the new UI.** `ImageUploadField` and the verify page were type-checked and
   linted, nothing more.
4. **No build was produced.** `prisma generate` cannot fetch binaries here, so `next build` was not
   run; deployment behaviour (standalone output, static analysis, bundle warnings) is unknown.
5. **Rate limiting was not exercised** — the new 30/min upload bucket is code-level only.
6. **No database-backed flow ran**: every test touching Prisma stops at import (§6).

---

## 5. Residual risks I did not remove

| Risk | Why it remains | Mitigation / owner action |
|---|---|---|
| Uploaded photos keep their EXIF metadata (GPS, camera, timestamps) | Stripping needs a real image library and real files to test against; doing it blind risks corrupting images | Tell merchants to strip metadata, or add `sharp` before large-scale use |
| No antivirus/content scanning on uploads | Out of scope for a local directory; magic bytes stop scripts, not malicious JPEGs | Object storage + scanning service before multi-tenant scale |
| Disk growth: files are never deleted when a product is deleted | No lifecycle job exists | Add a cleanup job or move to object storage |
| Single-instance storage | `LIVE_UPLOAD_DIR` is one directory on one machine | Object storage/CDN before scaling horizontally |
| One delivery attempt, no retry | Deliberate: a retry loop inside a request amplifies an outage | Resend dashboard shows failures; add a queue later if needed |
| Registration reveals that an email exists (`409 ACCOUNT_EXISTS`) | Pre-existing behaviour, unchanged by this round | Consider softening if enumeration matters to you |
| Provider dependency | Resend outage = no password resets | Document the support recovery path |

---

## 6. Why 8 test files and 375 type errors are **not** caused by this round

`prisma generate` cannot download its engine binaries in this sandbox, so `node_modules/.prisma/client`
is a stub that throws on construction. Every test file that imports anything reaching `src/lib/db.ts`
dies at import with:

```text
Error: @prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.
 ❯ src/lib/db.ts:5:49
```

The eight files: `tests/integration/cart-submit.test.ts`, `tests/unit/{marketplace,nlp,permissions,production-env-gate,saved-search-alerts,security,unified-search}.test.ts`.

The 375 `tsc` errors are the same root cause: without generated model types, Prisma query results
collapse to `any`/`unknown`, producing the `TS7006`/`TS7031`/`TS2339`/`TS2345`/`TS7053` families.
**Zero errors point at a file this round added or edited** (§2.4). On a machine that can run
`prisma generate`, both figures should drop sharply — that is the first thing to re-check locally.

---

## 7. Do this locally before you create any external account

Nothing below needs a paid service or a public domain.

```bash
npm ci --legacy-peer-deps
./node_modules/.bin/prisma generate          # must succeed; re-run tsc after this
./node_modules/.bin/prisma db push           # disposable SQLite file only
npm run seed                                  # demo data
npm run lint:ci && npx vitest run             # then the 8 blocked files should run too
npx tsx scripts/verify-round2.mts             # 32/32 expected
mkdir -p /tmp/live-uploads && export LIVE_UPLOAD_DIR=/tmp/live-uploads
npm run dev
```

Then, in the browser, with a merchant account:

1. Merchant dashboard → **Add product** → choose an image → expect a preview and "Uploaded."
2. Confirm the file appears in `/tmp/live-uploads` with a 32-hex name.
3. Open `http://localhost:3000/api/media/<that-name>` → the image, `Content-Type: image/png`,
   `X-Content-Type-Options: nosniff`, `Cache-Control: …immutable`.
4. Try `http://localhost:3000/api/media/../.env` → `404`, never file contents.
5. Save the product, then open its public page → the uploaded image renders.

Only **after** that works should you create the Resend account. Then:

6. Set `RESEND_API_KEY` and `EMAIL_FROM`, keep `LIVE_PUBLIC_BASE_URL` unset in development.
7. `POST /api/auth/forgot` → still `503` in production mode without a public origin: that is the
   fail-closed path working, not a bug.
8. In a production-like run with a real `https://` origin, request a reset for your own address and
   confirm: the mail arrives, the link opens `/auth/reset?token=…`, and setting a new password
   invalidates the old one. This is the single check that has never been performed anywhere.

---

## 8. Sign-off

| # | Claim | Verified? |
|---|---|---|
| 1 | Upload type is decided by content, not filename | Yes — runtime + unit |
| 2 | Traversal-shaped media names cannot read files | Yes — runtime |
| 3 | Uploads fail closed when storage is not configured | Yes — runtime |
| 4 | Email fails closed when unconfigured or unreachable | Yes — runtime |
| 5 | Link bases reject localhost and preview hosts | Yes — runtime |
| 6 | Verification marks email only | Yes — code inspection |
| 7 | Reset link target and API contract match | Yes — code inspection |
| 8 | No secrets, logs or injection surface introduced | Yes — static scan |
| 9 | Lint debt unchanged; no new type errors | Yes — commands above |
| 10 | An email actually arrives | **No — needs your provider** |
| 11 | Uploads work end-to-end over HTTP and in the browser | **No — needs a local run** |
| 12 | The app builds and deploys | **No — needs `prisma generate` to succeed** |

Items 10–12 are the reason this is a verification report and not a sign-off. Do §7 first; it costs
nothing and it will surface any wiring mistake before a single account is created.
