import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canEditInventory, merchantRole } from "@/lib/permissions";
import { isPublicMarketplaceProduct } from "@/lib/marketplace";
import { DEFAULT_MARKET_CODE, isMarketIntegrationReady } from "@/lib/market-config";

const optionalInteger = (maximum: number) => z.preprocess(
  (value) => value === "" || value === null || value === undefined ? undefined : value,
  z.coerce.number().int().min(0).max(maximum).optional(),
);
const responseSchema = z.object({
  merchantId: z.string().trim().min(1).max(64),
  productId: z.string().trim().min(1).max(64).nullable().optional(),
  branchId: z.string().trim().min(1).max(64).nullable().optional(),
  message: z.string().trim().min(1).max(1000),
  price: optionalInteger(1_000_000_000),
  quantityAvailable: optionalInteger(1_000_000),
  validUntil: z.preprocess((value) => value === "" || value === null || value === undefined ? undefined : value, z.coerce.date().optional()),
  fulfilment: z.enum(["PICKUP", "DELIVERY"]).optional(),
  additionalFees: optionalInteger(1_000_000_000),
}).strict();

export async function GET(_:NextRequest, {params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401,headers:{"Cache-Control":"private, no-store"}});
  const {id}=await params;
  const request=await prisma.itemRequest.findUnique({where:{id},select:{id:true,requesterId:true}});
  if(!request) return NextResponse.json({error:"Request not found"},{status:404,headers:{"Cache-Control":"private, no-store"}});
  if(request.requesterId===user.id){
    const responses=await prisma.itemRequestResponse.findMany({where:{requestId:id},orderBy:{createdAt:"desc"}});
    return NextResponse.json({responses},{headers:{"Cache-Control":"private, no-store"}});
  }
  const responses=await prisma.itemRequestResponse.findMany({where:{requestId:id},orderBy:{createdAt:"desc"}});
  const responseMerchantIds=[...new Set(responses.map((response)=>response.merchantId))];
  const accessibleMerchants=await prisma.merchant.findMany({
    where:{id:{in:responseMerchantIds},status:"APPROVED",OR:[{ownerId:user.id},{memberships:{some:{userId:user.id,status:"ACTIVE"}}}]},
    select:{id:true},
  });
  const allowedMerchantIds=new Set(accessibleMerchants.map((merchant)=>merchant.id));
  const ownResponses=responses.filter((response)=>allowedMerchantIds.has(response.merchantId));
  if(!ownResponses.length) return NextResponse.json({error:"Request not found or access is not permitted."},{status:404,headers:{"Cache-Control":"private, no-store"}});
  return NextResponse.json({responses:ownResponses},{headers:{"Cache-Control":"private, no-store"}});
}

export async function POST(req:NextRequest, {params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const {id}=await params;
  const parsed=responseSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:"Provide a merchant, a response message, and valid optional quote details."},{status:400});
  const { merchantId, productId, message, price, branchId, quantityAvailable, validUntil, fulfilment, additionalFees }=parsed.data;
  if (fulfilment === "DELIVERY" && !isMarketIntegrationReady(DEFAULT_MARKET_CODE, "deliveryIntegrations")) {
    return NextResponse.json({ error: "Delivery quotes are unavailable because Furnivo has no configured delivery integration.", code: "FEATURE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const role=await merchantRole(merchantId,user.id);
  if(!canEditInventory(role)) return NextResponse.json({error:"Forbidden"},{status:403});
  const [merchant,request]=await Promise.all([
    prisma.merchant.findFirst({where:{id:merchantId,status:"APPROVED"},select:{id:true,ownerId:true}}),
    prisma.itemRequest.findUnique({where:{id},select:{id:true,requesterId:true,status:true}}),
  ]);
  if(!merchant) return NextResponse.json({error:"Approved merchant not found"},{status:404});
  if(!request) return NextResponse.json({error:"Item request not found"},{status:404});
  if(!["OPEN","RESPONDED"].includes(request.status)) return NextResponse.json({error:"This item request is no longer open for responses."},{status:409});
  if(typeof message!=="string"||message.trim().length<1||message.length>1000) return NextResponse.json({error:"Response message must be 1–1,000 characters."},{status:400});
  if(productId){
    const product=await prisma.product.findFirst({where:{id:productId,merchantId,archived:false},select:{id:true}});
    if(!product||!await isPublicMarketplaceProduct(productId)) return NextResponse.json({error:"Choose one of this merchant’s currently public listings."},{status:404});
  }
  if(branchId){
    const branch=await prisma.branch.findFirst({where:{id:branchId,merchantId},select:{id:true}});
    if(!branch) return NextResponse.json({error:"Branch does not belong to this merchant."},{status:400});
  }
  // All quote figures remain seller-reported. Clients cannot mark a response independently confirmed.
  let resp;
  try {
    resp=await prisma.$transaction(async(tx)=>{
      const claimed=await tx.itemRequest.updateMany({where:{id,status:{in:["OPEN","RESPONDED"]}},data:{status:"RESPONDED"}});
      if(!claimed.count) throw new Error("ITEM_REQUEST_CLOSED");
      const response=await tx.itemRequestResponse.create({data:{requestId:id,merchantId,productId:productId||null,branchId:branchId||null,message:message.trim(),price:price??null,quantityAvailable:quantityAvailable??null,validUntil:validUntil??null,fulfilment:fulfilment||"PICKUP",additionalFees:additionalFees??0,confirmationState:"MERCHANT_REPORTED",status:"OPEN"}});
      await tx.notification.create({data:{recipientId:request.requesterId,type:"ITEM_REQUEST_RESPONSE",title:"Merchant responded to your request",body:message.trim().slice(0,500),resourceType:"ItemRequest",resourceId:id}});
      return response;
    });
  } catch(cause) {
    if(cause instanceof Error&&cause.message==="ITEM_REQUEST_CLOSED") return NextResponse.json({error:"This item request is no longer open for responses."},{status:409});
    return NextResponse.json({error:"The response could not be saved."},{status:500});
  }

  return NextResponse.json({ response: resp },{headers:{"Cache-Control":"private, no-store"}});
}
