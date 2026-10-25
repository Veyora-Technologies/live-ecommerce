"use client";

import { useEffect, useRef, useState } from "react";
import { CloudOff, Download, RotateCw, Wifi } from "lucide-react";

/** Connection recovery and user-approved PWA updates; transaction data stays network-only. */
export default function OfflineSync() {
  const [online, setOnline] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [message, setMessage] = useState("");
  const reloadOnControllerChange = useRef(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => { setOnline(true); setShowReconnected(true); window.setTimeout(() => setShowReconnected(false), 3500); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    let registration: ServiceWorkerRegistration | null = null;
    let removed = false;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        if (removed) return;
        registration = reg;
        const check = () => { if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true); };
        check();
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
          });
        });
        const poll = window.setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
        (reg as ServiceWorkerRegistration & { __livePoll?: number }).__livePoll = poll;
      }).catch(() => { /* browsing still works without PWA support */ });
      const onController = () => {
        if (reloadOnControllerChange.current) window.location.reload();
      };
      navigator.serviceWorker.addEventListener("controllerchange", onController);
      return () => {
        removed = true;
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        navigator.serviceWorker.removeEventListener("controllerchange", onController);
        const poll = registration && (registration as ServiceWorkerRegistration & { __livePoll?: number }).__livePoll;
        if (poll) window.clearInterval(poll);
      };
    }
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const applyUpdate = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.waiting) { setUpdateReady(false); return; }
    setMessage("Updating Furnivo. Your current page will reload; unsaved text in open forms may be lost.");
    reloadOnControllerChange.current = true;
    registration.waiting.postMessage("LIVE_SKIP_WAITING");
  };

  if (online && !showReconnected && !updateReady && !message) return null;
  return <aside className="live-connection-panel" role="status" aria-live="polite">
    {!online ? <>
      <div className="live-connection-title"><CloudOff size={17} /> You’re offline</div>
      <p>Current stock and reservations need a connection. Cached information, if visible, is not a fresh confirmation; an offline reservation is never successful.</p>
    </> : showReconnected ? <div className="live-connection-title"><Wifi size={17} /> Connection restored · refresh listings before acting</div> : null}
    {updateReady && <div className="live-update-row"><span><Download size={16} /> A Furnivo update is ready.</span><button type="button" onClick={applyUpdate}><RotateCw size={14} /> Update</button></div>}
    {message && <p>{message}</p>}
    {message && <button type="button" className="live-dismiss-button" onClick={() => setMessage("")}>Dismiss</button>}
  </aside>;
}
