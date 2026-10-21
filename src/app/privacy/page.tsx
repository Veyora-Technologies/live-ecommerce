import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PrivacyPortalClient from "./PrivacyPortalClient";

export const metadata = { title: "Privacy self-service · Live" };

export default async function PrivacyPage() {
  const user = await getCurrentUser().catch(() => null);
  const account = user ? await prisma.user.findUnique({ where: { id: user.id }, select: { marketingConsent: true } }) : null;
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-5xl">
      <Link href="/" className="text-sm font-semibold text-emerald-800 underline">← Back to Live</Link>
      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-emerald-800">Account self-service</p>
      <h1 className="mt-1 text-3xl font-black">Privacy and data requests</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">This authenticated portal provides a data export, a separately stored marketing preference, and intake/status for access, correction, objection, and account-deletion requests. Intake does not itself complete a request, establish a legal outcome, or promise a response time. See <Link href="/legal#PRIVACY_NOTICE" className="font-semibold underline">the current published Privacy Notice</Link> and <Link href="/legal" className="font-semibold underline">operator contacts and service availability</Link>.</p>
      <PrivacyPortalClient initialMarketingConsent={account?.marketingConsent ?? false} />
    </div>
  </main>;
}
