import { describe, expect, it } from "vitest";
import {
  MERCHANT_MODERATION_ROLES,
  PLATFORM_CONFIG_ROLES,
  normalizeAdminRole,
  roleAllows,
} from "@/lib/admin-roles";

describe("admin role authorization", () => {
  it("coerces unknown or missing roles to NONE", () => {
    expect(normalizeAdminRole(null)).toBe("NONE");
    expect(normalizeAdminRole(undefined)).toBe("NONE");
    expect(normalizeAdminRole("")).toBe("NONE");
    expect(normalizeAdminRole("ADMIN")).toBe("NONE");
    expect(normalizeAdminRole("super")).toBe("NONE");
  });

  it("keeps known roles intact", () => {
    for (const role of ["NONE", "SUPPORT", "REVIEWER", "SECURITY", "SUPER"] as const) {
      expect(normalizeAdminRole(role)).toBe(role);
    }
  });

  it("gives SUPER every permission", () => {
    expect(roleAllows("SUPER", PLATFORM_CONFIG_ROLES)).toBe(true);
    expect(roleAllows("SUPER", MERCHANT_MODERATION_ROLES)).toBe(true);
  });

  it("does not let an isAdmin-without-role account moderate merchants or change platform config", () => {
    expect(roleAllows("NONE", MERCHANT_MODERATION_ROLES)).toBe(false);
    expect(roleAllows("NONE", PLATFORM_CONFIG_ROLES)).toBe(false);
  });

  it("keeps platform configuration SUPER-only", () => {
    for (const role of ["NONE", "SUPPORT", "REVIEWER", "SECURITY"] as const) {
      expect(roleAllows(role, PLATFORM_CONFIG_ROLES)).toBe(false);
    }
  });

  it("lets support and reviewer roles moderate merchants but not change config", () => {
    expect(roleAllows("SUPPORT", MERCHANT_MODERATION_ROLES)).toBe(true);
    expect(roleAllows("REVIEWER", MERCHANT_MODERATION_ROLES)).toBe(true);
    expect(roleAllows("SUPPORT", PLATFORM_CONFIG_ROLES)).toBe(false);
  });
});
