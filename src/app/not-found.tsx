import Link from "next/link";

/**
 * 404 page.
 *
 * Previously Next's unbranded default was served for every unknown URL, which
 * gave a visitor no route back into Furnivo. Deliberately static: it must not
 * touch the database or the session, because those are the most likely reasons
 * a stale link still resolves to nothing.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm font-semibold text-emerald-800 underline">
          ← Back to Furnivo
        </Link>
        <p className="mt-6 text-xs font-bold uppercase tracking-wide text-emerald-800">Page not found</p>
        <h1 className="mt-1 text-3xl font-black">That page does not exist</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-700">
          The link may be out of date, or the listing it pointed to may have been removed. Nothing was charged or
          reserved by opening this address.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="font-bold">Where to go next</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link
              href="/search"
              className="inline-flex min-h-11 items-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Search listings
            </Link>
            <Link
              href="/marketplace"
              className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-5 text-sm font-semibold"
            >
              Browse the marketplace
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-5 text-sm font-semibold"
            >
              Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
