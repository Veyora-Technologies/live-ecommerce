import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { PLATFORM_CONFIG_ROLES, requireAdminRole } from "@/lib/admin-access";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

const flagSchema = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  enabled: z.boolean().optional(),
  payload: z.unknown().optional(),
}).strict();

export async function GET() {
  const admin = await requireAdminRole(PLATFORM_CONFIG_ROLES);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ flags }, noStore);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminRole(PLATFORM_CONFIG_ROLES);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  const parsed = flagSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a key, a name, and an optional enabled/payload value" }, { status: 400, ...noStore });
  const { key, name, enabled, payload } = parsed.data;
  const serialized = payload === undefined ? null : JSON.stringify(payload).slice(0, 4000);
  const flag = await prisma.featureFlag.upsert({
    where: { key },
    update: { name, enabled: !!enabled, payload: serialized },
    create: { key, name, enabled: !!enabled, payload: serialized },
  });
  await prisma.auditLog.create({
    data: { actorId: admin.user.id, action: "FEATURE_FLAG_UPDATE", resourceType: "FeatureFlag", resourceId: flag.id, metadata: JSON.stringify({ key, enabled: !!enabled, adminRole: admin.role }) },
  });
  return NextResponse.json({ flag }, noStore);
}
