"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

export default function ShareButton({ title, text }: { title: string; text?: string }) {
  const [message, setMessage] = useState("");
  const share = async () => {
    const data = { title, text: text || title, url: window.location.href };
    try {
      if (navigator.share) { await navigator.share(data); setMessage("Shared."); return; }
      await navigator.clipboard.writeText(data.url);
      setMessage("Link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("Could not share. Copy the page URL from your browser address bar.");
    }
    window.setTimeout(() => setMessage(""), 3000);
  };
  return <span className="live-share-wrap"><button type="button" onClick={share} className="live-button"><Share2 size={16} aria-hidden="true" /><span>Share</span></button>{message && <span className="live-share-status" role="status">{message}</span>}</span>;
}
