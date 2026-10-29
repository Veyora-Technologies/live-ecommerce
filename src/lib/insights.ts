import { prisma } from "./db";
import { stockoutRisk } from "./confidence";

/**
 * Furnivo Insights — real records only.
 * Listing views / search appearances are NOT tracked yet, so they are
 * reported as null ("not tracked") instead of invented numbers.
 * Demand is aggregated and small groups (<3) are suppressed for privacy.
 */
export async function merchantInsights(merchantId: string){
  const [products, reservations, movements, reviews] = await Promise.all([
    prisma.product.findMany({ where:{ merchantId } }),
    prisma.reservation.findMany({ where:{ merchantId }, include:{ product:true }, orderBy:{ createdAt:"desc" } }),
    prisma.inventoryMovement.findMany({ where:{ merchantId }, orderBy:{ createdAt:"desc" }, take:50 }),
    prisma.review.findMany({ where:{ merchantId, status:"VISIBLE" }, take:100 }),
  ]);

  const totalReservations = reservations.length;
  const byStatus = (s:string[]) => reservations.filter(r=> s.includes(r.status)).length;
  const pending = byStatus(["PENDING"]);
  const confirmed = byStatus(["CONFIRMED","READY_FOR_PICKUP"]);
  const collected = byStatus(["COLLECTED"]);
  const cancelled = byStatus(["CANCELLED","REJECTED","EXPIRED"]);
  const confirmationRate = totalReservations ? Math.round((byStatus(["CONFIRMED","READY_FOR_PICKUP","COLLECTED"])/totalReservations)*100) : null;
  const fulfilmentRate = totalReservations ? Math.round((collected/totalReservations)*100) : null;
  const cancellationRate = totalReservations ? Math.round((cancelled/totalReservations)*100) : null;
  const revenueCollectedKobo = reservations.filter(r=>r.status==="COLLECTED").reduce((s,r)=>s+r.totalAmount,0);

  const lowStock = products.filter(p=> p.stockQuantity>0 && p.stockQuantity <= p.lowStockThreshold);
  const outOfStock = products.filter(p=> p.availability==="OUT_OF_STOCK" || p.stockQuantity<=0);
  const stale = products.filter(p=>{
    const ref = p.lastConfirmedAt ? new Date(p.lastConfirmedAt).getTime() : new Date(p.updatedAt).getTime();
    return Date.now()-ref > 24*3600000;
  });

  // Per-product reservation pace (last 30d) → advisory stockout risk
  const since = new Date(Date.now()-30*24*3600000);
  const recentByProduct = new Map<string,number>();
  for(const r of reservations) if(r.createdAt>=since) recentByProduct.set(r.productId,(recentByProduct.get(r.productId)||0)+1);
  const recommendations = products.slice(0,50).map(p=>{
    const risk = stockoutRisk({ stockQuantity:p.stockQuantity, lowStockThreshold:p.lowStockThreshold, reservationsLast7d: Math.round((recentByProduct.get(p.id)||0)*(7/30)) });
    return { productId:p.id, name:p.name, stock:p.stockQuantity, risk: risk.level, note: risk.note };
  }).filter(r=> r.risk!=="LOW");

  // Unmet demand: aggregated searches (min group 3) that don't match this merchant's catalogue
  const catalogue = products.map(p=>p.name.toLowerCase());
  const demandRaw = await prisma.demandAggregate.findMany({ where:{ count:{ gte:3 } }, orderBy:{ count:"desc" }, take:30 });
  const unmetDemand = demandRaw.filter(d=> !catalogue.some(name=> name.includes(d.normalizedQuery) || d.normalizedQuery.includes(name.split(" ")[0]||"§"))).slice(0,10);

  // Top products by real reservations
  const topMap = new Map<string,{name:string;count:number}>();
  for(const r of reservations){ const cur=topMap.get(r.productId)||{name:r.product.name,count:0}; cur.count++; topMap.set(r.productId,cur); }
  const topProducts = [...topMap.values()].sort((a,b)=>b.count-a.count).slice(0,8);

  return {
    overview: {
      totalProducts: products.length,
      totalReservations, pending, confirmed, collected, cancelled,
      confirmationRate, fulfilmentRate, cancellationRate,
      revenueCollectedKobo,
      views: null, searchAppearances: null, conversion: null,
      note: "Views/search appearances are not tracked yet, so no conversion figure is shown. All counts above come from stored reservations and products.",
      averageRating: reviews.length? Number((reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1)) : null,
      reviewCount: reviews.length,
    },
    stock: { lowStock, outOfStock, stale },
    recommendations,
    unmetDemand,
    topProducts,
    movements: movements.slice(0,20),
  };
}

export async function recordSearchDemand(query:string, category?:string, area?:string){
  if(!query || query.length<2) return;
  const normalized = query.toLowerCase().trim().slice(0,120);
  const existing = await prisma.demandAggregate.findFirst({ where:{ normalizedQuery: normalized, area: area || null }});
  if(existing){
    await prisma.demandAggregate.update({ where:{ id:existing.id }, data:{ count:{ increment:1 }, lastSeen: new Date() }});
  } else {
    await prisma.demandAggregate.create({ data:{ query: normalized, normalizedQuery: normalized, category: category||null, area: area||null, count:1 }});
  }
}
