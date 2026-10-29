"use client";

/**
 * Last-resort boundary: catches failures in the root layout itself, where
 * `error.tsx` cannot help because it renders *inside* that layout.
 *
 * Next replaces the whole document here, so the global stylesheet imported by
 * `app/layout.tsx` is not guaranteed to be applied. The few styles below are
 * therefore inline rather than Tailwind classes, so the screen stays legible
 * even when the app's CSS is exactly what failed to load.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const shell: React.CSSProperties = {
    minHeight: "100vh",
    margin: 0,
    padding: "2rem 1rem",
    background: "#F5F7FA",
    color: "#0B0F14",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  };
  const card: React.CSSProperties = {
    maxWidth: "32rem",
    margin: "0 auto",
    background: "#ffffff",
    border: "1px solid #E2E8F0",
    borderRadius: "1rem",
    padding: "1.25rem",
  };
  const button: React.CSSProperties = {
    minHeight: "2.75rem",
    borderRadius: "9999px",
    border: "none",
    background: "#0B0F14",
    color: "#ffffff",
    padding: "0 1.25rem",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <html lang="en">
      <body style={shell}>
        <div style={{ maxWidth: "32rem", margin: "0 auto" }}>
          <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#4B22CC" }}>
            Furnivo
          </p>
          <h1 style={{ margin: "0.25rem 0 0", fontSize: "1.75rem", fontWeight: 900 }}>
            The app could not start
          </h1>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.875rem", lineHeight: 1.6, color: "#334155" }}>
            A problem loading the page shell stopped Furnivo from rendering. Reloading usually fixes it. No order or
            payment is placed by loading a page.
          </p>
          <div style={{ ...card, marginTop: "1.5rem" }}>
            <button type="button" onClick={reset} style={button}>
              Reload
            </button>
            {error.digest ? (
              <p style={{ margin: "1rem 0 0", fontSize: "0.75rem", color: "#475569" }}>
                Reference for support: <code>{error.digest}</code>
              </p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}
