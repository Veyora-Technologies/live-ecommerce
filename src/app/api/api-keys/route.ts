import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManageTeam, merchantRole } from "@/lib/permissions";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "private, no-store" } };
const createSchema = z.object({
  merchantId: z.string().min(1).max(40),
  name: z.string().trim().min(2).max(100),
  scopes: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
}).strict();

function parseScopes(input: string | string[] | undefined) {
  const values = (Array.isArray(input) ? input : (input || "read").split(/[ ,]+/)).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(values)];
  // This pass only supports a non-privileged listing/read credential. No key-based writes or customer data.
  if (!unique.length || unique.some((value) => value !== "read" && value !== "public:read")) return null;
  return "read";
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const merchantId = (req.nextUrl.searchParams.get("merchantId") || "").trim();
  if (!merchantId) return NextResponse.json({ error: "merchantId is required" }, { status: 400, ...noStore });
  const role = await merchantRole(merchantId, user.id);
  if (!canManageTeam(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  const keys = await prisma.apiCredential.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, revoked: true } });
  return NextResponse.json({ keys, note: "Raw keys are never returned again. Private read/write scopes are not enabled in this phase." }, noStore);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid API key request" }, { status: 400, ...noStore });
  const input = parsed.data;
  const role = await merchantRole(input.merchantId, user.id);
  if (!canManageTeam(role)) return NextResponse.json({ error: "Only an owner or manager can create a merchant API key" }, { status: 403, ...noStore });
  const scopes = parseScopes(input.scopes);
  if (!scopes) return NextResponse.json({ error: "Only the non-privileged read scope is available. Write or customer-data scopes are not enabled." }, { status: 400, ...noStore });
  const raw = `live_${crypto.randomBytes(32).toString("base64url")}`;
  const prefix = raw.slice(0, 12);
  const keyHash = await bcrypt.hash(raw, 12);
  const credential = await prisma.$transaction(async (tx) => {
    const created = await tx.apiCredential.create({ data: { userId: user.id, merchantId: input.merchantId, name: input.name, keyHash, prefix, scopes, revoked: false } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "API_CREDENTIAL_CREATE", resourceType: "ApiCredential", resourceId: created.id, outcome: "SUCCESS" } });
    return created;
  });
  return NextResponse.json({ credential: { id: credential.id, prefix, scopes, name: credential.name }, apiKey: raw, warning: "Copy this key now; it is shown once and stored as a password hash. No API route currently accepts it, so it grants no access today. Public read endpoints remain unauthenticated; private and write scopes are not enabled." }, { status: 201, ...noStore });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const id = req.nextUrl.searchParams.get("id");
  if (!id || id.length > 64) return NextResponse.json({ error: "A valid key id is required" }, { status: 400, ...noStore });
  const credential = await prisma.apiCredential.findUnique({ where: { id }, select: { id: true, merchantId: true, userId: true, revoked: true } });
  if (!credential) return NextResponse.json({ error: "API key not found" }, { status: 404, ...noStore });
  const role = credential.merchantId ? await merchantRole(credential.merchantId, user.id) : null;
  if (credential.userId !== user.id && !canManageTeam(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  await prisma.$transaction(async (tx) => {
    await tx.apiCredential.update({ where: { id }, data: { revoked: true } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "API_CREDENTIAL_REVOKE", resourceType: "ApiCredential", resourceId: id, outcome: "SUCCESS" } });
  });
  return NextResponse.json({ ok: true, revoked: true }, noStore);
}
