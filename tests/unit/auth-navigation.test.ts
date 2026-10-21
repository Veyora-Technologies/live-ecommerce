import { describe, expect, it } from "vitest";
import { safeInternalPath } from "../../src/lib/auth-navigation";

describe("safeInternalPath", () => {
  it("preserves a same-origin route, query, and fragment", () => {
    expect(safeInternalPath("/profile/security?tab=sessions#active")).toBe("/profile/security?tab=sessions#active");
  });

  it("uses the role landing path when there is no next route", () => {
    expect(safeInternalPath(null, "/merchant")).toBe("/merchant");
  });

  it.each([
    "https://attacker.example/collect",
    "//attacker.example/collect",
    "///attacker.example/collect",
    "/\\attacker.example/collect",
    "",
  ])("rejects unsafe or empty destinations: %s", (candidate) => {
    expect(safeInternalPath(candidate, "/admin")).toBe("/admin");
  });

  it("falls back for overly long destinations and unsafe fallbacks", () => {
    expect(safeInternalPath(`/${"a".repeat(2048)}`, "/merchant")).toBe("/merchant");
    expect(safeInternalPath("//attacker.example", "https://attacker.example")).toBe("/");
  });
});
