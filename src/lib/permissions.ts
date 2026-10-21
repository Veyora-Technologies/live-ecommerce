import { prisma } from "./db";

export const MERCHANT_ROLES = ["OWNER","MANAGER","INVENTORY_STAFF","RESERVATION_STAFF","READ_ONLY"] as const;
export type MerchantRole = typeof MERCHANT_ROLES[number];

/** Resolve the caller's role for a merchant. Owners are always OWNER. Returns null if no access. */
export async function merchantRole(merchantId: string, userId: string): Promise<MerchantRole | null> {
  const merchant = await prisma.merchant.findUnique({ where:{ id: merchantId }, select:{ ownerId:true } });
  if(!merchant) return null;
  if(merchant.ownerId === userId) return "OWNER";
  const mem = await prisma.merchantMembership.findFirst({ where:{ merchantId, userId, status:"ACTIVE" } });
  if(!mem) return null;
  return (MERCHANT_ROLES as readonly string[]).includes(mem.role) ? (mem.role as MerchantRole) : "READ_ONLY";
}

export function canEditInventory(role: MerchantRole | null){ return role==="OWNER"||role==="MANAGER"||role==="INVENTORY_STAFF"; }
export function canManageReservations(role: MerchantRole | null){ return role==="OWNER"||role==="MANAGER"||role==="RESERVATION_STAFF"; }
export function canViewReports(role: MerchantRole | null){ return role!==null; } // any active member incl. read-only
export function canManageTeam(role: MerchantRole | null){ return role==="OWNER"||role==="MANAGER"; }
export function canCustomize(role: MerchantRole | null){ return role==="OWNER"||role==="MANAGER"; }
