import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getLegalReleaseGate, requirePolicyAcceptances } from "@/lib/legal";
import { publicMarketplaceProductIds } from "@/lib/marketplace";
import { withReservableAvailability } from "@/lib/inventory-availability";

const itemRequestSchema = z.object({
  productName: z.string().trim().min(2).max(120),
  category: z.string().trim().max(80).optional().nullable(),
  brand: z.string().trim().max(100).optional().nullable(),
  specs: z.string().trim().max(1000).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(99).optional(),
  area: z.string().trim().max(120).optional().nullable(),
  maxBudget: z.coerce.number().int().min(0).max(1_000_000_000).optional().nullable(),
  neededBy: z.preprocess((value) => value === "" || value === null || value === undefined ? undefined : value, z.coerce.date().optional()),
  contactPref: z.literal("IN_APP").optional(),
}).strict();

export async function GET(req: NextRequest){
  const user=await getCurrentUser();
  const url=new URL(req.url);
  const mine=url.searchParams.get("mine")==="true";
  if(mine){
    if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
    const requests=await prisma.itemRequest.findMany({ where:{ requesterId: user.id }, orderBy:{ createdAt:"desc"}, include:{ responses:true }});
    return NextResponse.json({ requests },{headers:{"Cache-Control":"private, no-store"}});
  }
  // Merchant view is private to approved merchant team members and restricted to their actual areas.
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401,headers:{"Cache-Control":"private, no-store"}});
  const area=(url.searchParams.get("area")||"").trim();
  const category=url.searchParams.get("category");
  const authorizedMerchants=await prisma.merchant.findMany({
    where:{status:"APPROVED",OR:[{ownerId:user.id},{memberships:{some:{userId:user.id,status:"ACTIVE"}}}]},
    select:{id:true,area:true},
  });
  const authorizedAreas=[...new Set(authorizedMerchants.map((merchant)=>merchant.area).filter(Boolean))];
  if(!authorizedAreas.length) return NextResponse.json({error:"Approved merchant access is required to view item requests."},{status:403,headers:{"Cache-Control":"private, no-store"}});
  if(area&&!authorizedAreas.includes(area)) return NextResponse.json({error:"Item requests are available only for areas served by your approved merchant profiles."},{status:403,headers:{"Cache-Control":"private, no-store"}});
  const where:any={status:"OPEN",area:area||{in:authorizedAreas}};
  if(category) where.category=category;
  const requests=await prisma.itemRequest.findMany({ where, orderBy:{ createdAt:"desc"}, take:20 });
  // privacy: don't expose phone; only show productName, area, quantity
  const anonymized=requests.map(r=>({
    id:r.id,
    productName:r.productName,
    category:r.category,
    brand:r.brand,
    quantity:r.quantity,
    area:r.area,
    maxBudget:r.maxBudget,
    neededBy:r.neededBy,
    status:r.status,
    createdAt:r.createdAt,
  }));
  return NextResponse.json({ requests: anonymized },{headers:{"Cache-Control":"private, no-store"}});
}

export async function POST(req: NextRequest){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const gate=await getLegalReleaseGate("MARKETPLACE");
  if(!gate.ready) return NextResponse.json({error:gate.publicMessage,code:"LEGAL_RELEASE_GATE",policyUrl:"/legal"},{status:503,headers:{"Cache-Control":"no-store"}});
  const policyCheck=await requirePolicyAcceptances({userId:user.id,keys:["PLATFORM_TERMS","PRIVACY_NOTICE","CONSUMER_TERMS"]});
  if(!policyCheck.allowed) return NextResponse.json({error:policyCheck.message||"Review Furnivo policies before creating an item request.",code:policyCheck.code,missingPolicies:policyCheck.missing,policyUrl:"/legal"},{status:policyCheck.code==="LEGAL_RELEASE_GATE"?503:428});
  const parsed=itemRequestSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:parsed.error.issues[0]?.message||"Valid item request details are required."},{status:400});
  const {productName,category,brand,specs,quantity,area,maxBudget,neededBy}=parsed.data;

  // Search existing listings first to avoid unnecessary request (as per spec)
  const existingCandidates=await prisma.product.findMany({
    where:{
      archived:false,
      merchant:{status:"APPROVED"},
      name:{ contains: productName },
      ...(area? { merchant:{ area, status:"APPROVED" }}: {}),
      ...(maxBudget !== undefined && maxBudget !== null ? { price:{ lte: maxBudget }} : {}),
      availability:{ in:["IN_STOCK","LOW_STOCK"]},
    },
    include:{ merchant:true },
    take:100,
  });
  const eligibleExistingIds=await publicMarketplaceProductIds(existingCandidates.map((product)=>product.id));
  const existingWithAvailability=await withReservableAvailability(existingCandidates.filter((product)=>eligibleExistingIds.has(product.id)));
  const existing=existingWithAvailability.filter((product)=>product.reservableQuantity>0).slice(0,5);
  if(existing.length>0){
    return NextResponse.json({
      error:"Matches already available",
      matches: existing.map(p=>({ id:p.id, name:p.name, price:p.price, merchant:p.merchant.businessName, area:p.merchant.area })),
      hint:"Furnivo listings match this request. Check each merchant's location, terms, and current stock before travelling."
    },{status:409});
  }

  const reqst=await prisma.itemRequest.create({
    data:{
      requesterId:user.id,
      productName, category:category||null, brand:brand||null, specs:specs||null,
      quantity:quantity??1,
      area:area||user.preferredArea||null,
      maxBudget:maxBudget??null,
      neededBy:neededBy??null,
      contactPref:"IN_APP",
      status:"OPEN",
    }
  });

  // Notify merchants in area (create notifications for merchant owners matching area)
  const merchants = reqst.area ? await prisma.merchant.findMany({ where: { area: reqst.area, status: "APPROVED" }, take: 10 }) : [];
  for (const m of merchants) {
    await prisma.notification.create({
      data: {
        recipientId: m.ownerId,
        type: "REQUEST_AN_ITEM",
        title: "New item request",
        body: `A request recorded for ${reqst.area} is for ${reqst.productName} ×${reqst.quantity}`,
        resourceType:"ItemRequest",
        resourceId:reqst.id,
      }
    });
  }

  return NextResponse.json({ request: reqst });
}
