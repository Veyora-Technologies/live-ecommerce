-- ============================================================================
-- Row-level security policy set (PostgreSQL)
-- ============================================================================
--
-- STATUS: NOT APPLIED. The Prisma datasource in this repository is SQLite
-- (`provider = "sqlite"`), which has no row-level security. This file is the
-- policy set that must be applied when the planned PostgreSQL migration lands.
-- Nothing here runs today, and nothing here changes the current database.
--
-- Until it is applied, tenant isolation is enforced in the application by
-- `src/lib/tenant.ts` (`requireMerchantAccess` / `requireRecordAccess`). Keeping
-- both layers is deliberate: SQL is the backstop for a query path that forgets
-- the application guard, and the application guard is the backstop for a
-- connection that runs as a role with BYPASSRLS.
--
-- HOW THE APP IDENTIFIES THE CALLER
--   Every request/transaction must set the caller once, locally, before any
--   tenant query:
--
--       SELECT set_config('app.user_id', $userId, true);   -- true = transaction-local
--
--   `current_setting(..., true)` returns NULL when unset. That is treated as
--   "no identity" and every policy denies, which is the behaviour we want: a
--   connection that forgot to set the identity returns no rows rather than all
--   rows.
--
-- ROLES
--   The application connects as a dedicated role WITHOUT BYPASSRLS (for
--   example `furnivo_app`). Migrations and platform administration use a
--   separate role. There is intentionally no `app.is_admin` bypass flag: a flag
--   that a request can set is one injection away from disabling every policy,
--   so staff access is a different database role instead.
--
--   CREATE ROLE furnivo_app LOGIN PASSWORD '...' NOBYPASSRLS;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO furnivo_app;
--
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_is_authenticated() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_user_id() IS NOT NULL $$;

-- Membership test.
--
-- SECURITY DEFINER so that evaluating a policy on `Product` does not itself
-- re-enter the policies on `Merchant` and `MerchantMembership` (which would
-- recurse or return nothing). The `SET search_path` clause is required:
-- without it a caller-controlled search_path could redirect the lookups to
-- attacker-defined objects.
CREATE OR REPLACE FUNCTION app_can_access_merchant(mid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT
      app_is_authenticated()
      AND mid IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM "Merchant" m
           WHERE m.id = mid AND m."ownerId" = app_user_id()
        )
        OR EXISTS (
          SELECT 1 FROM "MerchantMembership" mm
           WHERE mm."merchantId" = mid
             AND mm."userId" = app_user_id()
             AND mm.status = 'ACTIVE'
        )
      )
  $$;

REVOKE ALL ON FUNCTION app_can_access_merchant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_access_merchant(text) TO furnivo_app;

-- ---------------------------------------------------------------------------
-- Merchant-owned tables: only the tenant's own staff may see a row.
-- Generated from MERCHANT_OWNED_MODELS in src/lib/tenant.ts.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tenant_owned text[] := ARRAY[
    'Product', 'Branch', 'ProductBatch', 'BranchTransfer', 'InventoryMovement',
    'PriceObservation', 'AvailabilityEvent', 'OperatingException', 'Promotion',
    'Service', 'MerchantSubscription', 'MerchantMembership',
    'WebhookSubscription', 'IntegrationConnection', 'ApiCredential',
    'MarketplaceListing', 'ComplianceCase', 'VerificationCase', 'ApprovalRequest'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_owned LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so that even the table owner is subject to the policy; without it
    -- the owner role silently reads every tenant's rows.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL
        USING (app_can_access_merchant("merchantId"))
        WITH CHECK (app_can_access_merchant("merchantId"))
    $f$, t);
  END LOOP;
END $$;

-- A membership row is readable by the member it describes, so a user can see
-- their own access without first belonging to the merchant.
DROP POLICY IF EXISTS membership_self_read ON "MerchantMembership";
CREATE POLICY membership_self_read ON "MerchantMembership"
  FOR SELECT
  USING ("userId" = app_user_id() OR app_can_access_merchant("merchantId"));

-- The merchant record itself.
ALTER TABLE "Merchant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Merchant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_tenant ON "Merchant";
CREATE POLICY merchant_tenant ON "Merchant"
  FOR ALL
  USING (app_can_access_merchant(id))
  WITH CHECK (app_can_access_merchant(id));

-- ---------------------------------------------------------------------------
-- Shared tables: the customer who created the row may also see it.
-- Generated from SHARED_WITH_CUSTOMER_MODELS in src/lib/tenant.ts.
--
-- Note the difference between USING and WITH CHECK. USING decides what an
-- existing row may be read/updated/deleted through; WITH CHECK decides what a
-- new row may contain. A policy that omits WITH CHECK lets a customer insert a
-- row stamped with someone else's merchantId.
-- ---------------------------------------------------------------------------

-- Reservation
ALTER TABLE "Reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reservation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reservation_tenant ON "Reservation";
CREATE POLICY reservation_tenant ON "Reservation"
  FOR ALL
  USING (app_can_access_merchant("merchantId") OR "consumerId" = app_user_id())
  WITH CHECK (app_can_access_merchant("merchantId") OR "consumerId" = app_user_id());

-- Review (author may read/edit their own review)
ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_tenant ON "Review";
CREATE POLICY review_tenant ON "Review"
  FOR ALL
  USING (app_can_access_merchant("merchantId") OR "authorId" = app_user_id())
  WITH CHECK (app_can_access_merchant("merchantId") OR "authorId" = app_user_id());

-- Enquiry (requester may read their own)
ALTER TABLE "Enquiry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Enquiry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enquiry_tenant ON "Enquiry";
CREATE POLICY enquiry_tenant ON "Enquiry"
  FOR ALL
  USING (app_can_access_merchant("merchantId") OR "requesterId" = app_user_id())
  WITH CHECK (app_can_access_merchant("merchantId") OR "requesterId" = app_user_id());

-- ServiceBooking
ALTER TABLE "ServiceBooking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceBooking" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_booking_tenant ON "ServiceBooking";
CREATE POLICY service_booking_tenant ON "ServiceBooking"
  FOR ALL
  USING (app_can_access_merchant("merchantId") OR "consumerId" = app_user_id())
  WITH CHECK (app_can_access_merchant("merchantId") OR "consumerId" = app_user_id());

-- SavedItem (merchantId is nullable: a saved item may be marketplace-wide)
ALTER TABLE "SavedItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SavedItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_item_tenant ON "SavedItem";
CREATE POLICY saved_item_tenant ON "SavedItem"
  FOR ALL
  USING ("userId" = app_user_id() OR app_can_access_merchant("merchantId"))
  WITH CHECK ("userId" = app_user_id());

-- Report (reporter may read their own; the reported merchant may read it)
ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Report" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_tenant ON "Report";
CREATE POLICY report_tenant ON "Report"
  FOR ALL
  USING (app_can_access_merchant("merchantId") OR "reporterId" = app_user_id())
  WITH CHECK ("reporterId" = app_user_id());

-- LegalPolicyAcceptance (nullable merchantId: platform-level acceptances)
ALTER TABLE "LegalPolicyAcceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalPolicyAcceptance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_acceptance_tenant ON "LegalPolicyAcceptance";
CREATE POLICY legal_acceptance_tenant ON "LegalPolicyAcceptance"
  FOR ALL
  USING ("userId" = app_user_id() OR app_can_access_merchant("merchantId"))
  WITH CHECK ("userId" = app_user_id());

-- CartItem: the customer is reached through the parent Cart.
ALTER TABLE "CartItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CartItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cart_item_tenant ON "CartItem";
CREATE POLICY cart_item_tenant ON "CartItem"
  FOR ALL
  USING (
    app_can_access_merchant("merchantId")
    OR EXISTS (SELECT 1 FROM "Cart" c WHERE c.id = "CartItem"."cartId" AND c."userId" = app_user_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "Cart" c WHERE c.id = "CartItem"."cartId" AND c."userId" = app_user_id())
  );

-- ItemRequestResponse: the customer is reached through the parent ItemRequest.
ALTER TABLE "ItemRequestResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItemRequestResponse" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_request_response_tenant ON "ItemRequestResponse";
CREATE POLICY item_request_response_tenant ON "ItemRequestResponse"
  FOR ALL
  USING (
    app_can_access_merchant("merchantId")
    OR EXISTS (SELECT 1 FROM "ItemRequest" r WHERE r.id = "ItemRequestResponse"."requestId" AND r."requesterId" = app_user_id())
  )
  WITH CHECK (
    app_can_access_merchant("merchantId")
    OR EXISTS (SELECT 1 FROM "ItemRequest" r WHERE r.id = "ItemRequestResponse"."requestId" AND r."requesterId" = app_user_id())
  );

COMMIT;

-- ============================================================================
-- Verification queries (run after applying, as the app role, inside a txn)
-- ============================================================================
--
--   SELECT set_config('app.user_id', '<user A>', true);
--   SELECT count(*) FROM "Product";              -- only user A's tenants
--   SET LOCAL ROLE furnivo_app;                  -- must NOT be BYPASSRLS
--   SELECT count(*) FROM "Product" WHERE "merchantId" = '<user B tenant>';  -- 0
--
-- If the second count is not zero, the role has BYPASSRLS or the policy was not
-- forced. Do not deploy until it is zero.
