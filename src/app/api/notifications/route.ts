import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { notificationCategory, type NotificationCategory } from "@/lib/notification-category";

export const dynamic = "force-dynamic";
const categories: NotificationCategory[] = ["activity", "alerts", "security", "business", "updates"];
const oneUpdateSchema = z.object({ id: z.string().min(1).max(64), read: z.boolean() }).strict();
const allUpdateSchema = z.object({ markAllRead: z.literal(true) }).strict();

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const params = req.nextUrl.searchParams;
  const page = Number(params.get("page") || 1);
  const limit = Number(params.get("limit") || 30);
  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: "Use page 1–1000 and limit 1–100" }, { status: 400, ...noStore });
  const category = (params.get("category") || "all").toLowerCase();
  if (category !== "all" && !categories.includes(category as NotificationCategory)) return NextResponse.json({ error: "Choose a supported notification category" }, { status: 400, ...noStore });
  const unreadOnly = params.get("unreadOnly") === "true";

  const rows = await prisma.notification.findMany({
    where: { recipientId: user.id, ...(unreadOnly ? { read: false } : {}) },
    select: { id: true, type: true, title: true, body: true, resourceType: true, resourceId: true, read: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: Math.min(1000, page * limit),
  });
  const filtered = category === "all" ? rows : rows.filter((row) => notificationCategory(row.type) === category);
  const start = (page - 1) * limit;
  const notifications = filtered.slice(start, start + limit).map((row) => ({ ...row, category: notificationCategory(row.type) }));
  const [unreadCount, totalCount] = await Promise.all([
    prisma.notification.count({ where: { recipientId: user.id, read: false } }),
    prisma.notification.count({ where: { recipientId: user.id } }),
  ]);
  return NextResponse.json({ notifications, page, limit, unreadCount, totalCount, hasMore: start + limit < filtered.length }, noStore);
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });
  const body = await req.json().catch(() => null);
  const all = allUpdateSchema.safeParse(body);
  if (all.success) {
    const result = await prisma.notification.updateMany({ where: { recipientId: user.id, read: false }, data: { read: true } });
    return NextResponse.json({ updated: result.count, read: true }, noStore);
  }
  const one = oneUpdateSchema.safeParse(body);
  if (!one.success) return NextResponse.json({ error: "Provide a notification id and read state, or markAllRead:true" }, { status: 400, ...noStore });
  const result = await prisma.notification.updateMany({ where: { id: one.data.id, recipientId: user.id }, data: { read: one.data.read } });
  if (result.count !== 1) return NextResponse.json({ error: "Notification not found" }, { status: 404, ...noStore });
  return NextResponse.json({ updated: 1, read: one.data.read }, noStore);
}
