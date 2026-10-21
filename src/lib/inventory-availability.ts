import { prisma } from "@/lib/db";
import { availabilityFromStock } from "@/lib/confidence";

export type InventoryRow = {
  id: string;
  stockQuantity?: number;
  reservedQuantity?: number;
  lowStockThreshold?: number;
  availability?: string;
};

/**
 * Derive the quantity that can be newly reserved without exposing lot data.
 * Physical stock is reduced by recalled, quarantined, inactive, or expired
 * batches and by existing reservations. The product record remains the source
 * of truth; this helper only improves the public availability presentation.
 */
export async function withReservableAvailability<T extends InventoryRow>(products: T[]): Promise<Array<T & {
  reservableQuantity: number;
  effectiveAvailability: string;
}>> {
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const batches = await prisma.productBatch.findMany({
    where: { productId: { in: ids } },
    select: { productId: true, quantity: true, status: true, expiresAt: true },
  });
  const blocked = new Map<string, number>();
  const now = Date.now();
  for (const batch of batches) {
    if (batch.status !== "ACTIVE" || (batch.expiresAt && batch.expiresAt.getTime() < now)) {
      blocked.set(batch.productId, (blocked.get(batch.productId) || 0) + batch.quantity);
    }
  }
  return products.map((product) => {
    const blockedQuantity = blocked.get(product.id) || 0;
    const physical = Math.max(0, Number(product.stockQuantity || 0) - blockedQuantity);
    const available = Math.max(0, physical - Number(product.reservedQuantity || 0));
    const effectiveAvailability = available === 0
      ? (physical === 0 || product.availability === "OUT_OF_STOCK" ? "OUT_OF_STOCK" : "UNAVAILABLE")
      : availabilityFromStock(available, Number(product.lowStockThreshold || 5));
    return { ...product, reservableQuantity: available, effectiveAvailability };
  });
}
