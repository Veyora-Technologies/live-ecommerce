import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secret-vault";

const prior = process.env.LIVE_SECRET_ENCRYPTION_KEY;
afterEach(() => {
  if (prior === undefined) delete process.env.LIVE_SECRET_ENCRYPTION_KEY;
  else process.env.LIVE_SECRET_ENCRYPTION_KEY = prior;
});

describe("encrypted integration secret storage", () => {
  it("encrypts and authenticates webhook signing secrets", () => {
    process.env.LIVE_SECRET_ENCRYPTION_KEY = "unit-test-key-material-with-at-least-32-characters";
    const cipher = encryptSecret("a-one-time-webhook-signing-key");
    expect(cipher).toMatch(/^enc:v1:/);
    expect(cipher).not.toContain("a-one-time-webhook-signing-key");
    expect(decryptSecret(cipher)).toBe("a-one-time-webhook-signing-key");
  });

  it("rejects tampering and legacy plaintext values", () => {
    process.env.LIVE_SECRET_ENCRYPTION_KEY = "unit-test-key-material-with-at-least-32-characters";
    const cipher = encryptSecret("secret-value");
    const tampered = `${cipher.slice(0, -2)}xx`;
    expect(() => decryptSecret(tampered)).toThrow();
    expect(() => decryptSecret("legacy-plaintext-secret")).toThrow(/not encrypted/);
  });
});
