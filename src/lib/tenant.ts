import { prisma } from "./db";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./api-errors";
import { MERCHANT_ROLES, type MerchantRole } from "./permissions";

/**
 * Row-level security for tenant data.
 *
 * ## Why this exists
 *
 * Almost every merchant-scoped table (`Product`, `Branch`, `Batch`, `Transfer`,
 * webhook subscriptions, API keys, team rows) is addressed by a `merchantId`
 * that arrives **from the client**. Nothing in Prisma or in the SQL layer stops
 * a handler from looking up `merchantId=<somebody else's>` and returning it.
 * Each route was individually responsible for remembering `merchantRole(...)`.
 * One forgotten check is a cross-tenant data leak, and it is invisible in code
 * review because the query looks perfectly ordinary.
 *
 * ## What this enforces
 *
 * `requireMerchantAccess` is the single gate. It resolves the caller's role
 * from `Merchant.ownerId` **or** an ACTIVE `MerchantMembership`, refuses the
 * caller otherwise, and optionally narrows to a set of roles. It returns the
 * role so the handler can then apply a *capability* decision (`canEditInventory`
 * and friends from `./permissions`).
 *
 * Authorisation is therefore two orthogonal questions, both required:
 *   1. May this caller touch this tenant at all?  → `requireMerchantAccess`
 *   2. May their role perform this action?         → `./permissions`
 *
 * ## Why not rely on PostgreSQL RLS alone
 *
 * The Prisma datasource is SQLite, which has no row-level security at all.
 * `prisma/rls/policies.sql` ships the equivalent policy set for the planned
 * PostgreSQL migration, but until then the database cannot enforce this, so the
 * application layer must. When Postgres lands, both layers stay: defence in
 * depth, with the SQL as the backstop for any future query path that forgets
 * this module.
 */

/** Every role that may read tenant data, weakest first. */
export const ANY_MERCHANT_ROLE = MERCHANT_ROLES;

export type TenantSubject = { userId: string; isAdmin?: boolean };

/**
 * Resolve the caller's role on a merchant, or null when they have none.
 *
 * Admins are **not** implicitly members: platform staff access is a separate,
 * explicitly audited path (`requireAdminRole`), so a compromised consumer
 * account can never reach merchant inventory by flipping `isAdmin`.
 */
export async function merchantAccessRole(userId: string, merchantId: string): Promise<MerchantRole | null> {
  if (!userId || !merchantId) return null;

  const merchant = await prisma.merchant.findFirst({
    where: {
      id: merchantId,
      OR: [
        { ownerId: userId },
        { memberships: { some: { userId, status: "ACTIVE" } } },
      ],
    },
    select: {
      ownerId: true,
      memberships: { where: { userId, status: "ACTIVE" }, select: { role: true }, take: 1 },
    },
  });

  if (!merchant) return null;
  if (merchant.ownerId === userId) return "OWNER";

  const role = merchant.memberships[0]?.role;
  return MERCHANT_ROLES.includes(role as MerchantRole) ? (role as MerchantRole) : null;
}

/**
 * The gate. Throws instead of returning a flag so a caller cannot accidentally
 * ignore a falsy result and continue with an unscoped query.
 */
export async function requireMerchantAccess(
  userId: string | null | undefined,
  merchantId: string | null | undefined,
  options: { roles?: readonly MerchantRole[] } = {},
): Promise<MerchantRole> {
  if (!userId) throw new UnauthorizedError();
  if (!merchantId) throw new ForbiddenError("A merchant must be specified.");

  const role = await merchantAccessRole(userId, merchantId);
  if (!role) {
    // Deliberately indistinguishable from "does not exist": telling a caller
    // that a merchant id is real but not theirs leaks the id space.
    throw new NotFoundError("That business could not be found.");
  }
  if (options.roles && !options.roles.includes(role)) {
    throw new ForbiddenError("Your role on this business cannot perform that action.");
  }
  return role;
}

/**
 * Guard a record that carries `merchantId`.
 *
 * Use this when the merchant id is discovered from the database rather than
 * supplied by the caller — e.g. `PATCH /api/merchant/products/[id]` where the
 * body has a product id. The caller must be authorised for *the owning tenant*,
 * not for whichever tenant they happen to be a member of.
 */
export async function requireRecordAccess<T extends { merchantId: string }>(
  userId: string | null | undefined,
  record: T | null | undefined,
  options: { roles?: readonly MerchantRole[] } = {},
): Promise<{ record: T; role: MerchantRole }> {
  if (!record) throw new NotFoundError();
  const role = await requireMerchantAccess(userId, record.merchantId, options);
  return { record, role };
}

/**
 * Where-clause for "every merchant this user may see".
 *
 * Use it for any list endpoint that can be called without an explicit
 * merchant id, so the query is scoped by construction rather than by a filter
 * applied afterwards.
 */
export function visibleMerchantWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      { memberships: { some: { userId, status: "ACTIVE" } } },
    ],
  };
}

/**
 * Resolve the single merchant a merchant-scoped endpoint should act on.
 *
 * Prefers an explicit id, otherwise the caller's own merchant. Returns null when
 * the caller has no merchant at all, which callers render as an empty state
 * rather than an authorisation error.
 */
export async function resolveOwnedMerchantId(userId: string, requestedId?: string | null): Promise<string | null> {
  if (requestedId) {
    await requireMerchantAccess(userId, requestedId);
    return requestedId;
  }
  const owned = await prisma.merchant.findFirst({
    where: visibleMerchantWhere(userId),
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return owned?.id ?? null;
}

export {
  MERCHANT_OWNED_MODELS,
  SHARED_WITH_CUSTOMER_MODELS,
} from "./tenant-policy";
