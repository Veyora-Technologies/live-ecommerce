import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole } from "@/lib/permissions";

/** Only the no-charge account state is represented; unverified paid pricing/caps are not published. */
export const PLANS = {
  FREE: { name: "Free", priceNGN: 0, availability: "CURRENT_ACCOUNT_ONLY", description: "No subscription charge. Paid features and usage limits are not established here." },
} as const;
const subscriptionSchema = z.object({
  merchantId: z.string().trim().min(1).max(64),
  plan: z.enum(["FREE", "PRO", "PREMIUM"]).optional(),
  action: z.literal("cancel").optional(),
}).strict().refine((value) => Boolean(value.plan || value.action), { message: "Choose a plan or cancel the subscription" });
const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const merchantId = new URL(req.url).searchParams.get("merchantId")?.trim();
  if (!merchantId) return NextResponse.json({ error: "merchantId required" }, { status: 400, ...noStore });
  const role = await merchantRole(merchantId, user.id);
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  const sub = await prisma.merchantSubscription.findFirst({ where: { merchantId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    subscription: sub || { merchantId, plan: "FREE", status: "ACTIVE", currentPeriodEnd: null },
    plans: PLANS,
    note: "No subscription charge or paid activation occurs here. Paid plan prices, caps, checkout, and provider verification are not configured; only the current no-charge account state is shown.",
  }, noStore);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const parsed = subscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid subscription request" }, { status: 400, ...noStore });
  const { merchantId, plan, action } = parsed.data;
  const isOwner = await prisma.merchant.findFirst({ where: { id: merchantId, ownerId: user.id }, select: { id: true } });
  if (!isOwner) return NextResponse.json({ error: "Only the owner can change billing" }, { status: 403, ...noStore });
  if (action === "cancel") {
    const free = await prisma.$transaction(async (tx) => {
      await tx.merchantSubscription.updateMany({ where: { merchantId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      const current = await tx.merchantSubscription.findFirst({ where: { merchantId, plan: "FREE", status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
      return current || tx.merchantSubscription.create({ data: { merchantId, plan: "FREE", status: "ACTIVE" } });
    });
    return NextResponse.json({ subscription: free, cancelled: true, note: "No payment provider is connected through this route." }, noStore);
  }
  if (!plan) return NextResponse.json({ error: "Choose a subscription plan" }, { status: 400, ...noStore });
  if (plan !== "FREE") return NextResponse.json({ error: "Paid subscription checkout is not implemented", code: "FEATURE_NOT_CONFIGURED", detail: "No provider checkout or signed payment verification exists in this release. Plan was NOT activated and no charge was attempted." }, { status: 503, ...noStore });

  const subscription = await prisma.$transaction(async (tx) => {
    const current = await tx.merchantSubscription.findFirst({ where: { merchantId, plan: "FREE", status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    if (current) return current;
    await tx.merchantSubscription.updateMany({ where: { merchantId, status: "ACTIVE" }, data: { status: "SUPERSEDED" } });
    return tx.merchantSubscription.create({ data: { merchantId, plan: "FREE", status: "ACTIVE" } });
  });
  return NextResponse.json({ subscription }, noStore);
}
