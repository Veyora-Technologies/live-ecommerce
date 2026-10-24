"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type State = { status: "working" | "done" | "error"; message: string };

/**
 * Landing page for the verification link emailed at sign-up.
 *
 * The token is single-use and 24-hour limited; it is consumed with a PUT to
 * /api/auth/verify-contact, which requires the signed-in account that owns the
 * challenge. If the visitor is signed out, the page tells them to sign in first
 * rather than silently failing.
 */
export default function VerifyContactPage() {
  const [state, setState] = useState<State>({ status: "working", message: "Confirming your contact details…" });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    let cancelled = false;
    const fail = async (message: string) => {
      if (!cancelled) setState({ status: "error", message });
    };
    if (!token) {
      // Reported asynchronously so the mount render is not re-entered from the effect body.
      void fail("This link is missing its verification token. Request a new link from Account security.");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-contact", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          const parts = [data.emailVerified ? "email" : null, data.phoneVerified ? "phone" : null].filter(Boolean);
          setState({ status: "done", message: `Confirmed: ${parts.join(" and ") || "your contact details"}.` });
        } else if (res.status === 401) {
          setState({ status: "error", message: "Sign in to the account you are verifying, then open this link again." });
        } else {
          setState({ status: "error", message: data.error || "This verification link is invalid or has expired." });
        }
      } catch {
        if (!cancelled) setState({ status: "error", message: "Live could not be reached. Check your connection and open the link again." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-xl font-black">Email verification</h1>
        <p
          className={`mt-3 text-sm ${state.status === "error" ? "text-red-700" : state.status === "done" ? "text-emerald-800" : "text-slate-600"}`}
          role="status"
          aria-live="polite"
        >
          {state.message}
        </p>
        <div className="mt-5 flex justify-center gap-3 text-sm">
          <Link href="/profile/security" className="rounded-full border border-slate-200 px-4 py-2 font-semibold">Account security</Link>
          <Link href="/auth/login" className="rounded-full bg-slate-950 px-4 py-2 font-semibold text-white">Sign in</Link>
        </div>
      </div>
    </main>
  );
}
