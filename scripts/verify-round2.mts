/**
 * Reproducible verification harness for the round-2 changes.
 *
 * Run:  npx tsx scripts/verify-round2.mts
 *
 * It exercises the real modules directly — no Next.js server, no database, no
 * external account — and prints PASS/FAIL per property. Writes only inside a
 * fresh OS temp directory, which it removes afterwards. The final email check
 * deliberately calls the provider with a fake key: with network it gets a 401,
 * without network a connection error, and both must degrade to PROVIDER_ERROR
 * or TIMEOUT rather than a false success.
 */
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeImage, readImage, detectImageType, uploadDir, isSafeMediaName, contentTypeForMediaName } from "../src/lib/image-upload";
import { sendEmail, emailConfigured, emailLinkBase } from "../src/lib/email";

const results: string[] = [];
const ok = (label: string, pass: boolean, detail = "") => {
  results.push(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return pass;
};

// A minimal, real 1x1 PNG (magic bytes matter; the rest is a valid IHDR/IDAT tail).
const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function main() {
  // ---------- uploads: real filesystem round-trip ----------
  const dir = mkdtempSync(join(tmpdir(), "live-verify-"));
  process.env.LIVE_UPLOAD_DIR = dir;

  ok("uploadDir() accepts an absolute path", uploadDir() === dir, dir);

  const stored = await storeImage(png);
  ok("storeImage() persists a real PNG", Boolean(stored), stored ? stored.name : "null");
  if (stored) {
    ok("stored name is random 32-hex + real extension", /^[a-f0-9]{32}\.png$/.test(stored.name), stored.name);
    ok("storeImage reports the true mime type", stored.type === "image/png", stored.type);
    ok("file exists on disk", existsSync(join(dir, stored.name)));
    ok("exactly one file written", readdirSync(dir).length === 1, `${readdirSync(dir).length} file(s)`);

    const back = await readImage(stored.name);
    ok("readImage() returns the same bytes", Boolean(back) && Buffer.compare(Buffer.from(back!.bytes), Buffer.from(png)) === 0, back ? `${back.bytes.length} bytes` : "null");
    ok("readImage() reports image/png", back?.type === "image/png", String(back?.type));

    // Traversal / abuse attempts must all be refused.
    for (const bad of ["../" + stored.name, "../../etc/passwd", stored.name.toUpperCase(), `${"a".repeat(32)}.png`, `${stored.name}.txt`, `%2e%2e/${stored.name}`]) {
      ok(`readImage refuses ${JSON.stringify(bad)}`, (await readImage(bad)) === null);
    }
  }

  // Non-image content must never be stored, whatever it is called.
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>");
  ok("storeImage rejects HTML", (await storeImage(html)) === null);
  ok("storeImage rejects SVG", (await storeImage(svg)) === null);
  ok("storeImage rejects empty input", (await storeImage(new Uint8Array(0))) === null);
  ok("detectImageType rejects a 3-byte JPEG header", detectImageType(Uint8Array.from([0xff, 0xd8, 0xff])) === null);
  ok("no extra files were created by the rejected uploads", readdirSync(dir).length === 1);

  // Fail-closed configuration.
  process.env.LIVE_UPLOAD_DIR = "relative/path";
  ok("storeImage refuses a relative LIVE_UPLOAD_DIR", (await storeImage(png)) === null);
  delete process.env.LIVE_UPLOAD_DIR;
  ok("storeImage refuses unset LIVE_UPLOAD_DIR", (await storeImage(png)) === null);
  ok("contentTypeForMediaName maps .png", contentTypeForMediaName(`${"b".repeat(32)}.png`) === "image/png");
  ok("isSafeMediaName rejects a traversal name", isSafeMediaName("../x.png") === false);

  rmSync(dir, { recursive: true, force: true });

  // ---------- email: configuration and fail-closed behaviour ----------
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.LIVE_PUBLIC_BASE_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;

  ok("emailConfigured() is false with no variables", emailConfigured() === false);
  const noConfig = await sendEmail({ to: "owner@example.com", subject: "s", text: "t" });
  ok("sendEmail() reports NOT_CONFIGURED instead of pretending", noConfig.delivered === false && noConfig.reason === "NOT_CONFIGURED", JSON.stringify(noConfig));

  process.env.RESEND_API_KEY = "re_fake_key_for_verification_only";
  ok("an API key alone does not enable email", emailConfigured() === false);
  delete process.env.RESEND_API_KEY;

  process.env.EMAIL_FROM = "Furnivo <no-reply@example.com>";
  process.env.RESEND_API_KEY = "re_fake_key_for_verification_only";
  ok("key + From enables emailConfigured()", emailConfigured() === true);

  // No public origin configured -> no usable reset link base.
  ok("emailLinkBase() is null without a public origin", emailLinkBase() === null);
  process.env.LIVE_PUBLIC_BASE_URL = "http://localhost:3000";
  ok("emailLinkBase() rejects http://localhost", emailLinkBase() === null);
  process.env.LIVE_PUBLIC_BASE_URL = "https://1234-abc.e2b.app";
  ok("emailLinkBase() rejects a sandbox preview host", emailLinkBase() === null);
  process.env.LIVE_PUBLIC_BASE_URL = "https://live.example.com";
  ok("emailLinkBase() accepts a public https origin", emailLinkBase() === "https://live.example.com", String(emailLinkBase()));

  // With no network reachable to the provider, delivery must degrade honestly.
  const failing = await sendEmail({ to: "owner@example.com", subject: "verification probe", text: "nothing sensitive" });
  ok("sendEmail() fails closed when the provider is unreachable", failing.delivered === false && (failing.reason === "PROVIDER_ERROR" || failing.reason === "TIMEOUT"), JSON.stringify(failing));

  console.log(results.join("\n"));
  const failures = results.filter((line) => line.startsWith("FAIL"));
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((error) => { console.error("HARNESS ERROR", error); process.exitCode = 2; });
