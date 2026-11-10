import { z } from "zod";
import { NextResponse } from "next/server";
import { isMediaPath } from "@/lib/media-path";

/** Shared server-boundary schemas (§23). Prices in kobo unless stated. */
const integerInput = (value: unknown) => {
  if (typeof value !== "number" && typeof value !== "string") return Number.NaN;
  if (typeof value === "string" && !/^-?\d+$/.test(value.trim())) return Number.NaN;
  return value;
};
const requiredInteger = (min: number, max: number) =>
  z.preprocess(integerInput, z.coerce.number().int().min(min).max(max));
const optionalInteger = (min: number, max: number) =>
  z.preprocess((value) => value === undefined || value === "" ? undefined : integerInput(value), z.coerce.number().int().min(min).max(max).optional());

/**
 * Product images must be either an absolute https URL or the same-origin path of
 * an image uploaded through /api/uploads. Relative protocol-relative values
 * (//evil.example) and data:/blob:/javascript: values are rejected.
 */
const httpsImageUrl = z.string().min(1).max(500).refine((value) => {
  if (isMediaPath(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "Image URL must be an https:// URL or an uploaded /api/media/… path");

export const loginSchema = z.object({
  emailOrPhone: z.string().min(3).max(120),
  password: z.string().min(1).max(200),
  mfaCode: z.string().regex(/^\d{6}$/).optional(),
});
export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(120).optional().nullable(),
  phone: z.string().min(7).max(20).optional().nullable(),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  policyAcceptances: z.array(z.object({ policyId: z.string().trim().min(1).max(64) }).strict()).max(3).optional(),
});
export const reservationSchema = z.object({
  productId: z.string().min(1).max(40),
  quantity: z.coerce.number().int().min(1).max(20),
  variantId: z.string().max(40).optional(),
  branchId: z.string().max(40).optional(),
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9._:-]{8,120}$/).optional(),
});
export const productCreateSchema = z.object({
  merchantId: z.string().min(1).max(40),
  name: z.string().min(2).max(160),
  category: z.string().min(1).max(60),
  brand: z.string().max(80).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  price: requiredInteger(0, 1_000_000_000),
  stockQuantity: requiredInteger(0, 1_000_000),
  lowStockThreshold: optionalInteger(0, 100_000),
  unit: z.string().min(1).max(20).optional(),
  imageUrl: z.preprocess((value) => value === "" ? null : value, httpsImageUrl.optional().nullable()),
  sku: z.string().max(80).optional().nullable(),
  barcode: z.string().max(80).optional().nullable(),
  branchId: z.string().min(1).max(64).optional().nullable(),
}).strict();
export const productPatchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  price: optionalInteger(0, 1_000_000_000),
  stockQuantity: optionalInteger(0, 1_000_000),
  lowStockThreshold: optionalInteger(0, 100_000),
  category: z.string().max(60).optional(),
  brand: z.string().max(80).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  imageUrl: httpsImageUrl.optional().nullable(),
  unit: z.string().max(20).optional(),
  reason: z.string().max(200).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});
export const searchSchema = z.object({
  q: z.string().max(200).optional(),
  area: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const resetSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(10, "Use at least 10 characters").max(200),
});

export function badRequest(error: z.ZodError) {
  return NextResponse.json(
    { error: "Invalid request", detail: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 400) },
    { status: 400 }
  );
}

export function parseOr400<T>(schema: z.ZodType<T>, input: unknown): { data: T } | { response: NextResponse } {
  const r = schema.safeParse(input);
  if (!r.success) return { response: badRequest(r.error) };
  return { data: r.data };
}
