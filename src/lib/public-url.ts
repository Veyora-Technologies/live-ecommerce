export function getPublicBaseUrl(): string | null {
  const configured = process.env.LIVE_PUBLIC_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".e2b.app")) return null;
    return url.origin;
  } catch {
    return null;
  }
}
