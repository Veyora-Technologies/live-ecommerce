import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/db", () => ({ prisma: { notification: { findMany: mocks.findMany, count: mocks.count, updateMany: mocks.updateMany } } }));

import { GET, PATCH } from "@/app/api/notifications/route";

const request = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost"), init);

describe("notification API authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated reads before querying private records", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await GET(request("/api/notifications"));
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("scopes a single read-state update to the current recipient", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a" });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await PATCH(request("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "notification-owned-by-b", read: true }) }));
    expect(response.status).toBe(404);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "notification-owned-by-b", recipientId: "user-a" }, data: { read: true } });
  });

  it("marks all read only for the current recipient", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a" });
    mocks.updateMany.mockResolvedValue({ count: 2 });
    const response = await PATCH(request("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAllRead: true }) }));
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { recipientId: "user-a", read: false }, data: { read: true } });
  });
});
