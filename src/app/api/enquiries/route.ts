import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole } from "@/lib/permissions";
import { raiseRisk } from "@/lib/security";
import { requirePolicyAcceptances, requirePolicyAcceptancesInTransaction } from "@/lib/legal";
import { isPublicMarketplaceProduct, isPublicMarketplaceService, publicMarketplaceProductInTransaction, publicMarketplaceServiceInTransaction } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

/** Structured enquiries use a private in-app thread. Contact/address sharing is not implemented. */
const TYPES = ["CONFIRM_STOCK", "ASK_PRICE", "ASK_ALTERNATIVE", "PICKUP_TIMING", "DELIVERY", "SERVICE_AVAILABILITY", "OTHER"] as const;
const LINK_RE = /(https?:\/\/|www\.)/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const HAS_DIRECT_CONTACT = (body: string) => PHONE_RE.test(body) || EMAIL_RE.test(body);
const LIVE_LISTING = { lifecycleStatus: "PUBLISHED", moderationStatus: "APPROVED", visibility: "PUBLIC", transactionEligible: true } as const;

const createSchema = z.object({
  merchantId: z.string().trim().min(1).max(64),
  enquiryType: z.enum(TYPES),
  body: z.string().trim().min(1).max(1000),
  productId: z.string().trim().min(1).max(64).optional(),
  serviceId: z.string().trim().min(1).max(64).optional(),
  reservationId: z.string().trim().min(1).max(64).optional(),
  shareContact: z.boolean().optional(),
}).strict();
const messageSchema = z.object({ enquiryId: z.string().trim().min(1).max(64), body: z.string().trim().min(1).max(1000) }).strict();
const closeSchema = z.object({ enquiryId: z.string().trim().min(1).max(64), action: z.enum(["close", "report"]).optional(), report: z.boolean().optional(), reason: z.string().trim().max(500).optional() }).strict();

type EnquiryView = {
  id: string;
  merchantId: string;
  subject: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  merchant: { id: string; businessName: string } | null;
  product: { id: string; name: string } | null;
  service: { id: string; name: string } | null;
};

function safeEnquiry(enquiry: EnquiryView, side: "CONSUMER" | "MERCHANT") {
  return {
    id: enquiry.id,
    merchantId: enquiry.merchantId,
    subject: enquiry.subject,
    status: enquiry.status,
    createdAt: enquiry.createdAt,
    updatedAt: enquiry.updatedAt,
    side,
    merchant: enquiry.merchant ? { id: enquiry.merchant.id, businessName: enquiry.merchant.businessName } : null,
    product: enquiry.product ? { id: enquiry.product.id, name: enquiry.product.name } : null,
    service: enquiry.service ? { id: enquiry.service.id, name: enquiry.service.name } : null,
  };
}

async function participant(userId: string, enquiryId: string) {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: {
      merchant: { select: { id: true, businessName: true } },
      product: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
  });
  if (!enquiry) return null;
  if (enquiry.requesterId === userId) return { enquiry, side: "CONSUMER" as const };
  const role = await merchantRole(enquiry.merchantId, userId);
  return role ? { enquiry, side: "MERCHANT" as const } : null;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (id) {
    const current = await participant(user.id, id);
    if (!current) return NextResponse.json({ error: "Enquiry not found or access is not permitted." }, { status: 404 });
    const messages = await prisma.enquiryMessage.findMany({
      where: { enquiryId: id },
      select: { id: true, authorId: true, body: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      enquiry: safeEnquiry(current.enquiry, current.side),
      messages: messages.map((message) => ({ id: message.id, body: message.body, createdAt: message.createdAt, side: message.authorId === current.enquiry.requesterId ? "CONSUMER" : "MERCHANT" })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const [memberships, owned] = await Promise.all([
    prisma.merchantMembership.findMany({ where: { userId: user.id, status: "ACTIVE" }, select: { merchantId: true } }),
    prisma.merchant.findMany({ where: { ownerId: user.id }, select: { id: true } }),
  ]);
  const merchantIds = [...new Set([...memberships.map((item) => item.merchantId), ...owned.map((item) => item.id)])];
  const enquiries = await prisma.enquiry.findMany({
    where: { OR: [{ requesterId: user.id }, { merchantId: { in: merchantIds } }] },
    include: {
      merchant: { select: { id: true, businessName: true } },
      product: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ enquiries: enquiries.map((enquiry) => safeEnquiry(enquiry, enquiry.requesterId === user.id ? "CONSUMER" : "MERCHANT")) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const policyCheck = await requirePolicyAcceptances({ userId: user.id, keys: ["PLATFORM_TERMS", "PRIVACY_NOTICE", "CONSUMER_TERMS"] });
  if (!policyCheck.allowed) return NextResponse.json({ error: policyCheck.message || "Review Furnivo policies before sending a marketplace enquiry.", code: policyCheck.code, missingPolicies: policyCheck.missing, policyUrl: "/legal" }, { status: policyCheck.code === "LEGAL_RELEASE_GATE" ? 503 : 428 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid enquiry type, listing, and message of 1–1,000 characters." }, { status: 400 });
  const input = parsed.data;
  if (input.shareContact) return NextResponse.json({ error: "In-app contact sharing is not available. No contact details were shared." }, { status: 400 });
  if (HAS_DIRECT_CONTACT(input.body)) return NextResponse.json({ error: "Phone numbers and email addresses cannot be sent through this enquiry. No message was saved or shared." }, { status: 400 });
  if ((input.productId && input.serviceId) || (input.reservationId && input.serviceId)) return NextResponse.json({ error: "Choose one product or service listing per enquiry." }, { status: 400 });

  const merchant = await prisma.merchant.findFirst({ where: { id: input.merchantId, status: "APPROVED" }, select: { id: true, ownerId: true, businessName: true } });
  if (!merchant) return NextResponse.json({ error: "Merchant is not available for enquiries." }, { status: 404 });
  if (await merchantRole(merchant.id, user.id)) return NextResponse.json({ error: "Use a separate buyer account to contact this merchant." }, { status: 403 });

  let productId = input.productId;
  const serviceId = input.serviceId;
  if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, merchantId: merchant.id, archived: false, merchant: { status: "APPROVED" }, marketplaceListing: { is: LIVE_LISTING } },
      select: { id: true },
    });
    if (!product || !await isPublicMarketplaceProduct(productId)) return NextResponse.json({ error: "That product listing is not available for a marketplace enquiry." }, { status: 404 });
  }
  if (serviceId) {
    const service = await prisma.service.findFirst({
      where: { id: serviceId, merchantId: merchant.id, merchant: { status: "APPROVED" }, marketplaceListing: { is: LIVE_LISTING } },
      select: { id: true },
    });
    if (!service || !await isPublicMarketplaceService(serviceId)) return NextResponse.json({ error: "That service listing is not available for a marketplace enquiry." }, { status: 404 });
  }
  if (input.reservationId) {
    const reservation = await prisma.reservation.findFirst({ where: { id: input.reservationId, consumerId: user.id, merchantId: merchant.id }, select: { id: true, productId: true } });
    if (!reservation) return NextResponse.json({ error: "Reservation not found for this account and merchant." }, { status: 404 });
    if (productId && productId !== reservation.productId) return NextResponse.json({ error: "The selected product does not match this reservation." }, { status: 400 });
    productId = reservation.productId;
  }

  const subject = `[${input.enquiryType}]${productId ? ` product:${productId}` : ""}${serviceId ? ` service:${serviceId}` : ""}`;
  const flagged = LINK_RE.test(input.body) || PHONE_RE.test(input.body);
  try {
    const enquiry = await prisma.$transaction(async (tx) => {
      if (!input.reservationId && productId && !await publicMarketplaceProductInTransaction(tx, productId)) throw new Error("MARKETPLACE_LISTING_NOT_PUBLIC");
      if (serviceId && !await publicMarketplaceServiceInTransaction(tx, serviceId)) throw new Error("MARKETPLACE_LISTING_NOT_PUBLIC");
      const sellerPolicy = await requirePolicyAcceptancesInTransaction(tx, { userId: merchant.ownerId, keys: ["SELLER_AGREEMENT"], merchantId: merchant.id });
      if (!sellerPolicy.allowed) throw new Error("LEGAL_POLICY_REQUIRED");
      const created = await tx.enquiry.create({ data: {
        requesterId: user.id,
        merchantId: merchant.id,
        productId: productId ?? null,
        serviceId: serviceId ?? null,
        reservationId: input.reservationId ?? null,
        subject,
      } });
      await tx.enquiryMessage.create({ data: { enquiryId: created.id, authorId: user.id, body: input.body } });
      await tx.notification.create({ data: { recipientId: merchant.ownerId, type: "ENQUIRY_RECEIVED", title: "New marketplace enquiry", body: `${input.enquiryType} enquiry for a listing`, resourceType: "Enquiry", resourceId: created.id } });
      return created;
    });
    if (flagged) await raiseRisk("CONTACT_EVASION_PATTERN", "USER", user.id, "LOW", `Marketplace enquiry ${enquiry.id} contains a link/phone pattern; flagged for review, not auto-blocked`);
    return NextResponse.json({
      enquiry: safeEnquiry({ ...enquiry, merchant, product: null, service: null }, "CONSUMER"),
      contactSharing: "No phone number or address was shared. In-app contact sharing is not enabled.",
      flagged: flagged ? "Message flagged for review; this is a signal, not a finding of misconduct." : undefined,
    }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "MARKETPLACE_LISTING_NOT_PUBLIC") return NextResponse.json({ error: "That listing is no longer available for a marketplace enquiry." }, { status: 404 });
    if (cause instanceof Error && cause.message === "LEGAL_POLICY_REQUIRED") return NextResponse.json({ error: "The seller has not accepted the current seller agreement. This enquiry was not created." }, { status: 428 });
    return NextResponse.json({ error: "Enquiry could not be saved. No contact details were shared; please retry." }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = messageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide an enquiry ID and message of 1–1,000 characters." }, { status: 400 });
  const current = await participant(user.id, parsed.data.enquiryId);
  if (!current) return NextResponse.json({ error: "Enquiry not found or access is not permitted." }, { status: 404 });
  const policyCheck = current.side === "CONSUMER"
    ? await requirePolicyAcceptances({ userId: user.id, keys: ["PLATFORM_TERMS", "PRIVACY_NOTICE", "CONSUMER_TERMS"] })
    : await requirePolicyAcceptances({ userId: user.id, keys: ["SELLER_AGREEMENT"], merchantId: current.enquiry.merchantId });
  if (!policyCheck.allowed) return NextResponse.json({ error: policyCheck.message || "Review current Furnivo policies before continuing this conversation.", code: policyCheck.code, missingPolicies: policyCheck.missing, policyUrl: "/legal" }, { status: policyCheck.code === "LEGAL_RELEASE_GATE" ? 503 : 428 });
  if (!["OPEN", "ANSWERED"].includes(current.enquiry.status)) return NextResponse.json({ error: "This enquiry is closed." }, { status: 409 });
  if (HAS_DIRECT_CONTACT(parsed.data.body)) return NextResponse.json({ error: "Phone numbers and email addresses cannot be sent through this enquiry. No message was saved or shared." }, { status: 400 });

  const flagged = LINK_RE.test(parsed.data.body);
  try {
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.enquiryMessage.create({ data: { enquiryId: current.enquiry.id, authorId: user.id, body: parsed.data.body } });
      if (current.side === "MERCHANT") await tx.enquiry.update({ where: { id: current.enquiry.id }, data: { status: "ANSWERED" } });
      return created;
    });
    if (flagged) await raiseRisk("CONTACT_EVASION_PATTERN", "USER", user.id, "LOW", `Enquiry ${current.enquiry.id} reply contains a link/phone pattern; flagged for review, not auto-blocked`);
    return NextResponse.json({ message: { id: message.id, body: message.body, createdAt: message.createdAt, side: current.side }, flagged: flagged ? "Flagged for review; this is not a finding of misconduct." : undefined }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Message could not be saved. The existing enquiry remains unchanged." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = closeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid enquiry action." }, { status: 400 });
  const current = await participant(user.id, parsed.data.enquiryId);
  if (!current) return NextResponse.json({ error: "Enquiry not found or access is not permitted." }, { status: 404 });
  const action = parsed.data.action || (parsed.data.report ? "report" : "close");
  if (action === "report") {
    await raiseRisk("USER_REPORT", "MERCHANT", current.enquiry.merchantId, "MEDIUM", `Enquiry ${current.enquiry.id} was reported for review: ${String(parsed.data.reason || "unspecified").slice(0, 200)}`);
    return NextResponse.json({ enquiry: safeEnquiry(current.enquiry, current.side), reportStatus: "SUBMITTED_FOR_REVIEW", note: "The report is a signal for human review; this action did not automatically block the conversation or establish misconduct." }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const updated = await prisma.enquiry.update({ where: { id: current.enquiry.id }, data: { status: "CLOSED" } });
  return NextResponse.json({ enquiry: safeEnquiry({ ...updated, merchant: current.enquiry.merchant, product: current.enquiry.product, service: current.enquiry.service }, current.side) }, { headers: { "Cache-Control": "private, no-store" } });
}
