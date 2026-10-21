import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(){
  const user = await getCurrentUser();
  if(!user?.isAdmin) return NextResponse.json({ error:"Forbidden" }, { status:403 });
  const flags = await prisma.featureFlag.findMany({ orderBy:{ key:"asc" }});
  return NextResponse.json({ flags });
}
export async function POST(req: NextRequest){
  const user = await getCurrentUser();
  if(!user?.isAdmin) return NextResponse.json({ error:"Forbidden" }, { status:403 });
  const { key, name, enabled, payload } = await req.json();
  if(!key || !name) return NextResponse.json({ error:"key and name required" }, { status:400 });
  const flag = await prisma.featureFlag.upsert({
    where:{ key }, update:{ name, enabled: !!enabled, payload: payload? JSON.stringify(payload): null },
    create:{ key, name, enabled: !!enabled, payload: payload? JSON.stringify(payload): null },
  });
  await prisma.auditLog.create({ data:{ actorId:user.id, action:"FEATURE_FLAG_UPDATE", resourceType:"FeatureFlag", resourceId:flag.id, metadata: JSON.stringify({ key, enabled: !!enabled }) }});
  return NextResponse.json({ flag });
}
