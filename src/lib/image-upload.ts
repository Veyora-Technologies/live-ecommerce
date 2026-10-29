import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_UPLOAD_BYTES, MEDIA_URL_PREFIX, mediaUrl as toMediaUrl } from "./media-path";

/**
 * Merchant image uploads.
 *
 * Scope: product photographs and storefront pictures. Payment proofs, identity
 * documents and verification evidence are explicitly out of scope and must not
 * be sent here.
 *
 * Storage is a single local directory (`LIVE_UPLOAD_DIR`). It is intentionally
 * fail-closed: with no directory configured the upload endpoint refuses to work
 * rather than writing files somewhere unexpected. A writable local directory is
 * adequate for a single Node server; multi-instance/serverless deployments still
 * need object storage and a CDN, and that remains an owner decision.
 */

export { MAX_UPLOAD_BYTES };

export type AllowedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const EXTENSIONS: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Filenames are server-generated; this is the only shape the media route will serve. */
export const MEDIA_NAME_RE = /^[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/;
export { MEDIA_URL_PREFIX };

export function mediaUrl(name: string) {
  return toMediaUrl(name);
}

/** Reject any name that could escape the upload directory. */
export function isSafeMediaName(name: string): boolean {
  return typeof name === "string" && MEDIA_NAME_RE.test(name);
}

export function contentTypeForMediaName(name: string): AllowedImageType | null {
  if (!isSafeMediaName(name)) return null;
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const entry = Object.entries(EXTENSIONS).find(([, value]) => value === ext);
  return entry ? (entry[0] as AllowedImageType) : null;
}

/**
 * Detect an image from its magic bytes. The `Content-Type` and filename supplied
 * by the client are never trusted, so a renamed HTML/SVG payload is rejected.
 */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a) return "image/png";
  // RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  return null;
}

/** Configured upload directory, or null when the operator has not opted in. */
export function uploadDir(): string | null {
  const configured = process.env.LIVE_UPLOAD_DIR?.trim();
  if (!configured || !configured.startsWith("/")) return null;
  return configured;
}

export function uploadConfigured(): boolean {
  return uploadDir() !== null;
}

export type StoredImage = { name: string; url: string; type: AllowedImageType; bytes: number };

/** Persist image bytes under a random, non-guessable filename. */
export async function storeImage(bytes: Uint8Array): Promise<StoredImage | null> {
  const dir = uploadDir();
  if (!dir) return null;
  const type = detectImageType(bytes);
  if (!type || bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) return null;
  const name = `${randomBytes(16).toString("hex")}.${EXTENSIONS[type]}`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), bytes, { mode: 0o644 });
  return { name, url: mediaUrl(name), type, bytes: bytes.length };
}

/** Read a stored image. Returns null for unsafe or missing names. */
export async function readImage(name: string): Promise<{ bytes: Buffer; type: AllowedImageType } | null> {
  const dir = uploadDir();
  if (!dir || !isSafeMediaName(name)) return null;
  const type = contentTypeForMediaName(name);
  if (!type) return null;
  try {
    return { bytes: await readFile(join(dir, name)), type };
  } catch {
    return null;
  }
}
