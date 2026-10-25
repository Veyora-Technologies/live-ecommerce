import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Brand regression guard.
 *
 * The product is Furnivo. These assertions exist so a future edit cannot quietly
 * reintroduce the old brand name in user-facing surfaces, and so the identities
 * that were deliberately preserved during the rename stay preserved.
 */

const ROOT = join(__dirname, "..", "..");

/** Every user-facing source file under a directory. */
function sourceFiles(dir: string, extensions = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Documented exceptions: places where "Live" must survive the rename because it
 * is a wire contract rather than brand copy.
 *
 *  - `X-Live-Event` / `X-Live-Delivery-Id` / `X-Live-Signature` are HTTP headers
 *    sent to third-party webhook receivers. Renaming them would silently break
 *    every existing integration's signature verification.
 */
const ALLOWED: { file: string; contains: string; why: string }[] = [
  {
    file: "src/app/api/jobs/process/route.ts",
    contains: "X-Live-",
    why: "webhook header contract for existing integrators",
  },
];

function brandHits(files: string[]): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
  for (const file of files) {
    const relative = file.replace(`${ROOT}/`, "");
    readFileSync(file, "utf8").split("\n").forEach((text, index) => {
      // Whole-word "Live" only: LIVE_* env vars, live_* identifiers, live-* CSS
      // classes, /my-live and LivePulse are all intentionally untouched.
      if (!/\bLive\b/.test(text)) return;
      const allowed = ALLOWED.some((rule) => rule.file === relative && text.includes(rule.contains));
      if (allowed) return;
      hits.push({ file: relative, line: index + 1, text: text.trim().slice(0, 120) });
    });
  }
  return hits;
}

describe("Furnivo branding", () => {
  it("has no old brand name in any app or component source", () => {
    const hits = brandHits([
      ...sourceFiles(join(ROOT, "src", "app")),
      ...sourceFiles(join(ROOT, "src", "components")),
    ]);
    expect(hits, hits.map((h) => `${h.file}:${h.line} ${h.text}`).join("\n")).toEqual([]);
  });

  it("declares Furnivo in the installable manifest", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "public", "manifest.json"), "utf8"));
    expect(manifest.short_name).toBe("Furnivo");
    expect(manifest.name).toMatch(/^Furnivo/);
    expect(manifest.description).toMatch(/Furnivo/);
  });

  it("declares Furnivo in the document metadata", () => {
    const layout = readFileSync(join(ROOT, "src", "app", "layout.tsx"), "utf8");
    expect(layout).toContain('applicationName: "Furnivo"');
    expect(layout).toContain('siteName: "Furnivo"');
    expect(layout).toMatch(/title: "Furnivo/);
  });

  it("keeps the brand name in the offline shell and service worker", () => {
    expect(readFileSync(join(ROOT, "public", "offline.html"), "utf8")).toMatch(/Furnivo/);
    expect(readFileSync(join(ROOT, "public", "sw.js"), "utf8")).toMatch(/Furnivo/);
  });

  it("preserves the technical identifiers the rename must not touch", () => {
    // Cookies and env vars are a live wire contract: renaming them would sign
    // every existing user out and break every deployment's configuration.
    const auth = readFileSync(join(ROOT, "src", "lib", "auth.ts"), "utf8");
    expect(auth).toContain("live_token");
    expect(readFileSync(join(ROOT, "src", "app", "api", "auth", "forgot", "route.ts"), "utf8")).toContain("RESEND_API_KEY");
    expect(readFileSync(join(ROOT, "src", "lib", "env.ts"), "utf8")).toContain("LIVE_DATA_MODE");
    // Webhook header names are consumed by third-party integrations.
    const jobs = readFileSync(join(ROOT, "src", "app", "api", "jobs", "process", "route.ts"), "utf8");
    expect(jobs).toContain('"X-Live-Signature"');
    expect(jobs).not.toContain("X-Furnivo-Signature");
  });

  it("serves the same favicon from the app directory as from public", () => {
    // Next serves `src/app/favicon.ico` in preference to `public/favicon.ico`.
    // The rename regenerated only the public copy, so the old green mark kept
    // being served long after the brand changed. Both files now come out of
    // scripts/brand/generate-brand-assets.py and must stay byte-identical.
    const appIcon = readFileSync(join(ROOT, "src", "app", "favicon.ico"));
    const publicIcon = readFileSync(join(ROOT, "public", "favicon.ico"));
    expect(appIcon.equals(publicIcon)).toBe(true);
  });

  it("documents the webhook headers the code actually sends", () => {
    // The rename rewrote the integration docs to `X-Furnivo-*` while the code
    // kept sending `X-Live-*`. Integrators following the docs would have
    // verified signatures against header names that never arrive.
    const docs = readFileSync(join(ROOT, "docs", "INTEGRATIONS.md"), "utf8");
    expect(docs).toContain("X-Live-Signature");
    expect(docs).not.toContain("X-Furnivo-");
  });

  it("renders the logo from an asset that exists", () => {
    const component = readFileSync(join(ROOT, "src", "components", "BrandLogo.tsx"), "utf8");
    const paths = [...component.matchAll(/"(\/brand\/[^"]+)"/g)].map((match) => match[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(() => statSync(join(ROOT, "public", path.replace(/^\//, "")))).not.toThrow();
    }
  });
});
