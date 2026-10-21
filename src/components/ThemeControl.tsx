"use client";

import { useEffect, useState } from "react";
import { MonitorCog, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";
const normalizeTheme = (value?: string | null): Theme => value === "light" || value === "dark" ? value : "system";

export default function ThemeControl({ userId, initialTheme }: { userId?: string; initialTheme?: string | null }) {
  const [theme, setTheme] = useState<Theme>(() => normalizeTheme(initialTheme));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.cookie = `live_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [theme]);

  const save = async (value: Theme) => {
    if (saving) return;
    const previous = theme;
    setError("");
    setTheme(value);
    if (!userId) return;
    setSaving(true);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Preference was not saved to your account.");
    } catch (cause) {
      setTheme(previous);
      setError(cause instanceof Error ? cause.message : "Preference was not saved to your account.");
    } finally { setSaving(false); }
  };

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : MonitorCog;
  return (
    <details className="live-theme-menu">
      <summary className="live-icon-button" aria-label={`Appearance: ${theme}`} title={`Appearance: ${theme}`}>
        <Icon size={18} aria-hidden="true" />
      </summary>
      <div className="live-theme-popover" role="group" aria-label="Choose appearance">
        {(["system", "light", "dark"] as const).map((value) => (
          <button key={value} type="button" disabled={saving} aria-pressed={theme === value} onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            void save(value);
          }}>
            {value === "system" ? <MonitorCog size={16} aria-hidden="true" /> : value === "light" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            <span>{value === "system" ? "System" : value === "light" ? "Light" : "Dark"}</span>
            {theme === value && <span className="live-theme-current">Current</span>}
          </button>
        ))}
        {saving && <p className="live-theme-error" role="status">Saving appearance…</p>}
        {error && <p className="live-theme-error" role="alert">{error}</p>}
      </div>
    </details>
  );
}
