import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processJobs } from "@/lib/events";
import { processPriceAlerts } from "@/lib/price-alerts";
import { processSavedSearchAlerts } from "@/lib/saved-search-alerts";
import crypto from "node:crypto";
import { postSafeWebhook } from "@/lib/security";
import { decryptSecret } from "@/lib/secret-vault";

/** Process implemented alerts and signed webhook deliveries; generic jobs remain explicitly unhandled. */
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-cron-secret") !== expected) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const genericJobs = await processJobs(10);
  const savedSearchAlerts = await processSavedSearchAlerts();
  const priceAlerts = await processPriceAlerts();
  const now = Date.now();
  // Recover work claimed by a process that died while a bounded outbound request was in flight.
  await prisma.webhookDelivery.updateMany({ where: { status: "PROCESSING", lastAttemptAt: { lt: new Date(now - 10 * 60_000) } }, data: { status: "RETRYING" } });
  const candidates = await prisma.webhookDelivery.findMany({
    where: { status: { in: ["PENDING", "RETRYING"] }, attempts: { lt: 5 } },
    include: { subscription: true }, take: 100, orderBy: { createdAt: "asc" },
  });
  let delivered = 0, failed = 0, attempted = 0;
  for (const delivery of candidates) {
    if (attempted >= 10) break;
    if (!delivery.subscription.active) {
      await prisma.webhookDelivery.updateMany({ where: { id: delivery.id, status: delivery.status, attempts: delivery.attempts }, data: { status: "FAILED" } });
      failed++;
      continue;
    }
    const backoffMs = Math.min(60_000 * 2 ** Math.max(0, delivery.attempts - 1), 60 * 60_000);
    if (delivery.lastAttemptAt && now - delivery.lastAttemptAt.getTime() < backoffMs) continue;
    const attemptAt = new Date();
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: delivery.status, attempts: delivery.attempts },
      data: { status: "PROCESSING", attempts: { increment: 1 }, lastAttemptAt: attemptAt },
    });
    if (claimed.count !== 1) continue;
    attempted++;
    const attemptNumber = delivery.attempts + 1;
    try {
      if (!delivery.subscription.secret) throw new Error("Webhook signing secret is unavailable");
      const webhookSecret = decryptSecret(delivery.subscription.secret);
      const signature = crypto.createHmac("sha256", webhookSecret).update(delivery.payload).digest("hex");
      const responseStatus = await postSafeWebhook(delivery.subscription.url, delivery.payload, { "Content-Type": "application/json", "X-Live-Event": delivery.event, "X-Live-Delivery-Id": delivery.id, "X-Live-Signature": `sha256=${signature}` }, 8000);
      if (responseStatus < 200 || responseStatus >= 300) throw new Error(`HTTP ${responseStatus}`);
      await prisma.webhookDelivery.updateMany({ where: { id: delivery.id, status: "PROCESSING" }, data: { status: "SUCCESS" } });
      delivered++;
    } catch {
      await prisma.webhookDelivery.updateMany({ where: { id: delivery.id, status: "PROCESSING" }, data: { status: attemptNumber >= 5 ? "FAILED" : "RETRYING" } });
      failed++;
    }
  }
  return NextResponse.json({ genericJobs, savedSearchAlerts, priceAlerts, webhooksDelivered: delivered, webhooksFailed: failed, webhookAttempts: attempted }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() { return NextResponse.json({ error: "Use POST for authenticated job processing" }, { status: 405, headers: { Allow: "POST" } }); }
