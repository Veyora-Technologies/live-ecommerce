import Link from "next/link";
import ComplaintsPortalClient from "./ComplaintsPortalClient";

export const metadata = { title: "Complaints and disputes · Furnivo" };

export default function ComplaintsPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-6xl">
      <Link href="/" className="text-sm font-semibold text-emerald-800 underline">← Back to Furnivo</Link>
      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-emerald-800">Furnivo case intake</p>
      <h1 className="mt-1 text-3xl font-black">Complaints, disputes and IP reports</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">This authenticated workspace records your report and shows reporter-visible status updates when staff record them. A receipt is not a finding, refund decision, promise of removal, or response-time commitment. Review the currently published <Link href="/legal#COMPLAINTS_PROCESS" className="font-semibold underline">complaints process</Link> and <Link href="/legal#IP_REPORTING" className="font-semibold underline">IP reporting process</Link>.</p>
      <ComplaintsPortalClient />
    </div>
  </main>;
}
