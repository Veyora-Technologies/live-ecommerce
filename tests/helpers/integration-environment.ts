const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function liveIntegrationEnabled() {
  return process.env.LIVE_INTEGRATION === "1";
}

export function liveIntegrationBase() {
  const base = process.env.LIVE_BASE_URL || "http://localhost:3000";
  if (!liveIntegrationEnabled()) return base;

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("LIVE_BASE_URL must be a valid loopback URL for destructive integration tests.");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("Integration tests refuse non-loopback hosts. Use an isolated local test database and server; do not target staging or production.");
  }
  return url.origin;
}
