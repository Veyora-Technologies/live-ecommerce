"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone) setInstalled(true);
    const capture = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const complete = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);

  if (!deferred || installed) return null;
  return (
    <button type="button" className="live-header-action live-install-action" onClick={async () => {
      await deferred.prompt();
      const result = await deferred.userChoice;
      if (result.outcome === "accepted") setDeferred(null);
    }} aria-label="Install Live on this device">
      <Download size={17} aria-hidden="true" /> <span>Install</span>
    </button>
  );
}
