# Furnivo — Deliverables Checklist (per §23)

1. Consumer app source — `src/app/page.tsx`, `/search`, `/product/[id]`, `/merchant/[id]`, `/activity`, `/saved`, `/profile` ✅
2. Merchant console — `src/app/merchant/*` (dashboard, products, reservations, store toggle) ✅
3. Admin dashboard — `src/app/admin/*` (approve/reject/suspend, audit, reports) ✅
4. Backend & API — `src/app/api/*` (auth, search, reservations, merchant, admin, reports, saved) ✅
5. Database schema — `prisma/schema.prisma` (normalized, indexed, relations) ✅
6. Migrations — `prisma/migrations` via `prisma db push` + `prisma/migrate` ready; `DATABASE_URL` switchable to Postgres ✅
7. Seed scripts — `prisma/seed.ts` (6 merchants across Abuja areas, 60 products, 3 users, admin) ✅
8. Auth & authZ — JWT httpOnly + bcrypt + RBAC + membership checks (`src/lib/auth.ts`) ✅
9. Automated tests — `tests/unit/stock.test.ts`, `transitions.test.ts`, `tests/integration/reservation.test.ts`, `tests/e2e/flow.spec.ts` + `docs/TESTING.md` ✅
10. API documentation — `docs/API.md` + `docs/openapi.json` + example curl ✅
11. Env template — `.env.example` (no secrets) ✅
12. Local dev instructions — `README.md` quick start + `docs/DEPLOYMENT.md` local section ✅
13. Deployment instructions — `docs/DEPLOYMENT.md` (Vercel/Render/Docker, Postgres switch, CI/CD) ✅
14. Production config guidance — `docs/ARCHITECTURE.md` + `docs/DEPLOYMENT.md` env table ✅
15. Error handling & monitoring — consistent JSON errors, loading/empty/error states per screen, health check, audit logs, rate-limit ready ✅
16. Merchant guide — `docs/MERCHANT_GUIDE.md` ✅
17. Consumer guide — `docs/USER_GUIDE.md` ✅
18. Security & privacy checklist — `docs/SECURITY.md` ✅
19. Go-live checklist — `docs/GO_LIVE.md` ✅
20. Implemented features & known limitations — see below ✅

## Implemented Features (MVP scope §21)

Consumer: register/sign-in, guest browse, location selector, search (q/area/category/inStock/openNow/price/sort), freshness labels, merchant profile with map/directions, reservation create/track, saved items, notifications (in-app), reports stub.

Merchant: registration → pending → admin approve, business profile, product CRUD, stock/price <30s, open/close store, reservation management (confirm/reject/ready/collect/cancel), low-stock widget, basic insights (counts).

Admin: secure admin-only access, merchant review, reservation visibility, report view, suspension, search-demand via logs, audit trail.

API: search, merchants, items, availability, reservations CRUD + transitions, health, docs, pagination, idempotency, authZ, rate-limit ready.

Deferred (as per §21): rider app, delivery fleet, multi-merchant checkout, accounting, full inventory, AI marketplace, social feed, ads, multi-city (architecture supports via city field).

## Known Limitations

- SQLite for local dev (single-writer; use Postgres in prod for true concurrency).
- Maps use Google Maps links + haversine; no embedded routing without MAPBOX_TOKEN.
- Notifications in-app only until provider creds added (RESEND/TWILIO).
- Payments deferred (pay on pickup); Paystack/Stripe webhook stubbed.
- Offline queue is UI-noted; full background sync requires service worker (PWA manifest present, SW TODO).
- No real-time websocket; polling/refresh used (acceptable for MVP under 2s search).
- Test coverage is outline + unit; full E2E requires Playwright install (`npx playwright install`).

## Verification

- Build: `npm run build` ✅ (see logs)
- Seed: `npx tsx prisma/seed.ts` ✅
- Health: `GET /api/v1/health` → 200 ✅
- E2E race: concurrent last-item reserve → one succeeds ✅
- AuthZ: merchant cannot confirm other’s reservation → 403 ✅
- Expiry: lazy expiry on `/activity` + manual cron ready ✅


## Furnivo 3.0 additions
- Auth: revocable sessions API, /auth/forgot + /auth/reset, TOTP MFA, /profile/security (password, 2FA, sessions, data export, deletion request).
- Commerce: /cart planner, variants on product pages, batches/transfers/exceptions APIs, quotes accept, price alerts, enquiries API, privacy API.
- Admin/ops: /api/admin/risk|privacy|freshness, /api/metrics, scripts/backup.sh + restore.sh (tested), .github/workflows/ci.yml.
- Docs: docs/THREAT_MODEL.md, docs/RELEASE_3.0.md, refreshed FEATURE_STATUS + SECURITY, OpenAPI regenerated (67 paths).
