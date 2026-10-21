import { describe, expect, it } from "vitest";
import { extractUniversalSearchTerms, isActivityFocusedQuery } from "@/lib/unified-search";

describe("unified Live search interpretation", () => {
  it("extracts bounded, deduplicated intent terms without location boilerplate", () => {
    expect(extractUniversalSearchTerms("Find a barber near me in Jos for tomorrow" )).toEqual(["barber", "jos", "tomorrow"]);
    expect(extractUniversalSearchTerms("rice rice under ₦10,000")).toEqual(["rice"]);
  });

  it("recognizes private activity requests without widening their authorization scope", () => {
    expect(isActivityFocusedQuery("show my reservations")).toBe(true);
    expect(isActivityFocusedQuery("where is my last quotation")).toBe(true);
    expect(isActivityFocusedQuery("find a barber in Jos")).toBe(false);
  });

  it("bounds arbitrary user input to six search terms", () => {
    expect(extractUniversalSearchTerms("alpha bravo charlie delta echo foxtrot golf hotel")).toHaveLength(6);
  });
});
