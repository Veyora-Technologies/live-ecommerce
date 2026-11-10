import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PLATFORM_CONFIG_ROLES, requireAdminRole } from "@/lib/admin-access";
import { DEFAULT_FRESHNESS } from "@/lib/confidence";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

/** Configurable availability freshness policies per category (§1). */
export async function GET() {
  const admin = await requireAdminRole(PLATFORM_CONFIG_ROLES);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  const rows = await prisma.freshnessPolicy.findMany({ orderBy:{ category: "asc" } });
  return NextResponse.json({ policies: rows, defaults: DEFAULT_FRESHNESS }, noStore);
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdminRole(PLATFORM_CONFIG_ROLES);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403, ...noStore });
  const b = await req.json().catch(() => ({}));
  if (!b.category) return NextResponse.json({ error: "category required" }, { status: 400 });
  const stale = Math.max(1, Math.min(720, Number(b.staleAfterHours) || 24));
  const recent = Math.max(1, Math.min(stale, Number(b.recentHours) || 6));
  const policy = await prisma.freshnessPolicy.upsert({
    where:{ category: b.category },
    create:{ category: b.category, staleAfterHours: stale, recentHours: recent },
    update:{ staleAfterHours: stale, recentHours: recent },
  });
  await prisma.auditLog.create({ data:{ actorId: admin.user.id, action: "FRESHNESS_POLICY_UPDATE", resourceType: "FreshnessPolicy", resourceId: policy.id, newState: JSON.stringify({ stale, recent }) } });
  return NextResponse.json({ policy }, noStore);
}
