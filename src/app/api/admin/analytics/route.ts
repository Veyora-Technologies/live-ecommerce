import { NextResponse } from "next/server";
import { PLATFORM_ANALYTICS_ROLES, requireAdminRole } from "@/lib/admin-access";
import { prisma } from "@/lib/db";

export async function GET(){
  const admin=await requireAdminRole(PLATFORM_ANALYTICS_ROLES);
  if(!admin) return NextResponse.json({error:"Forbidden"},{status:403});
  const totalUsers=await prisma.user.count();
  const totalMerchants=await prisma.merchant.count();
  const pendingMerchants=await prisma.merchant.count({ where:{ status:"PENDING"}});
  const totalProducts=await prisma.product.count();
  const totalReservations=await prisma.reservation.count();
  const reservationsByStatus=await prisma.reservation.groupBy({ by:["status"], _count:true });
  const demand=await prisma.demandAggregate.findMany({ orderBy:{ count:"desc"}, take:10 });
  const freshness=await prisma.product.findMany({ where:{ archived:false }});
  const stale=freshness.filter(p=>{
    const ref=p.lastConfirmedAt? new Date(p.lastConfirmedAt).getTime(): new Date(p.updatedAt).getTime();
    return Date.now()-ref > 24*3600000;
  }).length;
  const failedJobs=await prisma.backgroundJob.count({ where:{ status:"FAILED"}});
  const webhookFailures=await prisma.webhookDelivery.count({ where:{ status:"FAILED"}});
  return NextResponse.json({
    platform:{ totalUsers, totalMerchants, pendingMerchants, totalProducts, totalReservations, staleProducts: stale, staleRate: freshness.length? Math.round(stale/freshness.length*100):0 },
    reservationsByStatus,
    demand,
    ops:{ failedJobs, webhookFailures },
  });
}
