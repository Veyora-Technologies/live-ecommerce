"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, Bookmark, BriefcaseBusiness, CircleUserRound, ClipboardList, Heart, Home, ListChecks, Menu, MessageCircle, Search, ShoppingBag, Store, X } from "lucide-react";
import ThemeControl from "@/components/ThemeControl";
import InstallPrompt from "@/components/InstallPrompt";
import BrandLogo from "@/components/BrandLogo";
import GeographyPicker, { type GeographyOption } from "@/components/GeographyPicker";

type HeaderUser = {
  id: string;
  name: string;
  role?: string;
  isAdmin?: boolean;
  preferredArea?: string | null;
  preferredLocationCode?: string | null;
  theme?: string | null;
};
const navItems = [
  { href: "/search", label: "Discover", icon: Search },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/compare", label: "Compare", icon: Activity },
  { href: "/requests", label: "Requests", icon: ClipboardList },
  { href: "/enquiries", label: "Messages", icon: MessageCircle },
  { href: "/lists", label: "Lists", icon: ListChecks },
  { href: "/services", label: "Services", icon: BriefcaseBusiness },
  { href: "/merchant", label: "For business", icon: Store },
];

export function Header({ user }: { user?: HeaderUser | null }) {
  const [q, setQ] = useState("");
  const [locationCode, setLocationCode] = useState(user?.preferredLocationCode || "");
  const [locationName, setLocationName] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const onLocationChange = (location: GeographyOption | null) => {
    setLocationCode(location?.code || "");
    setLocationName(location?.name || "All Nigeria");
  };


  const onSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!q.trim()) return;
    const params = new URLSearchParams({ q: q.trim() });
    if (locationCode) {
      params.set("locationCode", locationCode);
      params.set("scope", "admin");
    } else params.set("scope", "nationwide");
    router.push(`/search?${params.toString()}`);
    setOpen(false);
  };

  return (
    <header className="live-site-header sticky top-0">
      <div className="live-header-inner">
        <div className="live-header-row">
          <Link href="/" className="live-brand" aria-label="Furnivo home">
            <BrandLogo variant="horizontal" width={330} height={100} className="live-header-logo live-header-logo-light" decorative priority />
            <BrandLogo variant="inverse" width={330} height={100} className="live-header-logo live-header-logo-dark" decorative priority />
            <span className="live-brand-area">NIGERIA</span>
          </Link>

          <form onSubmit={onSearch} className="live-search-desktop" role="search">
            <Search size={18} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product, service or store" aria-label="Search Furnivo" />
            <button type="submit">Search</button>
          </form>

          <div className="live-header-actions">
            <div className="live-area-desktop"><GeographyPicker initialCode={user?.preferredLocationCode} userId={user?.id} persistPreference onSelectionChange={onLocationChange} /></div>
            <ThemeControl userId={user?.id} initialTheme={user?.theme} />
            <InstallPrompt />
            <Link className="live-header-icon" href="/my-live" aria-label="My Furnivo" title="My Furnivo"><Bookmark size={18} aria-hidden="true" /></Link>
            <Link className="live-header-icon live-plan-link" href="/cart" aria-label="Shopping plan" title="Shopping plan"><ShoppingBag size={18} aria-hidden="true" /></Link>
            {user ? (
              <Link href="/profile" className="live-user-link" aria-label={`Profile for ${user.name}`}>
                <span className="live-user-avatar" aria-hidden="true">{user.name?.trim()?.charAt(0)?.toUpperCase() || "L"}</span>
                <span className="live-user-name">{user.name?.split(" ")[0] || "Account"}</span>
              </Link>
            ) : (
              <Link href="/auth/login" className="live-sign-in">Sign in</Link>
            )}
            <button type="button" className="live-header-icon live-menu-trigger" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-controls="live-mobile-menu" aria-label={open ? "Close menu" : "Open menu"}>
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        <div className="live-mobile-search-row">
          <form onSubmit={onSearch} className="live-search-mobile" role="search">
            <Search size={17} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What are you looking for?" aria-label="Search Furnivo" />
            <button type="submit" aria-label="Search"><Search size={18} /></button>
          </form>
          <GeographyPicker initialCode={user?.preferredLocationCode} userId={user?.id} persistPreference compact onSelectionChange={onLocationChange} />
        </div>
        {locationName && locationName !== "All Nigeria" && <p className="live-area-notice">Search location: <strong>{locationName}</strong>. Change or clear it at any time.</p>}

        <nav className="live-desktop-nav" aria-label="Primary navigation">
          {navItems.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={pathname === href ? "is-active" : ""}>{label}</Link>
          ))}
          {user?.isAdmin && <Link href="/admin" aria-current={pathname === "/admin" ? "page" : undefined}>Admin</Link>}
        </nav>

        {open && <nav id="live-mobile-menu" className="live-mobile-menu" aria-label="More destinations">
          {[...navItems, { href: "/my-live", label: "My Furnivo", icon: Heart }, ...(user?.isAdmin ? [{ href: "/admin", label: "Admin", icon: CircleUserRound }] : [])].map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}><Icon size={18} aria-hidden="true" />{label}</Link>
          ))}
          {user ? <Link href="/profile/security" onClick={() => setOpen(false)}><CircleUserRound size={18} aria-hidden="true" />Account & security</Link> : <Link href="/auth/login" onClick={() => setOpen(false)}><CircleUserRound size={18} aria-hidden="true" />Sign in</Link>}
        </nav>}
      </div>
    </header>
  );
}

export function BottomNav({ pathname }: { pathname: string }) {
  const items = [
    { href: "/", label: "Home", Icon: Home },
    { href: "/search", label: "Search", Icon: Search },
    { href: "/activity", label: "Activity", Icon: Activity },
    { href: "/my-live", label: "Saved", Icon: Bookmark },
    { href: "/profile", label: "Account", Icon: CircleUserRound },
  ];
  return (
    <nav className="live-bottom-nav" aria-label="Main mobile navigation">
      {items.map(({ href, label, Icon }) => {
        const active = pathname === href || (href === "/search" && pathname === "/marketplace") || (href === "/my-live" && pathname === "/saved");
        return <Link key={href} href={href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}>
          <span className="live-bottom-nav-icon"><Icon size={20} strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" /></span>
          <span>{label}</span>
        </Link>;
      })}
    </nav>
  );
}
