/**
 * Same-origin path for an uploaded image. Kept dependency-free so both server
 * helpers and client components can validate it without pulling in `node:fs`.
 */
export const MEDIA_URL_PREFIX = "/api/media/";
/** Hard cap enforced by /api/uploads and the proxy body limit. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MEDIA_NAME_PATTERN = "[a-f0-9]{32}\\.(?:jpg|png|webp|gif)";
const MEDIA_PATH_RE = new RegExp(`^${MEDIA_URL_PREFIX}${MEDIA_NAME_PATTERN}$`);

export function isMediaPath(value: string): boolean {
  return MEDIA_PATH_RE.test(value);
}

export function mediaUrl(name: string): string {
  return `${MEDIA_URL_PREFIX}${name}`;
}
