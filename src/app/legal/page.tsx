import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { currentPublishedPolicies, getLegalReleaseGate, isPolicyKey, POLICY_SPECS, type PolicyKey } from "@/lib/legal";
import PolicyAcceptanceButton from "./PolicyAcceptanceButton";

export const dynamic = "force-dynamic";

export default async function LegalPoliciesPage() {
  const user = await getCurrentUser().catch(() => null);
  const [policies, marketplaceGate, accountGate, profile, merchants] = await Promise.all([
    currentPublishedPolicies(),
    getLegalReleaseGate("MARKETPLACE"),
    getLegalReleaseGate("ACCOUNT"),
    prisma.legalOperatorProfile.findUnique({
      where: { id: "primary" },
      select: { legalName: true, tradingName: true, entityType: true, registeredAddress: true, jurisdiction: true, publicContactEmail: true, privacyContactEmail: true, complaintsContactEmail: true, publicPhone: true },
    }),
    user ? prisma.merchant.findMany({ where: { ownerId: user.id }, select: { id: true, businessName: true, status: true }, orderBy: { businessName: "asc" } }) : Promise.resolve([]),
  ]);
  const visiblePolicies = policies.filter((policy): policy is typeof policy & { key: PolicyKey } => isPolicyKey(policy.key));
  const userAcceptances = user && visiblePolicies.length ? await prisma.legalPolicyAcceptance.findMany({
    where: { userId: user.id, policyId: { in: visiblePolicies.map((policy) => policy.id) } },
    select: { policyId: true, merchantId: true, action: true },
  }) : [];
  const accepted = (policyId: string, merchantId: string | null, expected: string) => userAcceptances.some((item) => item.policyId === policyId && item.merchantId === merchantId && item.action === expected);

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="text-sm font-semibold text-emerald-800 underline">← Back to Furnivo</Link>
      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-emerald-800">Furnivo policy and release information</p>
      <h1 className="mt-1 text-3xl font-black">Policies, disclosures and contact details</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">This page displays policy versions actually published in Furnivo. It does not represent that external legal review has occurred unless a release gate below says its required review record is present. Nothing here removes rights that cannot lawfully be excluded.</p>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="operator-heading">
        <h2 id="operator-heading" className="font-bold">Platform operator and contacts</h2>
        {profile ? <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold text-slate-600">Legal name</dt><dd>{profile.legalName || "Not recorded"}</dd></div>
          <div><dt className="font-semibold text-slate-600">Trading name</dt><dd>{profile.tradingName || "Not recorded"}</dd></div>
          <div><dt className="font-semibold text-slate-600">Entity type</dt><dd>{profile.entityType || "Not recorded"}</dd></div>
          <div><dt className="font-semibold text-slate-600">Jurisdiction</dt><dd>{profile.jurisdiction || "Not recorded"}</dd></div>
          <div className="sm:col-span-2"><dt className="font-semibold text-slate-600">Registered address</dt><dd className="whitespace-pre-wrap">{profile.registeredAddress || "Not recorded"}</dd></div>
          <div><dt className="font-semibold text-slate-600">Public contact</dt><dd>{profile.publicContactEmail ? <a className="underline" href={`mailto:${profile.publicContactEmail}`}>{profile.publicContactEmail}</a> : "Not recorded"}{profile.publicPhone ? ` · ${profile.publicPhone}` : ""}</dd></div>
          <div><dt className="font-semibold text-slate-600">Privacy requests</dt><dd>{profile.privacyContactEmail ? <a className="underline" href={`mailto:${profile.privacyContactEmail}`}>{profile.privacyContactEmail}</a> : "Not recorded"}</dd></div>
          <div><dt className="font-semibold text-slate-600">Complaints</dt><dd>{profile.complaintsContactEmail ? <a className="underline" href={`mailto:${profile.complaintsContactEmail}`}>{profile.complaintsContactEmail}</a> : "Not recorded"}</dd></div>
        </dl> : <p className="mt-2 text-sm text-slate-700">Operator identity and contact details have not been recorded.</p>}
      </section>

      <section className={`mt-4 rounded-2xl border p-5 ${accountGate.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`} aria-labelledby="account-gate-heading">
        <h2 id="account-gate-heading" className="font-bold">Account registration availability</h2>
        <p className="mt-1 text-sm">{accountGate.ready ? accountGate.bypassedOutsideProduction ? "Non-production policy gate bypass is active; this is not evidence of production readiness." : "The account policy requirements have recorded release information." : accountGate.publicMessage}</p>
        {!accountGate.ready && accountGate.missing.length > 0 && <p className="mt-2 text-sm">Not recorded: {accountGate.missing.join(", ")}.</p>}
      </section>
      <section className={`mt-4 rounded-2xl border p-5 ${marketplaceGate.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`} aria-labelledby="marketplace-gate-heading">
        <h2 id="marketplace-gate-heading" className="font-bold">Marketplace availability</h2>
        <p className="mt-1 text-sm">{marketplaceGate.ready ? marketplaceGate.bypassedOutsideProduction ? "Non-production policy gate bypass is active; no production release is implied." : "The marketplace legal and trust-information gate is ready." : marketplaceGate.publicMessage}</p>
        {!marketplaceGate.ready && marketplaceGate.missing.length > 0 && <p className="mt-2 text-sm">Not recorded: {marketplaceGate.missing.join(", ")}.</p>}
      </section>

      {!visiblePolicies.length ? <section className="mt-6 rounded-2xl border border-amber-300 bg-white p-5" role="status"><h2 className="font-bold">No current policy versions published</h2><p className="mt-2 text-sm text-slate-700">Furnivo has no effective published policies to display. No generic placeholder terms are substituted.</p></section> : <section className="mt-7" aria-labelledby="policies-heading">
        <h2 id="policies-heading" className="text-xl font-black">Current published versions</h2>
        <div className="mt-4 space-y-4">
          {visiblePolicies.map((policy) => {
            const key = policy.key;
            const action = POLICY_SPECS[key].acceptanceMode === "ACCEPT" ? "ACCEPTED" as const : "ACKNOWLEDGED" as const;
            const sellerScoped = key === "SELLER_AGREEMENT";
            return <article key={policy.id} id={key} className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{key.replaceAll("_", " ")}</p><h3 className="mt-1 text-lg font-bold">{policy.title}</h3></div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">Version {policy.version}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">Effective {policy.effectiveAt ? new Date(policy.effectiveAt).toLocaleDateString("en-NG", { dateStyle: "long", timeZone: "Africa/Lagos" }) : "date not recorded"}</p>
              <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{policy.content}</div>
              {policy.acceptanceMode !== "NONE" && !user && <p className="mt-4 text-sm text-slate-700"><Link href={`/auth/login?next=${encodeURIComponent("/legal#" + key)}`} className="font-semibold text-emerald-800 underline">Sign in</Link> to record your {action === "ACCEPTED" ? "acceptance" : "acknowledgement"}.</p>}
              {policy.acceptanceMode !== "NONE" && user && !sellerScoped && <PolicyAcceptanceButton policyId={policy.id} accepted={accepted(policy.id, null, action)} action={action} />}
              {sellerScoped && user && (merchants.length ? <div className="mt-5 border-t border-slate-200 pt-4">
                <h4 className="font-semibold">Seller agreement by business</h4>
                <p className="mt-1 text-sm text-slate-600">Only the signed-in owner account can record acceptance. Acceptance is scoped to one business.</p>
                <div className="mt-3 space-y-3">{merchants.map((merchant) => <div key={merchant.id} className="rounded-xl border border-slate-200 p-4"><p className="font-semibold">{merchant.businessName} <span className="font-normal text-slate-500">({merchant.status.toLowerCase().replaceAll("_", " ")})</span></p><PolicyAcceptanceButton policyId={policy.id} merchantId={merchant.id} accepted={accepted(policy.id, merchant.id, action)} action={action} /></div>)}</div>
              </div> : <p className="mt-4 text-sm text-slate-700"><Link href="/merchant" className="font-semibold text-emerald-800 underline">Open your seller workspace</Link> to manage a business and its seller-agreement acceptance.</p>)}
            </article>;
          })}
        </div>
      </section>}

      <div className="mt-8 flex flex-wrap gap-4 border-t border-slate-200 pt-5 text-sm">
        <Link href="/privacy" className="font-semibold underline">Privacy self-service</Link>
        <Link href="/complaints" className="font-semibold underline">Complaints and disputes</Link>
        <Link href="/marketplace" className="font-semibold underline">Marketplace</Link>
      </div>
    </div>
  </main>;
}
