import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

const footerLinks = [
  { href: "/search", label: "Discover" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/services", label: "Services" },
  { href: "/merchant", label: "Seller workspace" },
  { href: "/legal", label: "Policies" },
  { href: "/privacy", label: "Privacy" },
];

export default function BrandFooter() {
  return (
    <footer className="live-footer">
      <div className="live-wrap live-footer-inner">
        <div className="live-footer-brand">
          <Link href="/" aria-label="Furnivo home" className="live-footer-logo-link">
            <BrandLogo variant="inverse" width={148} height={45} decorative />
          </Link>
          <p className="live-footer-tagline">Shop · Sell · Grow</p>
          <p className="live-footer-note">More than a marketplace. It&rsquo;s your next move.</p>
        </div>
        <nav className="live-footer-links" aria-label="Footer">
          {footerLinks.map(({ href, label }) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className="live-footer-bottom">
          <span>Furnivo · Nigeria</span>
          <span>Listing information is supplied by merchants and can change. Check details before making a decision.</span>
        </div>
      </div>
    </footer>
  );
}
