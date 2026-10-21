import type { Prisma } from "@prisma/client";

export type ProductStockSnapshot = {
  id: string;
  stockQuantity: number;
  reservedQuantity: number;
};

export type VariantStockSnapshot = ProductStockSnapshot & {
  id: string;
  productId: string;
};

/** A compare-and-swap miss means another transaction changed the stock snapshot. */
export class InventoryConflictError extends Error {
  constructor(message = "Availability changed while submitting. Refresh and try again.") {
    super(message);
    this.name = "InventoryConflictError";
  }
}

/**
 * Atomically claim the product and, when selected, variant quantities against
 * the snapshots read inside the same transaction. The unique stock counters
 * prevent two concurrent requests from both reserving the last unit. Callers
 * must throw on failure so the surrounding Prisma transaction rolls back.
 */
export async function reserveInventoryUnits(
  tx: Prisma.TransactionClient,
  product: ProductStockSnapshot,
  variant: VariantStockSnapshot | null,
  quantity: number,
) {
  const productClaim = await tx.product.updateMany({
    where: {
      id: product.id,
      stockQuantity: product.stockQuantity,
      reservedQuantity: product.reservedQuantity,
    },
    data: { reservedQuantity: { increment: quantity } },
  });
  if (productClaim.count !== 1) throw new InventoryConflictError();

  if (variant) {
    const variantClaim = await tx.productVariant.updateMany({
      where: {
        id: variant.id,
        productId: product.id,
        stockQuantity: variant.stockQuantity,
        reservedQuantity: variant.reservedQuantity,
      },
      data: { reservedQuantity: { increment: quantity } },
    });
    if (variantClaim.count !== 1) {
      throw new InventoryConflictError("Variant availability changed while submitting. Refresh and try again.");
    }
  }
}

/** Release both sides of a product/variant hold in the caller's transaction. */
export async function releaseInventoryUnits(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number,
) {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, stockQuantity: true, reservedQuantity: true } });
  if (!product || product.reservedQuantity < quantity) {
    throw new InventoryConflictError("The product reservation hold could not be safely released. Inventory needs review.");
  }
  const productClaim = await tx.product.updateMany({
    where: { id: product.id, stockQuantity: product.stockQuantity, reservedQuantity: product.reservedQuantity },
    data: { reservedQuantity: { decrement: quantity } },
  });
  if (productClaim.count !== 1) throw new InventoryConflictError();

  if (variantId) {
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { id: true, productId: true, stockQuantity: true, reservedQuantity: true },
    });
    if (!variant || variant.reservedQuantity < quantity) {
      throw new InventoryConflictError("The variant reservation hold could not be safely released. Inventory needs review.");
    }
    const variantClaim = await tx.productVariant.updateMany({
      where: {
        id: variant.id,
        productId,
        stockQuantity: variant.stockQuantity,
        reservedQuantity: variant.reservedQuantity,
      },
      data: { reservedQuantity: { decrement: quantity } },
    });
    if (variantClaim.count !== 1) throw new InventoryConflictError("Variant availability changed. Refresh and try again.");
  }
}

/** Consume a collected hold from both product and variant counters atomically. */
export async function consumeInventoryUnits(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number,
) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, stockQuantity: true, reservedQuantity: true, lowStockThreshold: true, availability: true },
  });
  if (!product || product.stockQuantity < quantity || product.reservedQuantity < quantity) {
    throw new InventoryConflictError("The product stock no longer covers this reservation. Inventory needs review.");
  }
  const nextStock = product.stockQuantity - quantity;
  const nextAvailability = nextStock <= 0 ? "OUT_OF_STOCK" : nextStock <= product.lowStockThreshold ? "LOW_STOCK" : "IN_STOCK";

  if (variantId) {
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { id: true, productId: true, stockQuantity: true, reservedQuantity: true },
    });
    if (!variant || variant.stockQuantity < quantity || variant.reservedQuantity < quantity) {
      throw new InventoryConflictError("The variant stock no longer covers this reservation. Inventory needs review.");
    }
    const variantClaim = await tx.productVariant.updateMany({
      where: {
        id: variant.id,
        productId,
        stockQuantity: variant.stockQuantity,
        reservedQuantity: variant.reservedQuantity,
      },
      data: { stockQuantity: { decrement: quantity }, reservedQuantity: { decrement: quantity } },
    });
    if (variantClaim.count !== 1) throw new InventoryConflictError("Variant availability changed. Refresh and try again.");
  }

  const productClaim = await tx.product.updateMany({
    where: {
      id: product.id,
      stockQuantity: product.stockQuantity,
      reservedQuantity: product.reservedQuantity,
    },
    data: {
      stockQuantity: { decrement: quantity },
      reservedQuantity: { decrement: quantity },
      availability: nextAvailability,
      lastConfirmedAt: new Date(),
    },
  });
  if (productClaim.count !== 1) throw new InventoryConflictError("Product availability changed. Refresh and try again.");

  return { previousStock: product.stockQuantity, nextStock, previousAvailability: product.availability, nextAvailability };
}
