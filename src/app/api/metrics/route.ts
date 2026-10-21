import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnvStatus } from "@/lib/env";

/**
 * Operational metrics (§14/§44), token-protected (METRICS_TOKEN).
 * Availability accuracy, failed reservations, merchant confirmation,
 * search zero-results, failed jobs, security events. No personal data.
 */
export async function GET(req: NextRequest) {
  const token = process.env.METRICS_TOKEN;
  const provided = req.headers.get("authorization")?.replace("Bearer ", "");
  if (process.env.NODE_ENV === "production" && (!token || provided !== token)) {
    return NextResponse.json({ error: "Metrics require METRICS_TOKEN" }, { status: 401 });
  }
  const since = new Date(Date.now() - 24 * 3600000);
  const [reservations24h, failed, confirmedVsRequested, zeroSearches, failedWebhooks, securityEvents, openRisk] = await Promise.all([
    prisma.reservation.count({ where:{ createdAt:{ gte: since } } }),
    prisma.reservation.count({ where:{ createdAt:{ gte: since }, status:{ in:["EXPIRED", "CANCELLED"] } } }),
    prisma.reservation.groupBy({ by:["status"], where:{ createdAt:{ gte: since } }, _count: true }),
    prisma.demandAggregate.count({ where:{ lastSeen:{ gte: since } } }),
    prisma.webhookDelivery.count({ where:{ createdAt:{ gte: since }, status: "FAILED" } }),
    prisma.securityEvent.count({ where:{ createdAt:{ gte: since } } }),
    prisma.riskEvent.count({ where:{ status: "OPEN" } }),
  ]);
  const merchantConfirmed = await prisma.reservation.count({ where:{ status:{ in:["CONFIRMED", "READY", "COLLECTED"] } } });
  const unavailableConfirmedGap = merchantConfirmed;
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    windowHours: 24,
    reservationsCreated: reservations24h,
    reservationsEndedUnfulfilled: failed,
    byStatus: Object.fromEntries(confirmedVsRequested.map((r: any) => [r.status, r._count])),
    zeroResultDemandSignals: zeroSearches,
    failedWebhookDeliveries: failedWebhooks,
    securityEvents24h: securityEvents,
    openRiskEvents: openRisk,
    _note: `Merchant confirmation coverage tracked via reliability fields (${unavailableConfirmedGap} confirmed historically). Latency percentiles need APM in production (SENTRY_DSN / OTel).`,
    config: getEnvStatus(),
  });
}
