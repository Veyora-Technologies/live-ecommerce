"use client";

import { useState } from "react";
import { Lock, Phone } from "lucide-react";

type Contact = { phone: string | null; whatsapp: string | null };

/**
 * Contact actions for a public listing.
 *
 * The number is never part of the server-rendered HTML: it is fetched from
 * /api/products/[id]/contact, which requires a signed-in account and records an
 * audit event. Signed-out visitors are pointed at the sign-in page instead of
 * being shown a harvestable phone number.
 */
export default function MerchantContactActions({
  productId,
  merchantId,
  signedIn,
  className = "",
}: {
  productId?: string;
  merchantId?: string;
  signedIn: boolean;
  className?: string;
}) {
  const endpoint = productId
    ? `/api/products/${encodeURIComponent(productId)}/contact`
    : merchantId
      ? `/api/merchant/${encodeURIComponent(merchantId)}/contact`
      : null;
  const returnTo = productId ? `/product/${productId}` : `/merchant/${merchantId ?? ""}`;
  const [contact, setContact] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function reveal(): Promise<Contact | null> {
    if (!signedIn) {
      setMessage("Sign in to view the merchant's contact details.");
      return null;
    }
    setBusy(true);
    setMessage("");
    try {
      if (!endpoint) {
        setMessage("Contact details are unavailable.");
        return null;
      }
      const res = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(res.status === 401 ? "Sign in to view the merchant's contact details." : (data.error || "Contact details are unavailable."));
        return null;
      }
      const next = { phone: data.phone ?? null, whatsapp: data.whatsapp ?? null };
      setContact(next);
      return next;
    } catch {
      setMessage("Contact details could not be loaded. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (contact?.phone) {
    return (
      <div className={`flex gap-2 ${className}`}>
        <a href={`tel:${contact.phone}`} className="flex-1 h-11 grid place-items-center rounded-full bg-white border border-slate-200 font-semibold text-sm">
          Call {contact.phone}
        </a>
        {contact.whatsapp && (
          <a
            href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 h-11 grid place-items-center rounded-full bg-[#25D366] text-white font-semibold text-sm"
          >
            WhatsApp
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void reveal()}
        disabled={busy}
        className="w-full h-11 grid place-items-center gap-2 rounded-full bg-white border border-slate-200 font-semibold text-sm disabled:opacity-60"
      >
        <span className="inline-flex items-center gap-2">
          {signedIn ? <Phone size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}
          {busy ? "Loading contact…" : signedIn ? "Show merchant contact" : "Sign in to contact merchant"}
        </span>
      </button>
      {message && (
        <p className="mt-2 text-xs text-slate-500" role="status">
          {message}{" "}
          {!signedIn && (
            <a className="font-semibold text-live-green-ink underline" href={`/auth/login?next=${encodeURIComponent(returnTo)}`}>
              Sign in
            </a>
          )}
        </p>
      )}
    </div>
  );
}
