# Live V6 — Repository Inventory and Dependency-Aware Implementation Plan

**Inspection date:** 2026-10-21  
**Repository:** `/home/user/live`  
**Architecture observed:** Next.js App Router modular monolith, Prisma Client, local SQLite development database.  
**Release status:** V6 is a phased upgrade target, not a completed release. This inventory records code structure and identified gaps; it is not a security or production-readiness certification.

## 1. Repository state and verification baseline

- The working tree contains substantial uncommitted V3–V5 work (including nationwide geography, location-aware search, branches, inventory, responsive/PWA changes, security routes, merchant tools, and documentation). Preserve these changes; do not reset or replace them.
- Prisma schema currently has 63 models. Geography, user/session, merchant/organization/branch, product/inventory, reservations, lists, notifications, services/bookings, API credentials, webhook, analytics, privacy, risk, and admin-support records share one relational database.
- Local database is SQLite at `prisma/prisma/dev.db`. Production migration strategy is documented but not implemented; current development uses `prisma db push`.
- Most recently recorded checks before this V6 pass: TypeScript passed, 53 unit tests passed and 7 were skipped, and root, nationwide search, and `/api/v1/search` smoke requests returned HTTP 200. The full production build and a current full browser QA pass have not been run for the latest changes.
- `docs/FEATURE_STATUS.md` is explicitly a V3 status document. `docs/API.md`, `docs/INTEGRATIONS.md`, and some architecture notes predate V5 and are not a complete, current V6 contract.

## 2. Existing capability inventory

| Capability | Existing implementation | V6 assessment |
|---|---|---|
| Identity and sessions | One `User` identity; bcrypt password hashes; revocable server-side sessions; secure cookie; MFA and account recovery; session management; `MerchantMembership` and `OrgMembership`; profile/security pages. | Useful shared foundation. A consumer can also own/join businesses. There is no polished, explicit active-workspace switcher or single profile/preference hub for every module. Preserve backend role checks; do not equate `User.role` with merchant authority. |
| Authorization | `getCurrentUser`, `merchantRole`, role helper functions, admin roles and tests exist. Many protected routes re-check ownership/membership. | Coverage is uneven: several legacy endpoints use owner-only or `isAdmin` checks, and inspection found public/private API paths that need hardening. Permission tests should be extended to every new workflow. |
| Geography | Country/administrative-area/alias schema, seeded Nigerian states and distinct FCT, coded merchant and branch locations, manual picker, preferences, explicit search scopes, public location pages, and a shared geography filter. | Strong V5 foundation; same identifiers are available to modules. Service and some analytics/business records are not yet branch/location-aware. Keep unsupported coverage explicit. |
| Product discovery | `/search`, `/api/v1/search`, NLP parsing, product synonyms, explicit locality/state/FCT/nationwide/multi scopes, price/stock filters, freshness/confidence, real product cards, location-aware APIs. | Product-oriented search only. Businesses, services, and a user's own activity are separate destinations; no universal grouped result contract or global command palette. Keep existing product result shape backward compatible. |
| Merchant discovery | `/api/v1/merchants`, merchant profiles, home cards, public location pages. | Public profiles exist; branch/location output is not consistently presented as the matched branch. Use real records only. |
| Inventory and reservations | Product/variant inventory, reserved quantities, batch expiry/quarantine handling, events/movements, freshness, branch assignment and transfer APIs, reservation state machine, cart planner, separate merchant reservations. | Core integrity features exist. Branch operations need continued UI/flow QA. A planner cart is not checkout. No general `Order`, `Payment`, or `Delivery` domain models/production providers are present. |
| Services and appointments | `Service` and `ServiceBooking` models, public `/services`, service create API, and booking request endpoint. | Partial. Service create validation/role coverage is inconsistent; time-slot overlap is checked outside a transaction, capacity is not enforced; booking list endpoint returns records without per-record authorization; no complete merchant confirmation/cancellation lifecycle or unified activity surface. |
| Activity and notifications | Reservation activity page; `Notification` table with read flag; in-app notices created in several flows; channel preference API and profile display. | Fragmented. Activity page is reservation-only. Notifications have no central authenticated list/read API or dedicated center; profile displays the latest 10 without read-state controls. Email/SMS/push are not configured and must not be claimed. |
| Lists and personalization | Saved items, saved searches, alert jobs, recent views, shopping lists and memberships, preferences, home sections. | Useful existing pieces, but not yet searchable in one authorized user-scoped search. Avoid additional preference stores. |
| Business workspace | Merchant overview, products, reservations, profile, bulk import/export, Connect, insights, branches, team, transfers, exceptions, batches. | Shared account/business membership exists, but tools are split across pages and navigation; services/bookings are not integrated into the merchant workspace. The current dashboard is not the complete V6 business command centre. |
| Admin and operations | `/admin`, role-aware admin APIs, verification/reports/risk/analytics/flags/freshness. | Existing operational surface; not a complete unified control centre. Admin page still has older `isAdmin` gating and lacks several V6 operations. Scope/permission hardening required before expanding it. |
| Assist and intelligence | Rule-based `/api/assist` can search products, compare listings, and show a signed-in user's own reservations; structured DB reads and no autonomous reservation. | Limited tool set and product-only search. No external LLM provider configured. Do not describe it as a general cross-platform agent; tool calls must reuse normal authorization and confirmation rules. |
| Integrations and developer access | Integration connection records, webhook subscriptions/deliveries, API credential records, OpenAPI reference, cron/job routes, health/metrics endpoints. | Important security gap: integration config is currently stored as ordinary JSON; list access and deletion paths require tighter authorization; API credential creation accepts caller-provided scopes/merchant IDs without full membership validation; job processing has a stub handler that marks generic jobs successful. No provider credentials are configured and no POS/payment/delivery sync is active. |
| Events and audit | `AuditLog`, `SecurityEvent`, `RiskEvent`, `BackgroundJob`, webhook delivery records, many direct audit writes. | Shared durable pieces exist, but events are not a normalized, idempotent event-processing contract. Generic background jobs do not yet run domain handlers. Do not build critical reliability on the stub processor. |
| Responsive/accessibility/PWA | Shared CSS, mobile/desktop layouts, keyboard-aware components, manual location, reduced-motion styles, service worker, install prompt, offline UI. | Preserve and test. A full WCAG 2.2 AA audit, cross-device end-to-end pass, and current performance measurements are not available. Cached inventory must remain clearly stale. |
| Tests | Vitest unit/security/permissions/stock/state/geography/saved-search tests; opt-in HTTP integration tests; three Playwright flows. | Useful baseline, but integration suite is skipped by default and Playwright coverage is narrow. Add targeted unit/HTTP tests for new grouped search, private activity boundaries, service booking capacity and notification ownership. |

## 3. Duplications and inconsistencies to avoid

1. Product search exists in both the server-rendered `/search` page and `/api/v1/search`. Extend their shared contracts rather than adding another competing product search implementation.
2. Business operations are split across `/merchant`, `/merchant/connect`, `/merchant/bulk`, and `/merchant/insights`. V6 should provide coherent navigation to the existing tools before rebuilding them.
3. Notifications are created from many routes but displayed only on the profile page; there is no common read/list API. Reuse the single `Notification` model.
4. Geography should continue to use `GeographicArea.code` and `getGeographicScopeFilter`; do not add a second state/locality dictionary.
5. Service appointments, product reservations, quotes, and future orders have different state machines. They may share activity presentation and notification/audit services, but must not be forced into one generic transaction status.
6. `BackgroundJob` is durable storage, but `processJobs` currently has a generic-success stub. Do not route consequential handlers through it until handlers, retries, idempotency, and observability are real.

## 4. Security and data limitations observed

- Public search can remain guest-accessible; personal results must always be queried with the authenticated user's identifier and never be included in cacheable public responses.
- Service booking records contain consumer and business context; direct reads must be authorized. Slot capacity and interval overlap must be checked transactionally before accepting a request.
- Integration credentials/configuration are not a safe place for plaintext secrets. Until an encryption/KMS-backed credential reference exists, do not accept or expose provider secrets; keep connections `DISCONNECTED` and return an honest configuration limitation.
- API keys must be scoped and tied to an authorized owner/membership; raw keys are one-time display only. Do not grant user or merchant records merely because a bearer key is syntactically valid.
- No online payment, delivery-partner, email/SMS/push, POS, mapping/road routing, or external AI credentials are configured. The platform must not imply these functions are active.
- There is no full Order/Payment/Delivery model and no atomic multi-merchant checkout. Keep existing separate reservation flows and explain their limits.

## 5. Dependency-aware implementation plan

### V6 Foundation Pass — implement now

1. **Secure the service workflow**: validate service create payloads, use merchant membership roles, enforce booking interval/capacity within a transaction, protect booking reads, and add authorized state transitions.
2. **Create one universal search contract** on top of existing product/geography logic. Group public products/businesses/services and (only when signed in) the caller's own reservations, service bookings, requests, saved items/searches/lists. Keep private activity uncached and owner-scoped; keep each public type subject to supported location filters.
3. **Integrate grouped results into the existing Search experience** without replacing its ranking/filter UI or changing the existing `/api/v1/search` result contract. Offer a single query and visible result groups/filters.
4. **Create a real in-app notification center** using the existing model: authenticated list, category/unread filters, mark-one/read-all APIs with recipient checks, and an Activity/Notifications view. Do not claim external channel delivery.
5. **Extend the Activity Centre** to show reservation, service booking, item-request/quotation, and notification records as distinct types with their own statuses and actions.
6. Add focused tests for authorization, cross-user privacy, location scoping, booking conflicts/capacity, state transitions, and notification read ownership. Update API/feature documentation and record remaining gaps.

### Follow-on phases (not represented as implemented by this pass)

- Consolidate the merchant navigation into a role-aware business workspace; integrate services/bookings and branch insights without duplicating the existing screens.
- Add a command palette and context-aware navigation once the unified search/action API is stable.
- Introduce normalized outbox/event handlers only with idempotency keys, retry/dead-letter behavior, transactional writes and tests.
- Design proper Order, Payment, Delivery, quotation and shared purchase-session data models/migrations before adding any checkout/provider integration.
- Harden integration credential storage, webhooks, API scopes and operational monitoring; then document provider adapters. Do not activate integrations without real credentials and verified tests.
- Expand Live Assist through structured, permission-aware tools after the universal search and workflow APIs exist; retain manual fallbacks and confirmation for consequential actions.
- Build the larger Control Centre after route-level admin permissions are consistent and monitoring/verification queues are trustworthy.
- Complete responsive/accessibility/performance/browser/security validation, Postgres migration strategy, backup drills, and independent security review before any production-readiness claim.

## 6. Acceptance criteria for this implementation pass

- One search query can return grouped public product/business/service results and caller-owned activity through one explicit contract.
- Unauthenticated requests never receive private activity; authenticated results are constrained to the current session user.
- Selected location uses the common validated Nigerian geography service; no unsupported distance, inventory, service coverage, or delivery claims are introduced.
- Service booking writes validate future time ranges and capacity server-side, are idempotent or conflict-safe, and cannot be read/changed by unrelated users.
- Notification reads/updates are recipient-scoped and require no external provider.
- Existing product search, reservations, account sessions, and merchant stock flows remain backward compatible.
- Tests are run and actual outcomes recorded. Unimplemented provider features remain explicitly unconfigured.
