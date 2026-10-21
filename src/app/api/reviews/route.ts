import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPublicMarketplaceProduct } from "@/lib/marketplace";
import { z } from "zod";

const reviewSchema = z.object({
  merchantId: z.string().trim().min(1).max(64),
  productId: z.string().trim().min(1).max(64).optional().nullable(),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().max(2000).optional().nullable(),
}).strict();

export async function GET(req: NextRequest){
  const url=new URL(req.url);
  const merchantId=url.searchParams.get("merchantId");
  const productId=url.searchParams.get("productId");
  if(merchantId){
    const merchant=await prisma.merchant.findFirst({where:{id:merchantId,status:"APPROVED"},select:{id:true}});
    if(!merchant) return NextResponse.json({error:"Not found"},{status:404});
  }
  if(productId){
    const product=await prisma.product.findFirst({where:{id:productId,archived:false,...(merchantId?{merchantId}:{})},select:{id:true}});
    if(!product||!await isPublicMarketplaceProduct(productId)) return NextResponse.json({error:"Not found"},{status:404});
  }
  const where:any={ status:"VISIBLE"};
  if(merchantId) where.merchantId=merchantId;
  if(productId) where.productId=productId;
  const reviews=await prisma.review.findMany({ where, include:{ author:{ select:{ name:true } } }, orderBy:{ createdAt:"desc"}, take:50 });
  const avg= reviews.length ? (reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1) : null;
  return NextResponse.json({ reviews: reviews.map(r=>({
    id:r.id, rating:r.rating, text:r.text, verifiedPurchase:r.verifiedPurchase,
    author:{ name:r.author.name }, createdAt:r.createdAt
  })), average: avg, count: reviews.length });
}

export async function POST(req: NextRequest){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const parsed=reviewSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:"Provide an approved merchant, a rating from 1 to 5, and optional review text."},{status:400});
  const {merchantId,productId,rating,text}=parsed.data;
  const merchant=await prisma.merchant.findFirst({where:{id:merchantId,status:"APPROVED"},select:{id:true}});
  if(!merchant) return NextResponse.json({error:"Merchant not found"},{status:404});
  if(productId){
    const product=await prisma.product.findFirst({where:{id:productId,merchantId,archived:false},select:{id:true}});
    if(!product||!await isPublicMarketplaceProduct(productId)) return NextResponse.json({error:"Public product listing not found for this merchant"},{status:404});
  }
  // verify purchase: has collected reservation for this merchant/product
  let verified=false;
  if(productId){
    const r=await prisma.reservation.findFirst({ where:{ consumerId:user.id, productId, status:"COLLECTED"}});
    if(r) verified=true;
  } else {
    const r=await prisma.reservation.findFirst({ where:{ consumerId:user.id, merchantId, status:"COLLECTED"}});
    if(r) verified=true;
  }
  // spam check: one review per user per merchant per day
  const recent=await prisma.review.findFirst({ where:{ authorId:user.id, merchantId, createdAt:{ gte: new Date(Date.now()-24*60*60*1000)}}});
  if(recent) return NextResponse.json({error:"You already reviewed today"},{status:429});

  const review=await prisma.review.create({
    data:{ authorId:user.id, merchantId, productId, rating, text, verifiedPurchase: verified },
    select:{ id:true, rating:true, text:true, verifiedPurchase:true, createdAt:true, author:{ select:{ name:true } } },
  });
  return NextResponse.json({ review });
}
