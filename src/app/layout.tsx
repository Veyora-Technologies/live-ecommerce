import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import OfflineSync from "@/components/OfflineSync";
import { getPublicBaseUrl } from "@/lib/public-url";

export const viewport: Viewport = { themeColor: "#0A0A0A", width: "device-width", initialScale: 1, viewportFit: "cover" };

const publicBaseUrl = getPublicBaseUrl();
const socialCardUrl = publicBaseUrl ? `${publicBaseUrl}/brand/live-social-card.png` : null;

export const metadata: Metadata = {
  ...(publicBaseUrl ? { metadataBase: new URL(publicBaseUrl) } : {}),
  title: "Live — Everything You Need. All in One Place.",
  description: "Search merchant listings and services, compare posted details, and check current availability before taking the next step.",
  manifest: "/manifest.json",
  applicationName: "Live",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Live — Everything You Need. All in One Place.",
    description: "Shop. Sell. Service. Grow. Explore merchant listings and services, then check the details before you act.",
    siteName: "Live",
    ...(socialCardUrl ? { images: [{ url: socialCardUrl, width: 1200, height: 630, alt: "Live — Everything You Need. All in One Place." }] } : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "Live — Everything You Need. All in One Place.",
    description: "Search merchant listings and services; compare posted details and check current availability.",
    ...(socialCardUrl ? { images: [socialCardUrl] } : {}),
  },
  appleWebApp: { capable: true, title: "Live", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const savedTheme = jar.get("live_theme")?.value;
  const theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system";

  return (
    <html lang="en" className="h-full" data-theme={theme} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {process.env.LIVE_DATA_MODE !== "production" && <div role="note" className="live-data-mode-notice">Sample data preview — merchant names, prices, availability, confirmations, and reviews may be test data. Do not rely on them for a purchase.</div>}
        {children}
        <OfflineSync />
      </body>
    </html>
  );
}
