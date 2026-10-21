import type { Prisma } from "@prisma/client";

/** Minimal consumer-facing reservation projection; excludes internal merchant settings and delivery flags. */
export const reservationViewSelect = {
  id: true,
  code: true,
  productId: true,
  merchantId: true,
  quantity: true,
  priceSnapshot: true,
  totalAmount: true,
  status: true,
  pickupWindow: true,
  branchId: true,
  expiresAt: true,
  createdAt: true,
  product: { select: { id: true, name: true, imageUrl: true, currency: true } },
  merchant: { select: { id: true, businessName: true, area: true } },
  branch: {
    select: {
      id: true,
      name: true,
      address: true,
      area: true,
      city: true,
      state: { select: { name: true } },
      lga: { select: { name: true } },
      cityArea: { select: { name: true } },
      locality: { select: { name: true } },
    },
  },
} satisfies Prisma.ReservationSelect;
