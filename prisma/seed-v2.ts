/**
 * Live 2.0 additive seed — SAMPLE DATA, clearly labelled.
 * Run AFTER the base seed: `npm run db:seed:v2`
 * Idempotent-ish: skips creation when markers already exist.
 * Adds: organisations/branches, barcodes + identifiers, price history
 * (recorded as observations around today's price — labelled sample),
 * services, reviews (from real seeded users), demand aggregates,
 * feature flags, one item-request demo and one shared-list demo.
 */
import { PrismaClient } from "@prisma/client";
import { assertDemoSeedAllowed } from "./seed-safety";
const prisma = new PrismaClient();

const BARCODES: Record<string,string> = {
  "Paracetamol 500mg (Emzor) x20": "6034001002003",
  "Peak Milk Powder 400g": "6034001002010",
  "Golden Penny Rice 5kg": "6034001002027",
  "Indomie Noodles 120g x5": "6034001002034",
  "Dettol Antiseptic 500ml": "6034001002041",
  "Vitamin C 1000mg x30": "6034001002058",
};

async function main(){
  assertDemoSeedAllowed("Live 2.0 additive sample seed");
  console.log("Seeding Live 2.0 sample data…");
  const merchants = await prisma.merchant.findMany({ take: 6 });
  const amina = await prisma.user.findUnique({ where:{ email:"amina@example.com" }});
  const emeka = await prisma.user.findUnique({ where:{ email:"emeka@example.com" }});
  if(!merchants.length){ console.log("Run base seed first."); return; }

  // Organisations + branches for first two merchants
  for(let i=0;i<Math.min(2,merchants.length);i++){
    const m=merchants[i];
    let org=await prisma.organization.findFirst({ where:{ ownerId:m.ownerId, name:{ contains:"Group" }}});
    if(!org){
      org=await prisma.organization.create({ data:{ ownerId:m.ownerId, name:`${m.businessName} Group`, description:"Sample multi-branch organisation (demo)." }});
      await prisma.orgMembership.create({ data:{ organizationId:org.id, userId:m.ownerId, role:"OWNER" }});
      await prisma.merchant.update({ where:{ id:m.id }, data:{ organizationId:org.id }});
    }
    const existing=await prisma.branch.findFirst({ where:{ merchantId:m.id, name:{ contains:"Branch" }}});
    if(!existing){
      await prisma.branch.create({ data:{ merchantId:m.id, organizationId:org.id, name:`${m.businessName} — Jabi Branch`, address:"Jabi Lake Mall area, Jabi", area:"Jabi", city:"Abuja", lat:9.076, lng:7.425, phone:m.phone, storeStatus:"OPEN" }});
    }
    const sub=await prisma.merchantSubscription.findFirst({ where:{ merchantId:m.id, status:"ACTIVE" }});
    if(!sub) await prisma.merchantSubscription.create({ data:{ merchantId:m.id, organizationId:org.id, plan: i===0?"PRO":"FREE", status:"ACTIVE" }});
  }

  // Barcodes, identifiers, price observations (3 points, labelled SAMPLE_HISTORY)
  const products=await prisma.product.findMany({ take:60 });
  for(const p of products){
    const code=BARCODES[p.name];
    if(code && !p.barcode){
      await prisma.product.update({ where:{ id:p.id }, data:{ barcode:code, sku: p.sku || code.slice(-6) }});
      await prisma.productIdentifier.create({ data:{ productId:p.id, type:"BARCODE", value:code }}).catch(()=>{});
    }
    const obs=await prisma.priceObservation.count({ where:{ productId:p.id }});
    if(obs<2){
      const variants=[Math.round(p.price*0.95), Math.round(p.price*0.98), p.price];
      for(let j=0;j<variants.length;j++){
        await prisma.priceObservation.create({ data:{ merchantId:p.merchantId, productId:p.id, price:variants[j], source:"SAMPLE_HISTORY", observedAt:new Date(Date.now()-(3-j)*14*24*3600000) }});
      }
    }
  }

  // Services on two merchants (mechanic + salon style offerings via existing stores, labelled demo)
  const serviceDefs=[
    { name:"Pharmacist consultation", description:"15-min medication review with the pharmacist. Not a substitute for medical care.", price:300000, durationMin:15 },
    { name:"Blood-pressure check", description:"In-store BP measurement and record card.", price:100000, durationMin:10 },
    { name:"Bulk order collection slot", description:"Pre-packed bulk pickup at a set time.", price:0, durationMin:20 },
  ];
  for(const m of merchants.slice(0,2)){
    for(const s of serviceDefs){
      const exists=await prisma.service.findFirst({ where:{ merchantId:m.id, name:s.name }});
      if(!exists) await prisma.service.create({ data:{ merchantId:m.id, name:s.name, description:s.description, price:s.price||null, durationMin:s.durationMin, capacity:1 }});
    }
  }

  // Reviews (genuine-looking sample text by seeded consumers; verified=false unless collected)
  if(amina){
    for(const m of merchants.slice(0,3)){
      const exists=await prisma.review.findFirst({ where:{ authorId:amina.id, merchantId:m.id }});
      if(!exists) await prisma.review.create({ data:{ authorId:amina.id, merchantId:m.id, rating:5, text:"Listed stock was actually there and price matched. Reserved and collected quickly.", verifiedPurchase:false }});
    }
  }
  if(emeka){
    const exists=await prisma.review.findFirst({ where:{ authorId:emeka.id, merchantId:merchants[0].id }});
    if(!exists) await prisma.review.create({ data:{ authorId:emeka.id, merchantId:merchants[0].id, rating:4, text:"Good, though the low-stock item sold out before I arrived the first time.", verifiedPurchase:false }});
  }

  // Demand aggregates (sample signal, counts >=3 so privacy threshold demos work)
  const demand:[string,string,number][]=[["baby formula","Wuse",14],["blood pressure machine","Garki",9],["iphone charger","Wuse",11],["brown rice","Maitama",7],["vitamin d","Gwarimpa",5]];
  for(const [q,area,count] of demand){
    const ex=await prisma.demandAggregate.findFirst({ where:{ normalizedQuery:q, area }});
    if(!ex) await prisma.demandAggregate.create({ data:{ query:q, normalizedQuery:q, area, count }});
  }

  // Feature flags
  const flags:[string,string,boolean][]=[["assist_enabled","Live Assist",true],["image_search_enabled","Camera search",true],["sponsored_discovery","Sponsored discovery (labelled)",false],["services_enabled","Service bookings",true]];
  for(const [key,name,enabled] of flags) await prisma.featureFlag.upsert({ where:{ key }, update:{ name }, create:{ key, name, enabled }});

  // Demo item request + shared list (clearly sample)
  if(amina){
    const req=await prisma.itemRequest.findFirst({ where:{ requesterId:amina.id, productName:{ contains:"Baby formula" }}});
    if(!req) await prisma.itemRequest.create({ data:{ requesterId:amina.id, productName:"Baby formula (0–6 months) 400g", category:"Grocery", quantity:2, area:"Wuse", maxBudget:1500000, status:"OPEN" }});
    const list=await prisma.shoppingList.findFirst({ where:{ ownerId:amina.id, name:"Family weekly shop (sample)" }});
    if(!list){
      const l=await prisma.shoppingList.create({ data:{ ownerId:amina.id, name:"Family weekly shop (sample)", description:"Shared demo list", isShared:true, inviteToken:"DEMO1234", spendingLimit:3000000 }});
      await prisma.shoppingListMember.create({ data:{ listId:l.id, userId:amina.id, role:"OWNER" }});
      if(emeka) await prisma.shoppingListMember.create({ data:{ listId:l.id, userId:emeka.id, role:"MEMBER" }}).catch(()=>{});
      const rice=await prisma.product.findFirst({ where:{ name:{ contains:"Rice" }}});
      if(rice) await prisma.shoppingListItem.create({ data:{ listId:l.id, productId:rice.id, quantity:1 }});
      await prisma.shoppingListItem.create({ data:{ listId:l.id, customName:"Fresh tomatoes 1kg", quantity:2 }});
    }
    const prefs=await prisma.notificationPreference.findUnique({ where:{ userId:amina.id }});
    if(!prefs) await prisma.notificationPreference.create({ data:{ userId:amina.id }});
  }

  console.log("Live 2.0 sample seed complete.");
}
main().catch(e=>{ console.error(e); process.exit(1); }).finally(async()=>{ await prisma.$disconnect(); });
