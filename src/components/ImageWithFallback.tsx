"use client";

import { useState } from "react";
import { Package, Store } from "lucide-react";

export default function ImageWithFallback({ src, alt, kind = "product", className = "" }: {
  src?: string | null;
  alt: string;
  kind?: "product" | "merchant";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const Icon = kind === "merchant" ? Store : Package;
    return <div className={`live-image-placeholder ${className}`} role={alt ? "img" : undefined} aria-label={alt || undefined}>
      <Icon size={kind === "merchant" ? 28 : 34} strokeWidth={1.6} aria-hidden="true" />
      {kind === "merchant" && <span>Business listing</span>}
    </div>;
  }
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
