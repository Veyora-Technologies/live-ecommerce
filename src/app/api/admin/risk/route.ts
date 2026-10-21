import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const ADMIN_ROLES = ["SECURITY", "REVIEWER", "SUPER"];
async function requireAdminRole(roles: string[]) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return null;
  const full = await prisma.user.findUnique({ where:{ id: user.id }, select:{ adminRole: true } });
  return full && roles.includes(full.adminRole || "NONE") ? user : null;
}

/** Risk & security operations (§38): explainable signals, human decisions. */
export async function GET() {
  const user = await requireAdminRole(ADMIN_ROLES);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [riskEvents, securityEvents] = await Promise.all([
    prisma.riskEvent.findMany({ orderBy:{ createdAt: "desc" }, take: 50 }),
    prisma.securityEvent.findMany({ orderBy:{ createdAt: "desc" }, take: 50 }),
  ]);
  return NextResponse.json({ riskEvents, securityEvents, note: "Signals never auto-suspend customers. Every restriction needs a recorded human reason and an appeal path." });
}

export async function PATCH(req: NextRequest) {
  const user = await requireAdminRole(["SECURITY", "SUPER"]);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!b.decision) return NextResponse.json({ error: "decision and reason required" }, { status: 400 });
  const current = await prisma.riskEvent.findUnique({ where:{ id: b.id || "" } });
  if (!current) return NextResponse.json({ error: "Risk event not found" }, { status: 404 });
  const updated = await prisma.riskEvent.update({
    where:{ id: current.id },
    data:{ status: b.decision === "DISMISS" ? "DISMISSED" : "RESOLVED", assigneeId: user.id, reason: `${current.reason} | Decision by ${user.id}: ${b.decision} — ${String(b.reason || "").slice(0, 200)}` },
  });
  await prisma.auditLog.create({ data:{ actorId: user.id, action: "RISK_DECISION", resourceType: "RiskEvent", resourceId: updated.id, outcome: updated.status, metadata: "reviewed" } });
  return NextResponse.json({ riskEvent: updated });
}
