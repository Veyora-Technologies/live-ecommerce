# Hardening: row-level security, request guarding, async jobs, step-up authentication

Five capabilities were requested together: row-level security, request catching
(interception, validation, error catching and caching), asynchronous jobs,
re-authentication, and never exposing environment files. This document records
what exists, why it is built the way it is, and precisely what remains
unverified.

Everything below is enforced by code in this repository and covered by tests
except where explicitly marked **not verified**.

---

## 1. Row-level security

### The problem

28 Prisma models carry a `merchantId`. In almost every route that id arrived
**from the client**. Nothing in Prisma or SQLite stopped a handler from reading
`merchantId=<somebody else's>` and returning it. Each route had to remember to
call `merchantRole(...)`; one omission is a cross-tenant data leak that looks
like an ordinary query in review.

### What was built

| File | Role |
| --- | --- |
| `src/lib/tenant.ts` | The gate: `requireMerchantAccess`, `requireRecordAccess`, `visibleMerchantWhere` |
| `src/lib/tenant-policy.ts` | The classification data: which models are tenant-owned vs shared with the customer |
| `prisma/rls/policies.sql` | The PostgreSQL policy set that mirrors it |
| `tests/unit/tenant-policy.test.ts` | Re-derives every model with a `merchantId` from the schema and fails if one is unclassified |

`requireMerchantAccess` **throws** rather than returning a boolean, so a caller
cannot ignore a falsy result and continue with an unscoped query. Authorisation
is split into two orthogonal questions, both required:

1. May this caller touch this tenant at all? → `requireMerchantAccess`
2. May their role perform this action? → `src/lib/permissions.ts`

A missing tenant is answered `404`, not `403`, so a caller cannot learn which
merchant ids exist.

### Two classifications, not one

"Has a `merchantId`" does not mean "only merchant staff may read it". A
reservation, review or enquiry was created by a **customer**; a policy that
returned only the merchant's view would hide a customer's own data from them.
So the models are split:

- **19 merchant-owned** — `Product`, `Branch`, `ProductBatch`, `ApiCredential`, …
- **9 shared with the customer** — `Reservation`, `Review`, `Enquiry`,
  `ServiceBooking`, `SavedItem`, `Report`, `CartItem`, `ItemRequestResponse`,
  `LegalPolicyAcceptance`

Where the customer is only reachable through a parent row (a cart line belongs
to a `Cart`), the policy joins through that parent rather than inventing a
column. That distinction was found the hard way: an early draft named
`Review.reviewerId` and `Enquiry.consumerId`, **neither of which exists**. The
test now re-derives every column from the schema so it cannot drift again.

### Why the SQL is not applied

`prisma/schema.prisma` uses `provider = "sqlite"`, which has **no row-level
security**. `prisma/rls/policies.sql` is therefore written, reviewed and
committed but deliberately **not executed**. Until the planned PostgreSQL
migration, the application layer is the only enforcement point.

The SQL uses `SECURITY DEFINER` with a pinned `search_path` (without which a
caller-controlled `search_path` could redirect the membership lookup), `FORCE
ROW LEVEL SECURITY` (without which the owner role silently reads every tenant),
and **no** `app.is_admin` bypass flag — a flag a request can set is one injection
away from disabling every policy, so staff access is a separate database role.

Verified: the classification test passes; the SQL contains no syntax check in
this environment because the engine cannot be downloaded here (see §6).

---

## 2. Request catching

Four separate mechanisms, because "catch requests" means four different things.

### 2a. Interception — `src/proxy.ts`

- **Sensitive-path blocking.** `/.env`, `/.git/config`, `/.aws/credentials`,
  `/id_rsa`, `/wp-login.php`, `/backup.sql`, `*.pem`, `*.sql` and friends are
  answered `404` before routing. `404` rather than `403` so a scanner learns
  nothing. `.well-known` is deliberately not matched.
- **Content-type validation.** Mutating `/api/*` requests declaring a body type
  the API never parses (`text/plain`, `application/xml`, …) get `415`.
  Requests with no `Content-Type` (curl, cron, server-to-server) are unaffected.
- Existing protections retained: per-category rate limiting, CSRF origin checks,
  payload-size caps, security headers, correlation ids.

**A bug worth recording:** the first version of the path regex put a single `/`
before the alternatives group, so it bound to the *first* alternative only.
`/.env` was blocked while `/.git/config`, `/id_rsa` and every `*.sql` sailed
through — 9 of 12 probes. It was found by testing the regex against sample paths
rather than trusting it, and is now locked down by
`tests/unit/request-hardening.test.ts`.

### 2b. Error catching — `src/lib/api-handler.ts` + `src/lib/api-errors.ts`

The server-side counterpart to `src/app/error.tsx`. `withApiHandler` guarantees
an unhandled throw becomes JSON with a correlation id, not Next's HTML error
page (which `fetch()` cannot parse).

The rule: **an exception is not a response.** Only a deliberate `ApiError` may
carry a message to the client. Everything else becomes
`{ error: "Something went wrong on our side…", code: "INTERNAL_ERROR", requestId }`.
Stack traces, SQL fragments and connection strings never leave the process.

Logs are scrubbed by `scrubSecrets`, which redacts JWTs, `sk_/pk_/rk_` keys,
`re_` keys, GitHub tokens, `AKIA` keys, `scheme://user:pass@` connection
strings, `key=value` credential pairs, and long hex blobs.

**A bug worth recording:** the `re_` pattern used `[A-Za-z0-9]{10,}`, which
stopped at the first underscore — so `re_live_9f8e…` was **not** redacted. The
test caught it; the class now allows `_` and `-`.

### 2c. Caching — `src/lib/http-cache.ts`

The rule is inverted from the usual one: **nothing is cacheable unless a caller
names a policy**, and `publicCache()` refuses to co-operate when the request
carried a session cookie. The default stays `no-store`.

Applied to the two genuinely anonymous reference endpoints
(`/api/marketplace/categories`, `/api/geography`), which previously hard-coded
`Cache-Control: public` unconditionally — including for signed-in requests.

Product prices, stock and availability are **deliberately not cached**. This
app's proposition is that posted availability is current; a stale price is a
correctness bug, not a performance win.

**A bug worth recording:** `publicCache` originally checked
`if (req && isPersonalisedRequest(req))`, which made a *missing* request mean
"public" — the exact inversion the module exists to prevent. It now fails closed.

### 2d. Correlation

Every request gets an `x-request-id` (validated against `/^[A-Za-z0-9._-]{1,64}$/`
so it cannot forge a log line), echoed on every response, including errors and
the 404 for blocked paths. Support can match a screenshot to a log line.

---

## 3. Asynchronous jobs

`BackgroundJob` already existed but was only ever written to *after* work
finished — a log row, never a queue. It is now an actual queue.

| File | Role |
| --- | --- |
| `src/lib/jobs-core.ts` | Pure arithmetic: backoff schedule, payload parsing |
| `src/lib/jobs.ts` | Claim, complete, fail, requeue, drain |
| `src/app/api/jobs/worker/route.ts` | Authenticated drain endpoint + handler registry |

### Properties

- **At-most-once claiming across instances.** A job is claimed with a
  conditional `updateMany` guarded on `status: "PENDING"`. Two workers race on
  that UPDATE; exactly one gets `count: 1`. No advisory locks, no
  `SELECT … FOR UPDATE`, works on SQLite and PostgreSQL alike.
- **Bounded retries.** 30s → 2m → 10m → 1h, then `DEAD_LETTER` at
  `maxAttempts` (default 5).
- **Nothing silently lost.** The claim query is filtered to the registered
  handler types, so an unknown job type is never consumed. Jobs orphaned by a
  worker that died mid-run are returned to the queue by `requeueStuckJobs`.
- **No secrets in errors.** `lastError` is passed through `scrubSecrets`.
- **Handler registry, not discovery.** A queue that executes arbitrary `type`
  values is an RCE-shaped hole. Adding a job type means adding it to the map.

Registered: `SESSION_CLEANUP` (deletes session and challenge rows past 30 days)
and `PING` (pipeline verification).

Authentication mirrors `/api/jobs/expire`: cron secret, or admin session in
development; an unset secret in production is a `503`, never an open door.

**Schema change:** `BackgroundJob` gained `maxAttempts`, `lastError`, and a
`[status, nextRunAt]` index. All additive; applied by `prisma db push` in CI.

---

## 4. Re-authentication (step-up)

### The problem

A session cookie lives for 7 days. That cookie alone was enough to change the
password, enable MFA, revoke the real owner's other sessions, or mint an API
key. The user's *presence* was never re-checked.

### The rule

Actions that can lock the owner out or grant durable access require the password
to have been proved recently — within `REAUTH_WINDOW_MS` (15 minutes) — **on
this session**. Signing in counts as proof, so the normal flow never prompts;
only a stale session does.

Freshness is stored per **session**, not per user: proving a password on a phone
must not authorise a change from a laptop that has been idle for two days.

### Enforcement

| Route | Why |
| --- | --- |
| `DELETE /api/auth/sessions` | Revoking every session is how an attacker locks the owner out |
| `POST /api/auth/mfa` (`confirm`) | This branch only needed a TOTP code, so cookie + authenticator was enough to enable MFA |
| `POST /api/api-keys` | A credential outlives the session that created it |
| `DELETE /api/api-keys` | Cuts the owner's integrations off |

`POST /api/auth/reauthenticate` proves the password and stamps
`Session.reauthenticatedAt`. It does **not** rotate the session — the caller is
already authenticated; the missing ingredient is proof of presence.

The client half (`src/lib/step-up-client.ts`) intercepts `403` with
`X-Reauth-Required: 1`, asks once, and retries exactly once — no prompt loop.
`window.prompt` is used deliberately: it cannot be styled into something that
*looks* like the app asking for a password, which is the shape of a phishing
overlay. Replacing it with a first-party dialog is a reasonable next step.

Failures are recorded as `REAUTH_FAILED` security events; repeated failures on a
stolen cookie are the signal worth alerting on.

**Schema change:** `Session.reauthenticatedAt` (nullable, additive).

---

## 5. Environment files are never exposed

Four ways an env file escapes, one guard each:

| Vector | Guard |
| --- | --- |
| Committed to git | `.gitignore` covers `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`; only `!.env.example` is re-included |
| Served as a static asset | `public/` contains no env or key file (asserted) |
| Read and returned by a route | No server file `readFileSync`s a `.env` path (asserted) |
| Bundled into client JS | `src/lib/env.ts` throws when `typeof window !== "undefined"` |

The bundling guard is the important one. Next.js already replaces
non-`NEXT_PUBLIC_` variables with `undefined` in client bundles, and Next 16
makes a bare `process.env` reference fail the build — but those are bundler
behaviours that can change. The cost of being wrong once is a credential
permanently cached in browsers, CDNs and proxy logs, so the module fails closed
regardless.

`next.config.ts` has no `env: { … }` block, which would inline values into
client JS forever (asserted).

Route-level protection is covered in §2a (the proxy blocks `/.env*` before
routing) and the error boundary guarantees an env value inside a thrown error's
message is never serialised (asserted with real-looking secrets).

---

## 6. What is verified, and what is not

**Verified in this environment (tests actually run):**

- 65 new unit tests across 6 files, all passing; full suite 164 passed, 18 skipped
- Lint at the recorded baseline: 275 errors / 14 warnings — the new code added none
- Production build compiles: `✓ Compiled successfully`, 0 errors outside the known
  Prisma-stub set
- Path-guard regex validated against 14 blocked and 13 allowed sample paths
- Cache, step-up freshness, backoff and payload parsing exercised directly

**Not verified here (and why):**

- **Prisma-dependent paths** — the engine cannot be downloaded
  (`binaries.prisma.sh` is outside the sandbox allowlist), so `prisma generate`
  fails and `@prisma/client` is a stub. Everything that touches the database
  (claim/complete/fail against real rows, `requireMerchantAccess`) is exercised
  by CI, which has the real client.
- **The PostgreSQL policy SQL has never been executed.** No PostgreSQL instance
  is reachable, and the datasource is SQLite. It must be applied and verified
  against a real database before it is relied on. `prisma/rls/policies.sql`
  ends with the verification queries to run.
- **No load or concurrency testing.** The claim race is reasoned about from
  SQL atomicity, not measured under real parallel workers.

**Interim posture:** the application-layer guard in `src/lib/tenant.ts` is the
only tenant enforcement today. That is why it throws instead of returning a
flag, and why `tenant-policy.test.ts` refuses an unclassified model.
