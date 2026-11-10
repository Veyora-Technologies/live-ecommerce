import { prisma } from "./db";
import { getCurrentUser } from "./auth";
import type { CurrentUserView } from "./auth-user-view";
import { normalizeAdminRole, roleAllows, type AdminRole } from "./admin-roles";

export {
  ADMIN_ROLES,
  CREDENTIAL_ROTATION_ROLES,
  MERCHANT_MODERATION_ROLES,
  PLATFORM_ANALYTICS_ROLES,
  PLATFORM_CONFIG_ROLES,
  normalizeAdminRole,
  roleAllows,
} from "./admin-roles";
export type { AdminRole } from "./admin-roles";

/**
 * Resolve the caller's admin role, or null when the caller is not an admin.
 * `isAdmin` alone is never sufficient for an operational action: the persisted
 * `adminRole` decides what the account may actually do.
 */
export async function currentAdminRole(): Promise<{ user: CurrentUserView; role: AdminRole } | null> {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.isAdmin) return null;
  const full = await prisma.user.findUnique({ where: { id: user.id }, select: { adminRole: true } });
  return { user, role: normalizeAdminRole(full?.adminRole) };
}

/** Require one of `roles`. Returns null when the caller lacks the role. */
export async function requireAdminRole(
  roles: readonly AdminRole[],
): Promise<{ user: CurrentUserView; role: AdminRole } | null> {
  const admin = await currentAdminRole();
  if (!admin) return null;
  return roleAllows(admin.role, roles) ? admin : null;
}
