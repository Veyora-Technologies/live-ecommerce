"use client";
import { cn } from "@/lib/utils";

export function Button({ className, variant="primary", size="md", ...props }: any) {
  const base = "inline-flex items-center justify-center font-semibold rounded-full transition active:scale-[0.98] disabled:opacity-50";
  const variants: any = {
    primary: "bg-live-black text-white hover:bg-neutral-900 shadow-sm",
    accent: "bg-live-green-ink text-white hover:bg-live-green-ink-hover",
    ghost: "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900",
    subtle: "bg-slate-100 hover:bg-slate-200 text-slate-900",
  };
  const sizes: any = {
    sm: "h-9 px-4 text-sm",
    md: "h-11 px-6 text-[14px]",
    lg: "h-12 px-7 text-[15px]",
    icon: "h-10 w-10 p-0",
  };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

export function Badge({ children, tone="green", className="" }: any) {
  const tones:any = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    grey: "bg-slate-100 text-slate-600 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    dark: "bg-slate-900 text-white border-slate-900",
  };
  return <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase px-2.5 py-1 rounded-full border ${tones[tone]} ${className}`}>{children}</span>;
}

export function Card({ className, ...props }: any) {
  return <div className={cn("bg-white rounded-[18px] border border-slate-200 shadow-sm", className)} {...props} />;
}

export function Input(props: any) {
  return <input {...props} className={cn("w-full h-11 px-4 rounded-xl border border-slate-200 bg-white outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[14px]", props.className)} />;
}
export function Label(props:any){ return <label {...props} className={cn("text-[12px] font-semibold tracking-wide uppercase text-slate-500", props.className)} />}

export function AvailabilityDot({ status }: { status: string }) {
  const map:any = { IN_STOCK:"bg-emerald-500", LOW_STOCK:"bg-amber-500", OUT_OF_STOCK:"bg-red-500", UNAVAILABLE:"bg-slate-500", UNKNOWN:"bg-slate-400" };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[status]||"bg-slate-400"}`} />;
}
