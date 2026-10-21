import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { merchantInsights } from "@/lib/insights";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const url=new URL(req.url);
  const merchantId=url.searchParams.get("merchantId");
  if(!merchantId) return NextResponse.json({error:"merchantId required"},{status:400});
  const isOwner=await prisma.merchant.findFirst({ where:{ id:merchantId, ownerId:user.id }});
  const mem=await prisma.merchantMembership.findFirst({ where:{ merchantId, userId:user.id }});
  if(!isOwner && !mem && !user.isAdmin) return NextResponse.json({error:"Forbidden"},{status:403});
  const insights=await merchantInsights(merchantId);
  // add trends (last 7 days reservation counts)
  const reservations=await prisma.reservation.findMany({ where:{ merchantId }});
  const byDay:any={};
  for(const r of reservations){
    const day=r.createdAt.toISOString().slice(0,10);
    byDay[day]=(byDay[day]||0)+1;
  }
  return NextResponse.json({ insights, trends: byDay });
}
