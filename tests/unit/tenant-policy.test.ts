import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MERCHANT_OWNED_MODELS, SHARED_WITH_CUSTOMER_MODELS } from "@/lib/tenant-policy";

/**
 * Keeps the tenant classification honest against the schema.
 *
 * Row-level security is only as good as its coverage: a new tenant table that
 * nobody classified is a table with no policy. Rather than trust a comment,
 * this test re-derives every model that carries a `merchantId` from
 * `prisma/schema.prisma` and requires it to appear in exactly one bucket.
 *
 * It also checks the *columns*, because an earlier draft of `tenant.ts` guessed
 * `Review.reviewerId` and `Enquiry.consumerId` — neither exists. A policy that
 * names a column that is not there fails open at 3am, not at review time.
 */

const ROOT = join(__dirname, "..", "..");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");

/** model name → set of field names, parsed from the Prisma schema. */
function parseModels(schema: string): Map<string, Set<string>> {
  const models = new Map<string, Set<string>>();
  let current: string | null = null;
  let fields = new Set<string>();

  for (const line of schema.split("\n")) {
    const start = /^model\s+(\w+)\s*\{/.exec(line.trim());
    if (start) {
      current = start[1];
      fields = new Set();
      continue;
    }
    if (current && line.trim() === "}") {
      models.set(current, fields);
      current = null;
      continue;
    }
    if (current) {
      const field = /^\s{2}(\w+)\s+\S/.exec(line);
      if (field) fields.add(field[1]);
    }
  }
  return models;
}

const MODELS = parseModels(SCHEMA);
const TENANT_MODELS = [...MODELS.entries()]
  .filter(([, fields]) => fields.has("merchantId"))
  .map(([name]) => name)
  .sort();

const CLASSIFIED = [...MERCHANT_OWNED_MODELS, ...SHARED_WITH_CUSTOMER_MODELS].map((m) => m.model).sort();

describe("tenant model classification", () => {
  it("parses the schema (guards the parser itself)", () => {
    expect(MODELS.size).toBeGreaterThan(40);
    expect(MODELS.get("Product")?.has("merchantId")).toBe(true);
  });

  it("classifies every model that carries a merchantId", () => {
    const unclassified = TENANT_MODELS.filter((name) => !CLASSIFIED.includes(name));
    expect(unclassified, `Unclassified tenant models: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("does not classify a model that has no merchantId", () => {
    const wrong = CLASSIFIED.filter((name) => !TENANT_MODELS.includes(name));
    expect(wrong, `Classified but not tenant-scoped: ${wrong.join(", ")}`).toEqual([]);
  });

  it("classifies each model exactly once", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const name of CLASSIFIED) {
      if (seen.has(name)) duplicates.push(name);
      seen.add(name);
    }
    expect(duplicates).toEqual([]);
  });

  it("names only columns that exist in the schema", () => {
    const problems: string[] = [];
    for (const rule of MERCHANT_OWNED_MODELS) {
      const fields = MODELS.get(rule.model);
      if (!fields) problems.push(`${rule.model}: model not found`);
      else if (!fields.has(rule.column)) problems.push(`${rule.model}: no column ${rule.column}`);
    }
    for (const rule of SHARED_WITH_CUSTOMER_MODELS) {
      const fields = MODELS.get(rule.model);
      if (!fields) {
        problems.push(`${rule.model}: model not found`);
        continue;
      }
      if (!fields.has(rule.column)) problems.push(`${rule.model}: no column ${rule.column}`);
      if (rule.userColumn && !fields.has(rule.userColumn)) {
        problems.push(`${rule.model}: no column ${rule.userColumn}`);
      }
      if (!rule.userColumn && !rule.userPath) {
        problems.push(`${rule.model}: shared model needs userColumn or userPath`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("ships a PostgreSQL policy file covering the same tables", () => {
    const sql = readFileSync(join(ROOT, "prisma", "rls", "policies.sql"), "utf8");
    // The SQL is not applied today (SQLite datasource), but it must stay in
    // step with the application list or the migration would bank a gap.
    const missing = MERCHANT_OWNED_MODELS
      .map((m) => m.model)
      .filter((name) => !sql.includes(`'${name}'`) && !sql.includes(`"${name}"`));
    expect(missing, `Not present in policies.sql: ${missing.join(", ")}`).toEqual([]);
  });
});
