/**
 * Admin role model (pure — no database import).
 *
 * SUPER    — full platform access, including legal/policy publication.
 * SECURITY — privacy requests, incidents, verification, risk.
 * REVIEWER — listing moderation, complaints, disputes, IP reports.
 * SUPPORT  — complaints/disputes only, and only when assigned.
 * NONE     — isAdmin without any operational role: no operational authority.
 */
export const ADMIN_ROLES = ["NONE", "SUPPORT", "REVIEWER", "SECURITY", "SUPER"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Coerce a stored/legacy value into a known role. Unknown values become NONE. */
export function normalizeAdminRole(value: string | null | undefined): AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value ?? "") ? (value as AdminRole) : "NONE";
}

/** Platform configuration (feature flags, freshness policy). */
export const PLATFORM_CONFIG_ROLES: readonly AdminRole[] = ["SUPER"];

/** Merchant approval/suspension. NONE is excluded on purpose. */
export const MERCHANT_MODERATION_ROLES: readonly AdminRole[] = ["SUPPORT", "REVIEWER", "SECURITY", "SUPER"];

/** Aggregate platform analytics exposes cross-tenant counts. */
export const PLATFORM_ANALYTICS_ROLES: readonly AdminRole[] = ["SUPPORT", "REVIEWER", "SECURITY", "SUPER"];

/** Credential/operating-secret rotation. */
export const CREDENTIAL_ROTATION_ROLES: readonly AdminRole[] = ["SECURITY", "SUPER"];

/** True when `role` may perform an action restricted to `allowed` (SUPER always may). */
export function roleAllows(role: AdminRole, allowed: readonly AdminRole[]): boolean {
  return role === "SUPER" || allowed.includes(role);
}
