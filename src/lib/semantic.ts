import { prisma } from "./db";
import { parseMajorAmountToMinor } from "./money";

// Simple semantic matching without vectors: alias map + trigram-like fuzzy
const PRODUCT_ALIASES: Record<string,string[]> = {
  "Paracetamol 500mg (Emzor) x20": ["paracetamol","acetaminophen","panadol","fever drug","pain killer"],
  "Vitamin C 1000mg x30": ["vitamin c","ascorbic acid","immune booster","supplement"],
  "Dettol Antiseptic 500ml": ["dettol","antiseptic","disinfectant","germicide"],
  "Peak Milk Powder 400g": ["peak milk","milk powder","full cream milk","dano alternative"],
  "Golden Penny Rice 5kg": ["rice","golden penny","basmati","jollof rice","parboiled"],
  "Indomie Noodles 120g x5": ["indomie","noodles","instant noodles","spaghetti"],
};

export function fuzzyScore(a:string,b:string): number {
  a=a.toLowerCase(); b=b.toLowerCase();
  if(a===b) return 1;
  if(a.includes(b) || b.includes(a)) return 0.9;
  // simple token overlap
  const ta = new Set(a.split(/\s+/));
  const tb = new Set(b.split(/\s+/));
  let overlap=0;
  for(const t of ta) if(tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

export async function semanticSearch(query: string, filters:any={}){
  // get all products with basic filter
  const where:any={ archived:false, merchant:{ status:"APPROVED" } };
  if(filters.category) where.category=filters.category;
  if(filters.inStock) where.availability={ in:["IN_STOCK","LOW_STOCK"]};
  // we will fetch all then rank by fuzzy + alias
  const products = await prisma.product.findMany({ where, include:{ merchant:true, branch:{ include:{ state:true, lga:true, cityArea:true } } }, take: 100 });

  // if no query, return as is
  if(!query) return products;

  // score each
  const scored = products.map(p=>{
    let score = fuzzyScore(p.name, query);
    // check aliases
    const aliases = PRODUCT_ALIASES[p.name] || [];
    for(const alias of aliases){
      const s = fuzzyScore(alias, query);
      if(s>score) score=s;
    }
    // brand/category boost
    if(p.brand && query.toLowerCase().includes(p.brand.toLowerCase())) score+=0.1;
    if(p.category && query.toLowerCase().includes(p.category.toLowerCase())) score+=0.05;
    return { ...p, _score: Math.min(1,score) };
  }).filter(p=> (p as any)._score > 0.2);

  scored.sort((a,b)=> (b as any)._score - (a as any)._score);
  return scored;
}

export function explainResult(product:any, parsed:any, distanceKm?: number){
  const reasons:string[]=[];
  const availability=product.effectiveAvailability || product.availability;
  if(availability==="IN_STOCK") reasons.push("In stock reported");
  else if(availability==="LOW_STOCK") reasons.push("Low stock reported");
  if(product.merchant.verificationStatus==="VERIFIED") reasons.push("Verified merchant");
  if(product.merchant.storeStatus==="OPEN") reasons.push("Merchant marked open");
  if(distanceKm!==undefined && distanceKm!==null) reasons.push(`${distanceKm.toFixed(1)} km straight-line from supplied coordinates`);
  if(product.lastConfirmedAt){
    const hrs=(Date.now()-new Date(product.lastConfirmedAt).getTime())/3600000;
    if(hrs<6) reasons.push("Recently confirmed");
    else if(hrs<24) reasons.push("Confirmed today");
  }
  if (parsed?.maxPrice !== undefined) {
    const maximumMinor = parseMajorAmountToMinor(String(parsed.maxPrice), 2);
    if (maximumMinor !== null && BigInt(product.price) <= maximumMinor) reasons.push("Within budget");
  }
  return reasons.slice(0,3).join(" • ");
}
