import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default function LoginPage(){
  return (
    <div className="min-h-screen flex">
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
        <Suspense fallback={<div>Loading...</div>}>
          <LoginForm />
        </Suspense>
      </div>
      <div className="hidden lg:flex flex-1 bg-live-black text-white p-10 flex-col justify-between relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-[500px] h-[500px] bg-emerald-500/20 rounded-full blur-3xl" />
        <div>
          <div className="text-4xl font-black leading-tight" style={{fontFamily:"Plus Jakarta Sans"}}>Find it.<br />Confirm it.<br /><span className="text-emerald-400">Get it.</span></div>
          <div className="mt-4 text-white/70 max-w-[420px]">Explore merchant-reported listings in Live’s supported locations. Check when records were updated; a reservation is confirmed only after the merchant responds.</div>
        </div>
        <div className="bg-white/10 border border-white/10 rounded-2xl p-4 max-w-[420px]">
          <div className="text-sm font-bold">How Live helps</div>
          <ul className="mt-2 text-sm text-white/70 list-disc ml-4">
            <li>Availability records show their last-confirmed time</li>
            <li>Older reports are flagged using category-specific rules</li>
            <li>A reservation is not confirmed until the merchant responds</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
