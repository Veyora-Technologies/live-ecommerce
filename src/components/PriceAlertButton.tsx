"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { parseMajorAmountToMinor } from "@/lib/money";

export default function PriceAlertButton({ productId, loggedIn }: { productId: string; loggedIn: boolean }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const kobo = parseMajorAmountToMinor(target, 2);
    if (kobo === null || kobo <= 0n || kobo > 1_000_000_000n) { setMessage("Enter a valid target price in naira with no more than two decimal places."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/price-alerts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, targetPrice: Number(kobo) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save price alert.");
      setSaved(true); setMessage(data.note || "In-app price alert saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save price alert."); }
    finally { setBusy(false); }
  };

  return <section className="live-price-alert-card" aria-labelledby="price-alert-title">
    <div><div className="live-price-alert-heading"><Bell size={16} aria-hidden="true" /><h2 id="price-alert-title">Price target</h2></div>
      <p>Optional in-app alert if this merchant-listed price reaches your target. No past prices are inferred.</p></div>
    {!loggedIn ? <Link href={`/auth/login?next=${encodeURIComponent(`/product/${productId}`)}`} className="live-button">Sign in to set an alert</Link> : <form className="live-price-alert-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="price-target-input">Alert at or below (₦)</label>
      <div className="live-price-alert-controls"><input id="price-target-input" className="live-field" type="number" inputMode="decimal" min="0.01" step="0.01" max="10000000" required value={target} onChange={(event) => { setTarget(event.target.value); setSaved(false); setMessage(""); }} /><button className="live-button live-button-primary" type="submit" disabled={busy || saved}>{busy ? "Saving…" : saved ? <><Check size={15} /> Saved</> : "Set alert"}</button></div>
      <small>Only in-app checks are supported. Enable “In-app notifications” and “Price-change alerts” in Profile; scheduled processing must also be configured.</small>
      {message && <span role="status" aria-live="polite">{message}</span>}
    </form>}
  </section>;
}
