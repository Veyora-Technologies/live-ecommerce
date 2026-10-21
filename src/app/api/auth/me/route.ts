import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
export async function GET(){
  const user = await getCurrentUser();
  const headers = { "Cache-Control": "private, no-store" };
  if(!user) return NextResponse.json({user:null}, { headers });
  const { prisma } = await import("@/lib/db");
  const full = await prisma.user.findUnique({ where:{ id: user.id }, select:{ email: true, phone: true, mfaEnabled: true, adminRole: true, marketingConsent: true } });
  if (!full) return NextResponse.json({ user: null }, { headers });
  return NextResponse.json({user:{id:user.id, name:user.name, email:full.email, phone:full.phone, role:user.role, isAdmin:user.isAdmin, mfaEnabled: !!full.mfaEnabled, adminRole: full.adminRole || "NONE", marketingConsent: !!full.marketingConsent }}, { headers });
}
