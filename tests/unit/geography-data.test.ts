import { describe, expect, it } from "vitest";
import data from "../../prisma/data/nigeria-geography.json";

const expectedStates = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

describe("Nigeria geography source seed", () => {
  it("contains all 36 states and represents the FCT as a separate territory", () => {
    const states = data.areas.filter((area) => area.type === "STATE").map((area) => area.name).sort();
    const territories = data.areas.filter((area) => area.type === "TERRITORY");
    expect(states).toEqual([...expectedStates].sort());
    expect(territories).toHaveLength(1);
    expect(territories[0].name).toBe("Federal Capital Territory");
    expect(territories[0].code).toBe("NG015");
    expect(states).not.toContain("Federal Capital Territory");
  });

  it("contains 774 unique admin-2 records, including the six FCT area councils", () => {
    const lgas = data.areas.filter((area) => area.type === "LGA");
    const councils = data.areas.filter((area) => area.type === "AREA_COUNCIL");
    expect(lgas).toHaveLength(768);
    expect(councils).toHaveLength(6);
    expect(new Set([...lgas, ...councils].map((area) => area.code)).size).toBe(774);
    expect(councils.every((area) => area.parentCode === "NG015")).toBe(true);
  });

  it("has stable unique codes, known parents, source attribution, and no partial ward import", () => {
    const codes = new Set(data.areas.map((area) => area.code));
    expect(codes.size).toBe(data.areas.length);
    expect(data.metadata.sourceDatasetUrl).toContain("data.humdata.org/dataset/cod-ab-nga");
    expect(data.metadata.sourceLicense).toContain("CC BY-IGO");
    expect(data.metadata.sourceReviewedAt).toBe("2025-10-30");
    expect(data.areas.every((area) => area.countryCode === "NG" && area.dataSource && area.sourceVersion)).toBe(true);
    expect(data.areas.every((area) => area.parentCode === "NG" || (area.parentCode !== null && codes.has(area.parentCode)))).toBe(true);
    expect(data.areas.some((area) => area.type === "WARD")).toBe(false);
  });
});
