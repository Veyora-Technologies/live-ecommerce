"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";

type Section = { id: string; label: string; node: ReactNode };
type Layout = { order: string[]; hidden: string[] };

function parseLayout(raw: string | null, ids: string[]): Layout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Layout;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) return null;
    const order = [...new Set([...parsed.order.filter((id) => ids.includes(id)), ...ids])];
    return { order, hidden: [...new Set(parsed.hidden.filter((id) => ids.includes(id)))] };
  } catch { return null; }
}

export default function HomeSections({ sections, userId, initialLayout }: {
  sections: Section[];
  userId?: string;
  initialLayout?: string | null;
}) {
  const ids = useMemo(() => sections.map((section) => section.id), [sections]);
  const defaultLayout = useMemo<Layout>(() => ({ order: ids, hidden: [] }), [ids]);
  const [layout, setLayout] = useState<Layout>(parseLayout(initialLayout || null, ids) || defaultLayout);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (userId) return;
    try {
      const stored = localStorage.getItem("live_home_sections_v4_guest");
      if (stored) setLayout(parseLayout(stored, ids) || defaultLayout);
    } catch { /* preferences are optional */ }
  }, [userId, ids, defaultLayout]);

  const persist = async (next: Layout) => {
    setLayout(next);
    const raw = JSON.stringify(next);
    if (!userId) {
      try { localStorage.setItem("live_home_sections_v4_guest", raw); setSaved("Saved on this device."); }
      catch { setSaved("This browser could not store the preference."); }
      return;
    }
    setSaved("Saving preference…");
    try {
      const response = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ homeSections: next }) });
      if (!response.ok) throw new Error("sync failed");
      setSaved("Synced to your account.");
    } catch { setSaved("Your current view changed on this device, but could not be synced to your account."); }
  };

  const ordered = [...sections].sort((a, b) => layout.order.indexOf(a.id) - layout.order.indexOf(b.id));
  const move = (id: string, offset: number) => {
    const order = [...layout.order];
    const index = order.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void persist({ ...layout, order });
  };

  return <>
    <details className="live-customize">
      <summary><SlidersHorizontal size={16} aria-hidden="true" /><span>Customize home</span></summary>
      <div className="live-customize-panel">
        <div className="live-customize-heading">
          <div><strong>Make this home yours</strong><p>Hide sections or change their order. This does not change your search or notification data.</p></div>
          <button type="button" onClick={() => void persist(defaultLayout)} className="live-text-button">Reset</button>
        </div>
        <ul>
          {ordered.map((section, index) => {
            const hidden = layout.hidden.includes(section.id);
            return <li key={section.id}>
              <label><input type="checkbox" checked={!hidden} onChange={() => {
                const nextHidden = hidden ? layout.hidden.filter((value) => value !== section.id) : [...layout.hidden, section.id];
                void persist({ ...layout, hidden: nextHidden });
              }} /><span>{section.label}</span></label>
              <div className="live-reorder-actions">
                <button type="button" aria-label={`Move ${section.label} up`} disabled={index === 0} onClick={() => move(section.id, -1)}><ArrowUp size={15} /></button>
                <button type="button" aria-label={`Move ${section.label} down`} disabled={index === ordered.length - 1} onClick={() => move(section.id, 1)}><ArrowDown size={15} /></button>
              </div>
            </li>;
          })}
        </ul>
        <p className="live-preference-status" role="status" aria-live="polite">{saved}</p>
      </div>
    </details>
    <div className="live-home-sections">
      {ordered.filter((section) => !layout.hidden.includes(section.id)).map((section) => <div key={section.id} className="live-home-section">{section.node}</div>)}
    </div>
  </>;
}
