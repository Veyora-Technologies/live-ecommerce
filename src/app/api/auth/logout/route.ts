import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, revokeSessionByToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // Server-side invalidation — clearing the browser cookie alone is not logout.
  await revokeSessionByToken(req.cookies.get(AUTH_COOKIE)?.value);
  const wantsHtml = !(req.headers.get("content-type")?.includes("application/json")) && req.headers.get("accept")?.includes("text/html");
  // A 303 changes a native form POST into a GET. Use a same-origin relative
  // Location: req.url can contain the dev server's bind address (0.0.0.0),
  // which is not the browser origin and is correctly rejected by form-action CSP.
  const res = wantsHtml
    ? new NextResponse(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store" } })
    : NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}
