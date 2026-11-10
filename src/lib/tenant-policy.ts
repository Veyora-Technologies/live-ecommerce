/**
 * Tenant classification data.
 *
 * Split out of `tenant.ts` so the policy table can be inspected and tested
 * without constructing a Prisma client. `tenant.ts` re-exports both arrays, so
 * importers keep one entry point.
 */

/**
 * Models whose rows belong to exactly one tenant, and the key that holds it.
 *
 * Derived from `prisma/schema.prisma` (every model with a `merchantId` column)
 * and deliberately split in two, because "merchantId is present" does not mean
 * "only merchant staff may read it":
 *
 *  - **MERCHANT_OWNED** — created and read by the business. Nothing outside the
 *    tenant and platform staff has any business seeing these rows.
 *  - **SHARED_WITH_CUSTOMER** — the customer originated the row and the merchant
 *    fulfils it. Both the owning user and the merchant may read it, and a
 *    policy that returns only the merchant's view would silently hide a
 *    customer's own cart or reservation from them.
 *
 * `prisma/rls/policies.sql` mirrors this split for PostgreSQL; the arrays here
 * are the source of truth that the audit test checks against the schema, so a
 * new tenant table cannot be added without someone classifying it.
 */
export const MERCHANT_OWNED_MODELS: ReadonlyArray<{ model: string; column: string }> = [
  { model: "Product", column: "merchantId" },
  { model: "Branch", column: "merchantId" },
  { model: "ProductBatch", column: "merchantId" },
  { model: "BranchTransfer", column: "merchantId" },
  { model: "InventoryMovement", column: "merchantId" },
  { model: "PriceObservation", column: "merchantId" },
  { model: "AvailabilityEvent", column: "merchantId" },
  { model: "OperatingException", column: "merchantId" },
  { model: "Promotion", column: "merchantId" },
  { model: "Service", column: "merchantId" },
  { model: "MerchantSubscription", column: "merchantId" },
  { model: "MerchantMembership", column: "merchantId" },
  { model: "WebhookSubscription", column: "merchantId" },
  { model: "IntegrationConnection", column: "merchantId" },
  { model: "ApiCredential", column: "merchantId" },
  { model: "MarketplaceListing", column: "merchantId" },
  { model: "ComplianceCase", column: "merchantId" },
  { model: "VerificationCase", column: "merchantId" },
  { model: "ApprovalRequest", column: "merchantId" },
];

/**
 * Rows a customer of the business also owns or may read.
 *
 * `userColumn` is the column that identifies the customer on the row. It is
 * `null` where the customer is only reachable through a parent row (a cart line
 * belongs to a `Cart`, an item-request response belongs to an `ItemRequest`),
 * and the policy file joins through that parent instead of guessing a column
 * that does not exist.
 *
 * These columns were read from `prisma/schema.prisma`, not assumed: an earlier
 * draft of this table guessed `Review.reviewerId` and `Enquiry.consumerId`,
 * neither of which exists. `tests/unit/tenant-policy.test.ts` now re-derives
 * every column from the schema so the list cannot drift again.
 */
export const SHARED_WITH_CUSTOMER_MODELS: ReadonlyArray<{
  model: string;
  column: string;
  userColumn: string | null;
  userPath?: string;
}> = [
  { model: "CartItem", column: "merchantId", userColumn: null, userPath: "Cart.userId" },
  { model: "Reservation", column: "merchantId", userColumn: "consumerId" },
  { model: "Review", column: "merchantId", userColumn: "authorId" },
  { model: "Enquiry", column: "merchantId", userColumn: "requesterId" },
  { model: "ServiceBooking", column: "merchantId", userColumn: "consumerId" },
  { model: "ItemRequestResponse", column: "merchantId", userColumn: null, userPath: "ItemRequest.requesterId" },
  { model: "SavedItem", column: "merchantId", userColumn: "userId" },
  { model: "Report", column: "merchantId", userColumn: "reporterId" },
  { model: "LegalPolicyAcceptance", column: "merchantId", userColumn: "userId" },
];
