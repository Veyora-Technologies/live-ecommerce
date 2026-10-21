import crypto from "crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { prisma } from "./db";

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashIp(ip: string | null | undefined) {
  if (!ip) return null;
  const salt = process.env.JWT_SECRET;
  if (!salt || salt.length < 16) return null;
  return crypto.createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}

export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export async function logSecurityEvent(type: string, opts: { userId?: string | null; headers?: Headers; metadata?: any } = {}) {
  try {
    await prisma.securityEvent.create({
      data: {
        type, userId: opts.userId || null,
        ipHash: opts.headers ? hashIp(clientIp(opts.headers)) : null,
        userAgent: opts.headers?.get("user-agent")?.slice(0, 200) || null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata).slice(0, 1000) : null,
      },
    });
  } catch { /* security logging must never break auth flow */ }
}

export async function raiseRisk(rule: string, subjectType: string, subjectId: string | null, severity: "LOW"|"MEDIUM"|"HIGH", reason: string) {
  try {
    // Dedupe: one OPEN event per rule+subject per hour
    const since = new Date(Date.now() - 3600000);
    const existing = await prisma.riskEvent.findFirst({ where:{ rule, subjectId, status:"OPEN", createdAt:{ gte: since } }});
    if (existing) return existing;
    return await prisma.riskEvent.create({ data:{ rule, subjectType, subjectId, severity, reason: reason.slice(0, 500) }});
  } catch { return null; }
}

/** Redact secrets/PII-ish fields before logging or auditing. */
export function redact(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const BLOCK = ["password", "passwordhash", "token", "secret", "mfasecret", "authorization", "cookie", "card", "cvv", "apikey", "keyhash"];
  const out: any = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = BLOCK.includes(k.toLowerCase()) ? "[REDACTED]" : (v && typeof v === "object" ? redact(v) : v);
  }
  return out;
}

/**
 * SSRF guard for server-side webhook requests. Rejects private/reserved ranges,
 * resolves DNS before delivery, and pins the selected public address for the socket.
 */
function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99) || (b === 0 && c === 2) || (b === 0 && c === 0))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 255 && b === 255));
}

function isPublicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;
  const host = address.toLowerCase().split("%")[0];
  if (host === "::" || host === "::1") return false;
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice(7);
    if (mapped.includes(".")) return isPublicIpv4(mapped);
    const parts = mapped.split(":");
    if (parts.length === 2 && parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) {
      const high = Number.parseInt(parts[0], 16), low = Number.parseInt(parts[1], 16);
      return isPublicIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return false;
  }
  const first = Number.parseInt(host.split(":")[0] || "0", 16);
  // Current IPv6 global-unicast allocation is within 2000::/3. Reject ULA,
  // link-local, multicast, transition, and documentation ranges explicitly.
  if (first < 0x2000 || first >= 0x4000 || host.startsWith("2001:db8:") || host.startsWith("2001:0:") || host.startsWith("2002:")) return false;
  return true;
}

export function assertSafeOutboundUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("Webhook URL must not include credentials");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") throw new Error("Destination not allowed");
  const ipVersion = isIP(host);
  if (ipVersion && !isPublicAddress(host)) throw new Error("Private or non-public network destinations are not allowed");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Production webhooks must use HTTPS");
  return url;
}

type SafeOutboundTarget = { url: URL; address: string; family: 4 | 6 };

/** Resolve every A/AAAA answer and pin the selected public IP for the actual request. */
export async function resolveSafeOutboundTarget(raw: string): Promise<SafeOutboundTarget> {
  const url = assertSafeOutboundUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(host);
  if (ipVersion) {
    if (!isPublicAddress(host)) throw new Error("Private or non-public network destinations are not allowed");
    return { url, address: host, family: ipVersion as 4 | 6 };
  }
  let addresses: { address: string; family: number }[];
  try { addresses = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new Error("Webhook host could not be resolved"); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Webhook host resolves to a private or non-public network destination");
  const selected = addresses[0];
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export async function assertSafeOutboundUrlResolved(raw: string): Promise<URL> {
  return (await resolveSafeOutboundTarget(raw)).url;
}

/** POST a signed webhook while pinning DNS to the validated address (mitigates DNS rebinding). */
export async function postSafeWebhook(raw: string, body: string, headers: Record<string, string>, timeoutMs = 8000) {
  if (Buffer.byteLength(body, "utf8") > 512_000) throw new Error("Webhook payload exceeds the delivery size limit");
  const target = await resolveSafeOutboundTarget(raw);
  const request = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  return await new Promise<number>((resolve, reject) => {
    const req = request(target.url, {
      method: "POST",
      headers: { ...headers, "Content-Length": String(Buffer.byteLength(body, "utf8")) },
      lookup: (_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, target.address, target.family),
      timeout: timeoutMs,
    }, (response) => {
      let responseBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        responseBytes += Buffer.byteLength(chunk);
        if (responseBytes > 64_000) response.destroy(new Error("Webhook response exceeded the size limit"));
      });
      response.on("end", () => resolve(response.statusCode || 0));
      response.on("error", reject);
      response.resume();
    });
    req.on("timeout", () => req.destroy(new Error("Webhook request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}
