import { describe, it, expect } from "vitest";
import { parseNaturalQuery, expandQueryWithSynonyms } from "../../src/lib/nlp";
import { fuzzyScore } from "../../src/lib/semantic";
import { availabilityConfidence, reservable, availabilityFromStock, stockoutRisk } from "../../src/lib/confidence";

describe("natural-language search parsing", () => {
  it("'Find paracetamol near me' extracts product + distance", () => {
    const p = parseNaturalQuery("Find paracetamol near me");
    expect(p.q.toLowerCase()).toContain("paracetamol");
    expect(p.distanceKm).toBe(3);
  });
  it("'Where can I buy rice under ₦10,000?' extracts budget", () => {
    const p = parseNaturalQuery("Where can I buy rice under ₦10,000?");
    expect(p.maxPrice).toBe(10000);
    expect(p.q.toLowerCase()).toContain("rice");
  });
  it("'Show me pharmacies open now within 3 kilometres'", () => {
    const p = parseNaturalQuery("Show me pharmacies open now within 3 kilometres");
    expect(p.category).toBe("Pharmacy");
    expect(p.openNow).toBe(true);
    expect(p.distanceKm).toBe(3);
  });
  it("'phone charger for pickup before 6 PM' extracts pickup + time", () => {
    const p = parseNaturalQuery("I need a phone charger available for pickup before 6 PM");
    expect(p.pickup).toBe(true);
    expect(p.timeWindow).toBeTruthy();
  });
  it("area detection: Wuse", () => {
    expect(parseNaturalQuery("Rice in stock in Wuse").area).toBe("Wuse");
  });
  it("compare intent", () => {
    expect(parseNaturalQuery("Compare the prices of rice in nearby shops").intent).toBe("compare");
  });
});

describe("semantic helpers", () => {
  it("synonyms expand paracetamol to panadol/acetaminophen", () => {
    const ex = expandQueryWithSynonyms("paracetamol");
    expect(ex.some(s => s.includes("panadol"))).toBe(true);
  });
  it("fuzzy score rewards containment and token overlap", () => {
    expect(fuzzyScore("Paracetamol 500mg", "paracetamol")).toBeGreaterThan(0.5);
    expect(fuzzyScore("Peak Milk", "detergentXYZ")).toBeLessThan(0.5);
  });
});

describe("availability confidence (evidence-based labels)", () => {
  it("recently confirmed", () => {
    const c = availabilityConfidence({ availability:"IN_STOCK", stockQuantity:10, lastConfirmedAt:new Date(Date.now()-3600000) });
    expect(c.label).toBe("Recently confirmed");
  });
  it("stale is never labelled fresh", () => {
    const c = availabilityConfidence({ availability:"IN_STOCK", stockQuantity:10, lastConfirmedAt:new Date(Date.now()-72*3600000) });
    expect(c.label).toBe("Availability may have changed");
  });
  it("out of stock", () => {
    expect(availabilityConfidence({ availability:"OUT_OF_STOCK", stockQuantity:0 }).label).toBe("Currently unavailable");
  });
  it("unknown awaits confirmation", () => {
    expect(availabilityConfidence({ availability:"UNKNOWN" }).label).toBe("Awaiting confirmation");
  });
});

describe("inventory rules", () => {
  it("reservable never negative and subtracts reservations", () => {
    expect(reservable(10, 3)).toBe(7);
    expect(reservable(2, 5)).toBe(0);
  });
  it("availability from stock", () => {
    expect(availabilityFromStock(0, 5)).toBe("OUT_OF_STOCK");
    expect(availabilityFromStock(5, 5)).toBe("LOW_STOCK");
    expect(availabilityFromStock(6, 5)).toBe("IN_STOCK");
  });
  it("stockout risk flags low stock, advisory only", () => {
    expect(stockoutRisk({ stockQuantity:3, lowStockThreshold:5 }).level).toBe("HIGH");
    expect(stockoutRisk({ stockQuantity:0, lowStockThreshold:5 }).level).toBe("OUT");
  });
});

describe("query cleaning regression", () => {
  it("strips bare budget numbers and area from q", () => {
    const p = parseNaturalQuery("rice under 10000 in Wuse");
    expect(p.q.toLowerCase()).toBe("rice");
    expect(p.maxPrice).toBe(10000);
    expect(p.area).toBe("Wuse");
  });
  it("strips budget from 'paracetamol near me under 2000'", () => {
    expect(parseNaturalQuery("Find paracetamol near me under 2000").q.toLowerCase()).toBe("paracetamol");
  });
  it("does not convert malformed or unsafe budget digits into a numeric filter", () => {
    const malformed = parseNaturalQuery("rice under 1,00");
    const fractional = parseNaturalQuery("rice under ₦10.50");
    const oversized = parseNaturalQuery("rice under 999999999999999999999999999");
    expect(malformed.priceFilterInvalid).toBe(true);
    expect(fractional.priceFilterInvalid).toBe(true);
    expect(oversized.priceFilterInvalid).toBe(true);
    expect(oversized.maxPrice).toBeUndefined();
  });
});
