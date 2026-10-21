const INTERNAL_BASE = "https://live.invalid";
const MAX_REDIRECT_LENGTH = 2048;

function normalizeInternalPath(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_REDIRECT_LENGTH || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }

  try {
    const target = new URL(value, INTERNAL_BASE);
    if (target.origin !== INTERNAL_BASE) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

/** Allow only same-origin paths for post-login navigation. */
export function safeInternalPath(candidate: string | null | undefined, fallback = "/"): string {
  return normalizeInternalPath(candidate) ?? normalizeInternalPath(fallback) ?? "/";
}
