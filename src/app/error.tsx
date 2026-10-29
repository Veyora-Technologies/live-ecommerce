"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary.
 *
 * Without this file the App Router falls back to its own error screen, which is
 * unbranded and leaves the visitor with no way back into the app. This keeps a
 * failed render inside Furnivo and offers two exits: retry the segment, or go
 * somewhere known-good.
 *
 * `error.message` is deliberately not rendered. In production it can carry
 * internal detail (table names, query fragments, upstream URLs). Next exposes
 * `digest` — a hash that correlates with the server log — so a visitor can
 * quote it to support without the page leaking anything.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Nothing here writes to a remote sink on purpose: no error reporter is
    // configured, and inventing one would silently ship user data elsewhere.
    console.error("Unhandled route error", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm font-semibold text-emerald-800 underline">
          ← Back to Furnivo
        </Link>
        <p className="mt-6 text-xs font-bold uppercase tracking-wide text-emerald-800">Something went wrong</p>
        <h1 className="mt-1 text-3xl font-black">This page could not be loaded</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-700">
          The rest of Furnivo is still running. Nothing was submitted twice, and no payment was taken by this page.
          Try again, and if it keeps failing, reload once before retrying.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={reset}
              className="min-h-11 rounded-full bg-slate-950 px-5 font-semibold text-white hover:bg-slate-800"
            >
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-5 text-sm font-semibold"
            >
              Go to the home page
            </Link>
          </div>
          {error.digest ? (
            <p className="mt-4 text-xs text-slate-600">
              Reference for support: <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
