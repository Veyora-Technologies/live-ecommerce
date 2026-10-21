import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManageTeam, merchantRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "private, no-store" } };
const createSchema = z.object({
  merchantId: z.string().min(1).max(40),
  provider: z.enum(["POS", "DELIVERY", "SUPPLIER"]),
  name: z.string().trim().min(2).max(120),
}).strict();

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const merchantId = (req.nextUrl.searchParams.get("merchantId") || "").trim();
  if (!merchantId) return NextResponse.json({ error: "merchantId is required" }, { status: 400, ...noStore });
  if (!await merchantRole(merchantId, user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  const integrations = await prisma.integrationConnection.findMany({
    where: { merchantId }, orderBy: { createdAt: "desc" },
    select: { id: true, merchantId: true, provider: true, name: true, status: true, lastSyncAt: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ integrations, note: "Connections remain disconnected until an authorized provider adapter, secure credentials, and a verified test are configured." }, noStore);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid integration record" }, { status: 400, ...noStore });
  const input = parsed.data;
  const role = await merchantRole(input.merchantId, user.id);
  if (!canManageTeam(role)) return NextResponse.json({ error: "Only an owner or manager can register integrations" }, { status: 403, ...noStore });
  const integration = await prisma.$transaction(async (tx) => {
    const created = await tx.integrationConnection.create({ data: { merchantId: input.merchantId, provider: input.provider, name: input.name, config: null, status: "DISCONNECTED" } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "INTEGRATION_REGISTER", resourceType: "IntegrationConnection", resourceId: created.id, outcome: "DISCONNECTED" } });
    return created;
  });
  return NextResponse.json({ integration: { id: integration.id, merchantId: integration.merchantId, provider: integration.provider, name: integration.name, status: integration.status, createdAt: integration.createdAt }, note: "A connection record was created only. No provider credentials were accepted, no sync ran, and the integration is not active." }, { status: 201, ...noStore });
}
