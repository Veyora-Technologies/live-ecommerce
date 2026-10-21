import type { MetadataRoute } from "next";
import { getPublicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/marketplace", "/product/", "/merchant/", "/legal"],
      disallow: ["/api/", "/admin/", "/auth/", "/profile/", "/cart/", "/activity/", "/my-live/", "/privacy/", "/complaints/", "/enquiries/", "/lists/", "/requests/", "/notifications/", "/search", "/*?*"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
