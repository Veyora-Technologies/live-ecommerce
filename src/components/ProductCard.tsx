import Link from "next/link";
import { timeAgo } from "@/lib/utils";
import { DEFAULT_MARKET_CODE, getMarketConfiguration, getMarketCurrencyConfiguration } from "@/lib/market-config";
import { formatMinorAmount } from "@/lib/money";
import { Badge, AvailabilityDot } from "./ui";
import { availabilityConfidence, reservable } from "@/lib/confidence";
import ImageWithFallback from "@/components/ImageWithFallback";
import { merchantLocationLabel } from "@/lib/location-label";

export function ProductCard({ p, explanation }: { p: any; explanation?: string }) {
  const quantity = p.reservableQuantity ?? reservable(p.stockQuantity ?? 0, p.reservedQuantity ?? 0);
  const effective = p.effectiveAvailability || p.availability;
  const unavailable = quantity <= 0;
  const conf = unavailable
    ? { label: "Not reservable", tone: "grey" as const, explanation: "No unreserved, unrestricted quantity is available for a new reservation." }
    : availabilityConfidence({ ...p, availability: effective, stockQuantity: quantity, merchant: p.merchant });
  const tone = unavailable ? "grey" : effective === "IN_STOCK" ? "green" : effective === "LOW_STOCK" ? "amber" : effective === "OUT_OF_STOCK" ? "red" : "grey";
  const label = unavailable ? "Not reservable" : effective === "IN_STOCK" ? "In stock" : effective === "LOW_STOCK" ? "Low stock" : effective === "OUT_OF_STOCK" ? "Out of stock" : "Unknown";
  const locationLabel = p.branch ? `${p.branch.name} · ${merchantLocationLabel(p.branch)}` : p.merchant ? merchantLocationLabel(p.merchant) : "Location not yet coded";
  const storeStatus = p.branch?.storeStatus || p.merchant?.storeStatus;
  const marketCode = p.branch?.countryCode || p.merchant?.countryCode || DEFAULT_MARKET_CODE;
  const market = getMarketConfiguration(marketCode);
  const currencyCode = p.currency || market?.defaultCurrencyCode || "";
  const currency = market && getMarketCurrencyConfiguration(marketCode, currencyCode);
  const priceLabel = market && currency
    ? formatMinorAmount(p.price, currency.code, market.defaultLocale, currency.minorUnitExponent)
    : `${currencyCode || "Currency"} price unavailable`;

  return (
    <Link href={`/product/${p.id}`} className="live-product-card group">
      <div className="live-product-artwork">
        <ImageWithFallback src={p.imageUrl} alt={p.imageUrl ? p.name : ""} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" />
        <div className="absolute left-2 top-2"><Badge tone={tone as any}><AvailabilityDot status={unavailable ? "UNAVAILABLE" : effective} /> {label}</Badge></div>
        {p.merchant?.verificationStatus === "VERIFIED" && <span className="live-verified-tag">Verified</span>}
      </div>
      <div className="live-product-info">
        <div className="live-product-name">{p.name}</div>
        <div className="live-product-merchant">{p.merchant?.businessName} · {locationLabel}{p.distance !== null && p.distance !== undefined ? ` · ${p.distance} km straight-line` : ""}</div>
        <div className="live-product-price-row">
          <span className="live-product-price">{priceLabel}</span>
          <span className="live-product-quantity">{quantity} reservable</span>
        </div>
        <div className="live-product-meta">
          <Badge tone={conf.tone as any}>{conf.label}</Badge>
          <span>{p.lastConfirmedAt ? timeAgo(p.lastConfirmedAt) : "No confirmation time"}</span>
        </div>
        {explanation && <div className="live-product-explanation">{explanation}</div>}
        <div className="live-product-meta live-store-meta">
          <span className={`live-status-dot ${storeStatus === "OPEN" ? "is-open" : "is-closed"}`} />
          <span>{storeStatus === "OPEN" ? "Store marked open" : "Store marked closed"}</span>
          {p.pickupAvailable && p.merchant?.pickupAvailable && <span>· Pickup</span>}
        </div>
      </div>
    </Link>
  );
}

export function MerchantCard({ m }: { m: any }) {
  const branch = m.branches?.[0] || null;
  const locationLabel = branch ? `${branch.name} · ${merchantLocationLabel(branch)}` : merchantLocationLabel(m);
  const storeStatus = branch?.storeStatus || m.storeStatus;
  return (
    <Link href={`/merchant/${m.id}`} className="live-merchant-card">
      <ImageWithFallback src={m.imageUrl} alt={m.imageUrl ? m.businessName : ""} kind="merchant" className="live-merchant-image" />
      <div className="live-merchant-copy">
        <div className="live-merchant-name">{m.businessName}</div>
        <div className="live-product-merchant">{m.category} · {locationLabel}{(branch?.address || m.address) ? ` · ${branch?.address || m.address}` : ""}</div>
        <div className="live-merchant-meta">
          <span className={`live-status-pill ${storeStatus === "OPEN" ? "is-open" : "is-closed"}`}>{storeStatus === "OPEN" ? "Open" : "Closed"}</span>
          {m.verificationStatus === "VERIFIED" && <span className="live-status-pill is-verified">Verified merchant</span>}
        </div>
      </div>
    </Link>
  );
}
