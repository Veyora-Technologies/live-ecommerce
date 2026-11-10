import { describe, expect, it } from "vitest";
import { productCreateSchema } from "@/lib/validate";

const base = {
  merchantId: "m1",
  name: "Paracetamol 500mg",
  category: "Pharmacy",
  price: 120000,
  stockQuantity: 5,
  branchId: "b1",
};

describe("product image URL validation", () => {
  it("accepts an absolute https image URL", () => {
    const result = productCreateSchema.safeParse({ ...base, imageUrl: "https://cdn.example.com/a.jpg" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty string as no image", () => {
    const result = productCreateSchema.safeParse({ ...base, imageUrl: "" });
    expect(result.success).toBe(true);
  });

  it.each([
    "http://cdn.example.com/a.jpg",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "not-a-url",
  ])("rejects %s", (imageUrl) => {
    expect(productCreateSchema.safeParse({ ...base, imageUrl }).success).toBe(false);
  });
});
