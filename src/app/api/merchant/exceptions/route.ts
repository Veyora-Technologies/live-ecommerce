import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole, canEditInventory } from "@/lib/permissions";

/** Temporary operating exceptions (§30): holidays, closures, special hours. Dates are YYYY-MM-DD in branch timezone. */
export async function GET(req: NextRequest) {
  const merchantId = new URL(req.url).searchParams.get("merchantId") || "";
  const exceptions = await prisma.operatingException.findMany({ where:{ merchantId }, orderBy:{ date: "asc" }, take: 50 });
  return NextResponse.json({ exceptions });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const role = await merchantRole(b.merchantId || "", user.id);
  if (!canEditInventory(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const date = String(b.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date required as YYYY-MM-DD" }, { status: 400 });
  const type = b.closed ? "CLOSED" : (b.type === "SPECIAL_HOURS" ? "SPECIAL_HOURS" : (b.hours ? "SPECIAL_HOURS" : "CLOSED"));
  const hours = b.hours || (b.openTime && b.closeTime ? `${b.openTime}-${b.closeTime}` : null);
  const exception = await prisma.operatingException.create({
    data:{ merchantId: b.merchantId, branchId: b.branchId || null, date, type, hours, note: b.reason ? String(b.reason).slice(0, 200) : (b.note ? String(b.note).slice(0, 200) : null) },
  });
  return NextResponse.json({ exception }, { status: 201 });
}
