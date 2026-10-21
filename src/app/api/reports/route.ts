import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req:NextRequest){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const { merchantId, productId, category, description } = await req.json();
  if(!merchantId || !category) return NextResponse.json({error:"Missing fields"},{status:400});
  const report=await prisma.report.create({ data:{ reporterId:user.id, merchantId, productId, category, description:description||"" }});
  return NextResponse.json({ report });
}
export async function GET(){
  const user=await getCurrentUser();
  if(!user || !user.isAdmin) return NextResponse.json({error:"Forbidden"},{status:403});
  const reports=await prisma.report.findMany({ orderBy:{createdAt:"desc"}, include:{ reporter:{ select:{ id:true, name:true } }, merchant:{ select:{ id:true, businessName:true } } }});
  return NextResponse.json({ reports });
}
