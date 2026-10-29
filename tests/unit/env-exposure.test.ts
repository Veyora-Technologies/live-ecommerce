import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Never expose environment files" — enforced, not documented.
 *
 * Three separate ways an env file escapes a repository, and one assertion for
 * each:
 *   1. it is committed to git                → .gitignore must exclude it
 *   2. it is served as a static asset        → public/ must not contain one
 *   3. it is read and returned by a route    → no server code may fs-read .env
 *
 * A fourth, subtler route is bundling: importing the server env module into a
 * client component inlines the reads into a browser download. That is guarded
 * at runtime in `src/lib/env.ts` and asserted here.
 */

const ROOT = join(__dirname, "..", "..");

function gitignorePatterns(): string[] {
  return readFileSync(join(ROOT, ".gitignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 4 || !existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out, depth + 1);
    else out.push(full);
  }
  return out;
}

describe("environment files are ignored by git", () => {
  const patterns = gitignorePatterns();

  it("ignores .env", () => {
    expect(patterns).toContain(".env");
  });

  it("ignores every .env.* variant, not just .env.local", () => {
    expect(patterns).toContain(".env.*");
  });

  it("re-includes only the example file", () => {
    expect(patterns).toContain("!.env.example");
    // The negation must come after the ignore, or git will not honour it.
    expect(patterns.indexOf("!.env.example")).toBeGreaterThan(patterns.indexOf(".env.*"));
  });

  it("ignores private key material", () => {
    for (const pattern of ["*.pem", "*.key", "*.p12", "*.pfx"]) {
      expect(patterns).toContain(pattern);
    }
  });
});

describe("no env file is reachable as a static asset", () => {
  it("public/ contains no .env file", () => {
    const offenders = walk(join(ROOT, "public")).filter((file) =>
      /(^|\/)\.env/i.test(file.replace(ROOT, "")),
    );
    expect(offenders).toEqual([]);
  });

  it("public/ contains no key material", () => {
    const offenders = walk(join(ROOT, "public")).filter((file) =>
      /\.(pem|key|p12|pfx|keystore)$/i.test(file),
    );
    expect(offenders).toEqual([]);
  });

  it("only .env.example exists at the repository root", () => {
    const envFiles = readdirSync(ROOT).filter((name) => /^\.env/i.test(name));
    expect(envFiles).toEqual([".env.example"]);
  });
});

describe("no route reads an env file from disk", () => {
  it("server code never opens a .env path", () => {
    const sources = walk(join(ROOT, "src")).filter((file) => /\.(ts|tsx|js|mjs)$/.test(file));
    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      // Only flag a real filesystem read of a .env path, not a mention in a
      // comment or an error message pointing at .env.example.
      if (/(readFileSync|readFile|createReadStream)\s*\([^)]*\.env/.test(text)) {
        offenders.push(file.replace(ROOT + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the server env module cannot be bundled for the browser", () => {
  const envSource = readFileSync(join(ROOT, "src", "lib", "env.ts"), "utf8");

  it("fails closed when loaded in a browser context", () => {
    expect(envSource).toMatch(/typeof window !== "undefined"/);
  });

  it("still validates configuration on the server", () => {
    expect(envSource).toContain("safeParse");
  });

  it("reports invalid variable names without their values", () => {
    // The error message must name the field, never echo the secret beside it.
    expect(envSource).toMatch(/issues\.map/);
    expect(envSource).not.toMatch(/JSON\.stringify\(process\.env\)/);
  });
});

describe("next.config exposes nothing implicitly", () => {
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");

  it("does not copy environment variables into the client bundle", () => {
    // An `env: { ... }` block inlines those values into client JS forever.
    expect(config).not.toMatch(/\benv\s*:\s*\{/);
  });
});
