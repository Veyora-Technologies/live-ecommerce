"use client";

import { useRef, useState } from "react";
import { QrCode, X } from "lucide-react";

export default function MerchantQrButton({ merchantId, businessName }: { merchantId: string; businessName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const close = () => { setOpen(false); window.setTimeout(() => triggerRef.current?.focus(), 0); };
  const show = async () => {
    setOpen(true); setError("");
    window.setTimeout(() => closeRef.current?.focus(), 0);
    if (image) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/merchant/${encodeURIComponent(merchantId)}/qr`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The public profile QR is not available.");
      setImage(data.qrDataUrl); setUrl(data.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load the QR code."); }
    finally { setLoading(false); }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
    if (!focusable?.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <>
    <button ref={triggerRef} type="button" className="live-header-action" onClick={show}><QrCode size={16} aria-hidden="true" /> Profile QR</button>
    {open && <div className="live-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={handleKeyDown}>
      <section ref={dialogRef} className="live-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="merchant-qr-title" tabIndex={-1}>
        <button ref={closeRef} type="button" className="live-icon-button-sm live-modal-close" onClick={close} aria-label="Close QR code"><X size={18} /></button>
        <div className="live-eyebrow">Discovery only</div><h2 id="merchant-qr-title">{businessName} profile</h2>
        {loading && <div className="live-skeleton live-qr-skeleton" role="status" aria-label="Loading QR code" />}
        {image && <img src={image} alt={`QR code linking to ${businessName}'s public Furnivo profile`} width="256" height="256" className="live-qr-image" />}
        {error && <p className="live-inline-error" role="alert">{error}</p>}
        {url && <p className="live-muted live-qr-url">{url}</p>}
        <p className="live-caveat">This QR opens the public merchant profile. It is not a payment code, login method, or proof of stock.</p>
        <div className="live-edit-actions">
          {image && <a className="live-button" href={image} download="live-merchant-profile-qr.png">Download QR</a>}
          <a className="live-button" href={`/merchant/${encodeURIComponent(merchantId)}`} target="_blank" rel="noreferrer">Open profile</a>
          <button type="button" className="live-button" onClick={close}>Done</button>
        </div>
      </section>
    </div>}
  </>;
}
