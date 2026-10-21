"use client";

import { useEffect } from "react";

/** Account-only, server-backed recent view. Guests are not tracked in local storage. */
export default function RecentViewTracker({ productId, enabled }: { productId: string; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/recent-views", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId }),
      signal: controller.signal, keepalive: true,
    }).catch(() => { /* optional memory must never block product discovery */ });
    return () => controller.abort();
  }, [productId, enabled]);
  return null;
}
