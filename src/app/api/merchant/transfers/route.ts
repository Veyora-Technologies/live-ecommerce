import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole, canEditInventory } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";

/** Branch transfers (§4): requested → acknowledged/rejected. Nothing auto-completes. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const merchantId = new URL(req.url).searchParams.get("merchantId") || "";
  const role = await merchantRole(merchantId, user.id);
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const transfers = await prisma.branchTransfer.findMany({
    where:{ merchantId }, orderBy:{ createdAt: "desc" }, take: 50,
    include:{ fromBranch:{ select:{ name: true } }, toBranch:{ select:{ name: true } } },
  });
  const productIds = [...new Set(transfers.map(t => t.productId))];
  const products = await prisma.product.findMany({ where:{ id:{ in: productIds } }, select:{ id: true, name: true } });
  const names = new Map(products.map(p => [p.id, p.name]));
  return NextResponse.json({ transfers: transfers.map(t => ({ ...t, productName: names.get(t.productId) || null })) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const product = await prisma.product.findUnique({ where:{ id: b.productId || "" } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  const role = await merchantRole(product.merchantId, user.id);
  if (!canEditInventory(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!b.fromBranchId || !b.toBranchId || b.fromBranchId === b.toBranchId) return NextResponse.json({ error: "Different from/to branches required" }, { status: 400 });
  const transfer = await prisma.branchTransfer.create({
    data:{ merchantId: product.merchantId, productId: product.id, fromBranchId: b.fromBranchId, toBranchId: b.toBranchId, quantity: Math.max(1, Number(b.quantity) || 1), initiatedBy: user.id },
  });
  return NextResponse.json({ transfer, note: "Transfer requested. It is NOT completed until received and acknowledged at the destination." }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const transfer = await prisma.branchTransfer.findUnique({ where:{ id: b.id || "" } });
  if (!transfer) return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  const role = await merchantRole(transfer.merchantId, user.id);
  if (!role || !["OWNER", "MANAGER"].includes(role)) return NextResponse.json({ error: "Only owners/managers can decide transfers" }, { status: 403 });
  const action = String(b.action || "");
  if ((action === "acknowledge" || action === "complete") && transfer.status === "REQUESTED") {
    const updated = await prisma.branchTransfer.update({ where:{ id: transfer.id }, data:{ status: "ACKNOWLEDGED", acknowledgedBy: user.id } });
    await prisma.inventoryMovement.create({ data:{ productId: transfer.productId, merchantId: transfer.merchantId, actorId: user.id, delta: transfer.quantity, reason: `Branch transfer acknowledged (${transfer.fromBranchId} → ${transfer.toBranchId})` } });
    await emitEvent("transfer.acknowledged", { transferId: transfer.id }, { merchantId: transfer.merchantId, userId: user.id });
    return NextResponse.json({ transfer: updated, note: "Acknowledged on receipt. Confirm physical stock matches before relying on counts." });
  }
  if (action === "reject" && transfer.status === "REQUESTED") {
    const updated = await prisma.branchTransfer.update({ where:{ id: transfer.id }, data:{ status: "REJECTED", acknowledgedBy: user.id } });
    return NextResponse.json({ transfer: updated });
  }
  return NextResponse.json({ error: `Cannot ${action} a transfer in state ${transfer.status}` }, { status: 400 });
}
