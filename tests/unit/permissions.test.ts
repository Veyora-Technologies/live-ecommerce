import { describe, it, expect } from "vitest";
import { canEditInventory, canManageReservations, canManageTeam, canViewReports } from "../../src/lib/permissions";

describe("merchant staff roles", () => {
  it("inventory staff can edit stock but not manage team", () => {
    expect(canEditInventory("INVENTORY_STAFF")).toBe(true);
    expect(canManageTeam("INVENTORY_STAFF")).toBe(false);
  });
  it("reservation staff can manage orders but not stock", () => {
    expect(canManageReservations("RESERVATION_STAFF")).toBe(true);
    expect(canEditInventory("RESERVATION_STAFF")).toBe(false);
  });
  it("read-only can view reports and nothing else", () => {
    expect(canViewReports("READ_ONLY")).toBe(true);
    expect(canEditInventory("READ_ONLY")).toBe(false);
    expect(canManageReservations("READ_ONLY")).toBe(false);
    expect(canManageTeam("READ_ONLY")).toBe(false);
  });
  it("no role = no access", () => {
    expect(canEditInventory(null)).toBe(false);
    expect(canViewReports(null)).toBe(false);
  });
  it("owner and manager have full operational rights", () => {
    for (const r of ["OWNER","MANAGER"] as const) {
      expect(canEditInventory(r)).toBe(true);
      expect(canManageReservations(r)).toBe(true);
      expect(canManageTeam(r)).toBe(true);
    }
  });
});
