import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { InventoryConflictError, reserveInventoryUnits } from "@/lib/reservation-stock";

describe("reservation stock compare-and-swap", () => {
  const product = { id: "product-1", stockQuantity: 1, reservedQuantity: 0 };
  const variant = { id: "variant-1", productId: "product-1", stockQuantity: 1, reservedQuantity: 0 };

  it("claims product and selected variant only if the read snapshots still match", async () => {
    const productUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const variantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { product: { updateMany: productUpdateMany }, productVariant: { updateMany: variantUpdateMany } } as unknown as Prisma.TransactionClient;

    await reserveInventoryUnits(tx, product, variant, 1);

    expect(productUpdateMany).toHaveBeenCalledWith({
      where: { id: "product-1", stockQuantity: 1, reservedQuantity: 0 },
      data: { reservedQuantity: { increment: 1 } },
    });
    expect(variantUpdateMany).toHaveBeenCalledWith({
      where: { id: "variant-1", productId: "product-1", stockQuantity: 1, reservedQuantity: 0 },
      data: { reservedQuantity: { increment: 1 } },
    });
  });

  it("rejects a product stock snapshot changed by a concurrent writer", async () => {
    const productUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const variantUpdateMany = vi.fn();
    const tx = { product: { updateMany: productUpdateMany }, productVariant: { updateMany: variantUpdateMany } } as unknown as Prisma.TransactionClient;

    await expect(reserveInventoryUnits(tx, product, variant, 1)).rejects.toBeInstanceOf(InventoryConflictError);
    expect(variantUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a variant snapshot changed by a concurrent writer", async () => {
    const tx = {
      product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      productVariant: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as Prisma.TransactionClient;

    await expect(reserveInventoryUnits(tx, product, variant, 1)).rejects.toThrow("Variant availability changed");
  });
});
