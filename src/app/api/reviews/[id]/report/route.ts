import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { z } from "zod";

export async function POST(req: NextRequest, { params }: { params: Promise<{id:string}> }){
  const { id } = await params;
  const user = await getCurrentUser();
  if(!user) return NextResponse.json({ error:"Unauthorized" }, { status:401 });
  const parsed=z.object({reason:z.string().trim().min(3).max(500)}).strict().safeParse(await req.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:"Provide a reason of 3–500 characters."},{status:400});
  const review=await prisma.review.findUnique({where:{id},select:{id:true,status:true}});
  if(!review) return NextResponse.json({error:"Review not found"},{status:404});
  const existing=await prisma.reviewReport.findFirst({where:{reviewId:id,reporterId:user.id},select:{id:true}});
  if(existing) return NextResponse.json({reported:true,duplicate:true,note:"Your report is already recorded for human review."},{headers:{"Cache-Control":"private, no-store"}});
  const report=await prisma.reviewReport.create({data:{reviewId:id,reporterId:user.id,reason:parsed.data.reason,status:"OPEN"}});
  return NextResponse.json({report:{id:report.id,status:report.status},note:"Reported for human review. This report did not hide the review or establish misconduct."},{headers:{"Cache-Control":"private, no-store"}});
}
