"use client";

import { useEffect, useState } from "react";

export default function MerchantQrDisplay({ merchantId, businessName, className = "" }: { merchantId: string; businessName: string; className?: string }) {
  const [image, setImage] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/merchant/${encodeURIComponent(merchantId)}/qr`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.qrDataUrl) throw new Error("QR unavailable");
        if (active) setImage(data.qrDataUrl);
      })
      .catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, [merchantId]);
  if (unavailable) return <div className={className} role="status" aria-label="Merchant QR code currently unavailable">QR unavailable</div>;
  if (!image) return <div className={`${className} merchant-qr-placeholder`} role="status" aria-label={`Loading ${businessName} profile QR`} />;
  return <img src={image} alt={`QR code linking to ${businessName}'s public Furnivo profile`} className={className} loading="lazy" />;
}
