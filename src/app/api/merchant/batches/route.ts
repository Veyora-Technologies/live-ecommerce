import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole, canEditInventory } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";

/** Batch management (§3). Private by default; blocked batches stop reservations. */
const STATUSES = ["ACTIVE", "QUARANTINED", "RECALLED", "EXPIRED"];

async function authProduct(userId: string, productId: string) {
  const product = await prisma.product.findUnique({ where:{ id: productId } });
  if (!product) return null;
  const role = await merchantRole(product.merchantId, userId);
  return canEditInventory(role) ? product : null;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const productId = new URL(req.url).searchParams.get("productId") || "";
  const product = await authProduct(user.id, productId);
  if (!product) return NextResponse.json({ error: "Forbidden or not found" }, { status: 403 });
  const batches = await prisma.productBatch.findMany({ where:{ productId }, orderBy:{ createdAt: "desc" } });
  const now = new Date();
  return NextResponse.json({
    batches: batches.map(b => ({ ...b, effectiveStatus: b.status === "ACTIVE" && b.expiresAt && b.expiresAt < now ? "EXPIRED" : b.status })),
    note: "Batch and expiry data is private by default. A product with no recall recorded is not certified safe — Furnivo only enforces restrictions you record.",
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const lotId = String(b.batchNumber || b.lotId || "");
  if (!b.productId || !lotId) return NextResponse.json({ error: "productId and batchNumber required" }, { status: 400 });
  const product = await authProduct(user.id, b.productId);
  if (!product) return NextResponse.json({ error: "Forbidden or not found" }, { status: 403 });
  if (b.status && !STATUSES.includes(b.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const batch = await prisma.productBatch.create({
    data:{
      productId: b.productId, merchantId: product.merchantId, lotId: lotId.slice(0, 80),
      quantity: Math.max(0, Math.min(100000, Number(b.quantity) || 0)),
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
      supplierRef: b.supplierRef ? String(b.supplierRef).slice(0, 80) : null,
      status: b.status || "ACTIVE", recallNote: b.note ? String(b.note).slice(0, 300) : null,
    },
  });
  await emitEvent("batch.created", { batchId: batch.id, productId: b.productId, status: batch.status }, { merchantId: product.merchantId, userId: user.id });
  return NextResponse.json({ batch }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const batch = await prisma.productBatch.findUnique({ where:{ id: b.id || "" } });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  const product = await authProduct(user.id, batch.productId);
  if (!product) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (b.status && !STATUSES.includes(b.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const updated = await prisma.productBatch.update({
    where:{ id: batch.id },
    data:{
      status: b.status || batch.status, recallNote: b.note !== undefined ? String(b.note).slice(0, 300) : batch.recallNote,
      quantity: b.quantity !== undefined ? Math.max(0, Math.min(100000, Number(b.quantity) || 0)) : batch.quantity,
      expiresAt: b.expiresAt !== undefined ? (b.expiresAt ? new Date(b.expiresAt) : null) : batch.expiresAt,
    },
  });
  await emitEvent("batch.updated", { batchId: batch.id, from: batch.status, to: updated.status }, { merchantId: product.merchantId, userId: user.id });
  return NextResponse.json({ batch: updated, effect: updated.status !== "ACTIVE" ? "This batch quantity is excluded from reservable stock immediately." : "Batch is reservable again." });
}
