import Image from "next/image";

export type BrandLogoVariant =
  | "horizontal"
  | "inverse"
  | "compact"
  | "compact-inverse"
  | "monochrome"
  | "monochrome-inverse"
  | "symbol"
  | "symbol-inverse"
  | "symbol-monochrome"
  | "wordmark";

type BrandLogoProps = {
  variant?: BrandLogoVariant;
  width?: number;
  height?: number;
  className?: string;
  decorative?: boolean;
  priority?: boolean;
};

const assets: Record<BrandLogoVariant, { src: string; width: number; height: number }> = {
  horizontal: { src: "/brand/live-logo-horizontal.svg", width: 330, height: 100 },
  inverse: { src: "/brand/live-logo-horizontal-inverse.svg", width: 330, height: 100 },
  compact: { src: "/brand/live-logo-horizontal-compact.svg", width: 290, height: 100 },
  "compact-inverse": { src: "/brand/live-logo-horizontal-compact-inverse.svg", width: 290, height: 100 },
  monochrome: { src: "/brand/live-logo-horizontal-mono.svg", width: 330, height: 100 },
  "monochrome-inverse": { src: "/brand/live-logo-horizontal-mono-inverse.svg", width: 330, height: 100 },
  symbol: { src: "/brand/live-symbol.svg", width: 100, height: 100 },
  "symbol-inverse": { src: "/brand/live-symbol-inverse.svg", width: 100, height: 100 },
  "symbol-monochrome": { src: "/brand/live-symbol-mono.svg", width: 100, height: 100 },
  wordmark: { src: "/brand/live-wordmark.svg", width: 200, height: 76 },
};

/** Shared local SVG identity. Use inverse variants only on genuinely dark surfaces. */
export default function BrandLogo({
  variant = "horizontal",
  width,
  height,
  className,
  decorative = false,
  priority = false,
}: BrandLogoProps) {
  const asset = assets[variant];
  return (
    <Image
      src={asset.src}
      alt={decorative ? "" : "Furnivo"}
      aria-hidden={decorative ? true : undefined}
      width={width ?? asset.width}
      height={height ?? asset.height}
      className={className}
      priority={priority}
      unoptimized
    />
  );
}
