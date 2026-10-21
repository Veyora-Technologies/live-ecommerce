import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

function vaultKey() {
  const configured = process.env.LIVE_SECRET_ENCRYPTION_KEY;
  if (configured && configured.length >= 32) return createHash("sha256").update(configured, "utf8").digest();
  if (process.env.NODE_ENV !== "production") return createHash("sha256").update(`${env().JWT_SECRET}:live-local-secret-vault:v1`, "utf8").digest();
  throw new Error("LIVE_SECRET_ENCRYPTION_KEY must be configured for production secret storage");
}

/** AES-256-GCM authenticated encryption for provider/webhook secrets at rest. */
export function encryptSecret(plainText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value: string | null | undefined) {
  if (!value || !value.startsWith("enc:v1:")) throw new Error("Stored integration secret is unavailable or not encrypted");
  const [ivPart, tagPart, ciphertextPart] = value.slice("enc:v1:".length).split(".");
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error("Stored integration secret is malformed");
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]).toString("utf8");
}
