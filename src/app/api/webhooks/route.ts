import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import crypto from "node:crypto";
import { assertSafeOutboundUrlResolved } from "@/lib/security";
import { canManageTeam, merchantRole } from "@/lib/permissions";
import { encryptSecret } from "@/lib/secret-vault";

const eventNames = ["transfer.acknowledged", "batch.created", "batch.updated"] as const;
const createSchema = z.object({
  merchantId: z.string().min(1).max(40),
  url: z.string().url().max(2048),
  events: z.array(z.enum(eventNames)).min(1).max(10),
}).strict();
const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const merchantId = (req.nextUrl.searchParams.get("merchantId") || "").trim();
  if (!merchantId) return NextResponse.json({ error: "merchantId is required" }, { status: 400, ...noStore });
  const role = await merchantRole(merchantId, user.id);
  if (!canManageTeam(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { merchantId }, orderBy: { createdAt: "desc" },
    select: { id: true, merchantId: true, url: true, events: true, active: true, createdAt: true, deliveries: { select: { id: true, event: true, status: true, attempts: true, lastAttemptAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 } },
  });
  return NextResponse.json({ webhooks: subscriptions.map((item) => ({ ...item, events: safeEvents(item.events) })) }, noStore);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid webhook subscription" }, { status: 400, ...noStore });
  const input = parsed.data;
  const role = await merchantRole(input.merchantId, user.id);
  if (!canManageTeam(role)) return NextResponse.json({ error: "Only an owner or manager can manage merchant webhooks" }, { status: 403, ...noStore });
  try { await assertSafeOutboundUrlResolved(input.url); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Webhook URL is not allowed" }, { status: 400, ...noStore }); }

  const rawSecret = crypto.randomBytes(32).toString("base64url");
  let encryptedSecret: string;
  try { encryptedSecret = encryptSecret(rawSecret); }
  catch { return NextResponse.json({ error: "Encrypted secret storage is not configured. No webhook was created." }, { status: 503, ...noStore }); }
  try {
    const webhook = await prisma.$transaction(async (tx) => {
      const created = await tx.webhookSubscription.create({ data: { merchantId: input.merchantId, url: input.url, events: JSON.stringify([...new Set(input.events)]), secret: encryptedSecret, active: true } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "WEBHOOK_CREATE", resourceType: "WebhookSubscription", resourceId: created.id, outcome: "SUCCESS" } });
      return created;
    });
    return NextResponse.json({ webhook: { id: webhook.id, url: webhook.url, events: JSON.parse(webhook.events), secret: rawSecret, active: webhook.active }, note: "The signing secret is shown once. Stored secret material is encrypted. Only the event types supported by the current event pipeline can be selected." }, { status: 201, ...noStore });
  } catch {
    return NextResponse.json({ error: "Webhook could not be created" }, { status: 400, ...noStore });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const id = req.nextUrl.searchParams.get("id");
  if (!id || id.length > 64) return NextResponse.json({ error: "A valid webhook id is required" }, { status: 400, ...noStore });
  const webhook = await prisma.webhookSubscription.findUnique({ where: { id }, select: { id: true, merchantId: true } });
  if (!webhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404, ...noStore });
  if (!webhook.merchantId) return NextResponse.json({ error: "Platform-level webhook management is not available through this endpoint" }, { status: 403, ...noStore });
  const role = await merchantRole(webhook.merchantId, user.id);
  if (!canManageTeam(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  await prisma.$transaction(async (tx) => {
    await tx.webhookSubscription.delete({ where: { id } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "WEBHOOK_DELETE", resourceType: "WebhookSubscription", resourceId: id, outcome: "SUCCESS" } });
  });
  return NextResponse.json({ ok: true }, noStore);
}

function safeEvents(value: string) {
  try { const events = JSON.parse(value); return Array.isArray(events) ? events.filter((event) => eventNames.includes(event)) : []; }
  catch { return []; }
}
