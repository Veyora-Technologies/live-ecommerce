import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(10).optional().or(z.literal("")),
  password: z.string().min(6),
});

export const loginSchema = z.object({
  emailOrPhone: z.string().min(3),
  password: z.string().min(1),
});

export const merchantSchema = z.object({
  businessName: z.string().min(2),
  category: z.string().min(2),
  description: z.string().optional(),
  address: z.string().min(5),
  area: z.string().min(2),
  city: z.string().default("Abuja"),
  phone: z.string().min(10),
  email: z.string().email().optional().or(z.literal("")),
  imageUrl: z.string().optional(),
  pickupAvailable: z.boolean().optional(),
  deliveryAvailable: z.boolean().optional(),
});

export const productSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(1),
  brand: z.string().optional(),
  description: z.string().optional(),
  price: z.number().int().positive(),
  stockQuantity: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).optional(),
  unit: z.string().optional(),
  imageUrl: z.string().optional(),
  sku: z.string().optional(),
});

export const reservationSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(20),
});
