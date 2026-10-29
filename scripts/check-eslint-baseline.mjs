#!/usr/bin/env node
/**
 * ESLint debt budget gate.
 *
 * The repository carries a large pre-existing lint backlog. Rather than
 * blocking every build on it, this gate fails only when lint debt *grows*:
 *
 *   - total errors exceed the stored baseline
 *   - total warnings exceed the stored baseline
 *   - any single file/rule/message combination exceeds its stored count
 *   - a violation appears in a file/rule that the baseline does not contain
 *
 * Usage:
 *   node scripts/check-eslint-baseline.mjs            # verify (CI)
 *   node scripts/check-eslint-baseline.mjs --update   # rewrite the baseline
 *
 * Deleting violations is always allowed — the gate rewards paying debt down.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const baselinePath = join(repoRoot, "eslint-baseline.json");
const eslintBin = join(repoRoot, "node_modules", "eslint", "bin", "eslint.js");

const update = process.argv.includes("--update");

if (!existsSync(eslintBin)) {
  console.error("[lint:ci] ESLint is not installed. Run `npm ci --legacy-peer-deps` first.");
  process.exit(1);
}

const run = spawnSync(process.execPath, [eslintBin, ".", "--format", "json"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

// ESLint exits 0 (clean), 1 (lint problems found) or 2 (fatal/config error).
// Only 2 is an infrastructure failure; 1 is expected and carries the report.
if (run.error) {
  console.error(`[lint:ci] Could not run ESLint: ${run.error.message}`);
  process.exit(1);
}
if (run.status !== 0 && run.status !== 1) {
  console.error("[lint:ci] ESLint failed to run (exit status %s).", run.status);
  if (run.stderr) console.error(run.stderr.trim());
  process.exit(1);
}

let results;
try {
  results = JSON.parse(run.stdout || "[]");
} catch {
  console.error("[lint:ci] Could not parse ESLint JSON output.");
  if (run.stderr) console.error(run.stderr.trim());
  process.exit(1);
}

const violations = {};
let errors = 0;
let warnings = 0;

for (const file of results) {
  const relative = file.filePath.replace(`${repoRoot}/`, "");
  for (const message of file.messages ?? []) {
    const severity = Number(message.severity) === 2 ? 2 : 1;
    if (severity === 2) errors += 1;
    else warnings += 1;
    const key = `${relative}|${message.ruleId ?? ""}|${message.messageId ?? ""}|${severity}`;
    violations[key] = (violations[key] ?? 0) + 1;
  }
}

if (update) {
  const sorted = Object.fromEntries(Object.entries(violations).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, `${JSON.stringify({ errors, warnings, violations: sorted }, null, 2)}\n`, "utf8");
  console.log(`[lint:ci] Baseline updated: ${errors} errors, ${warnings} warnings, ${Object.keys(sorted).length} rule buckets.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch {
  console.error(`[lint:ci] Missing or unreadable baseline at ${baselinePath}. Run with --update to create it.`);
  process.exit(1);
}

const failures = [];

if (errors > (baseline.errors ?? 0)) {
  failures.push(`total errors grew from ${baseline.errors ?? 0} to ${errors}`);
}
if (warnings > (baseline.warnings ?? 0)) {
  failures.push(`total warnings grew from ${baseline.warnings ?? 0} to ${warnings}`);
}

const baselineViolations = baseline.violations ?? {};
for (const [key, count] of Object.entries(violations)) {
  const allowed = baselineViolations[key] ?? 0;
  if (count > allowed) {
    const [file, rule, , severity] = key.split("|");
    failures.push(`${file}: ${rule || "parse-error"} (severity ${severity}) ${count > baselineViolations[key] ? `went from ${allowed} to ${count}` : ""}`.trim());
  }
}

const improved = Object.entries(baselineViolations).reduce(
  (sum, [key, allowed]) => sum + Math.max(0, allowed - (violations[key] ?? 0)),
  0,
);

if (failures.length) {
  console.error("[lint:ci] Lint debt budget exceeded:\n");
  for (const failure of failures.slice(0, 50)) console.error(`  - ${failure}`);
  if (failures.length > 50) console.error(`  ... and ${failures.length - 50} more`);
  console.error(`\n[lint:ci] Current: ${errors} errors, ${warnings} warnings.`);
  console.error("[lint:ci] Fix the new violations, or lower the baseline only with reviewer sign-off.");
  process.exit(1);
}

console.log(`[lint:ci] OK — ${errors} errors / ${warnings} warnings (baseline ${baseline.errors ?? 0} / ${baseline.warnings ?? 0}).`);
if (improved > 0) {
  console.log(`[lint:ci] ${improved} violation(s) fixed since the baseline was recorded. Consider running --update to lock in the improvement.`);
}
process.exit(0);
