import { prisma } from "./db";

/**
 * Persist domain events and matching webhook deliveries. Domain side effects
 * must be handled by explicit idempotent handlers, not a generic success stub.
 */
export async function emitEvent(type: string, payload: any, opts: { merchantId?: string; userId?: string } = {}) {
  await prisma.backgroundJob.create({ data: { type, payload: JSON.stringify(payload), status: "PENDING", nextRunAt: new Date() } });
  if (!opts.merchantId) return;
  const subs = await prisma.webhookSubscription.findMany({ where: { merchantId: opts.merchantId, active: true }, select: { id: true, events: true } });
  for (const sub of subs) {
    let events: string[] = [];
    try { const parsed = JSON.parse(sub.events || "[]"); events = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; }
    catch { continue; }
    if (events.includes(type) || events.includes("*")) {
      await prisma.webhookDelivery.create({ data: { subscriptionId: sub.id, event: type, payload: JSON.stringify(payload), status: "PENDING" } });
    }
  }
}

/** Generic job handlers are not implemented; report pending work without falsely marking it successful. */
export async function processJobs(limit = 10) {
  const pending = await prisma.backgroundJob.count({ where: { status: { in: ["PENDING", "FAILED"] } } });
  return { processed: 0, unsupportedJobs: Math.min(pending, Math.max(0, limit)), pendingUnsupportedJobs: pending };
}
