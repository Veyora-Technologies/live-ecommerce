# Live brand & interface reference

**Purpose:** implementation guide for the Live visual identity and shared UI tokens. The supplied concept board was used as direction; the production marks below are clean, independently drawn vector assets—not crops of the board. No ™ or ® is included.

![Live social preview artwork](../public/brand/live-social-card.png)

## Identity

- **Brand name:** Live
- **Primary line:** “Everything You Need. All in One Place.”
- **Supporting line:** “Shop. Sell. Service. Grow.”
- **Mark:** a custom geometric L/forward-play symbol with a separate wordmark. Use the supplied SVGs; do not substitute emoji, the concept-board image, or a hand-built CSS approximation.
- The line is brand positioning, not a statement that every marketplace category or regulated workflow is currently enabled. The product must continue to show only workflows that are actually ready.

## Palette

| Token | Value | Intended use |
| --- | --- | --- |
| Live Green | `#00C853` | Brand accents, primary highlight, indicators on dark surfaces; pair with deep-black text on a green fill. |
| Deep Black | `#0A0A0A` | Logo/wordmark, dark surfaces, high-contrast controls. |
| Slate Gray | `#6B7280` | Secondary neutral reference; use darker `--live-muted` for small copy where needed. |
| Light Gray | `#F3F4F6` | Main light-theme canvas. |
| White | `#FFFFFF` | Raised surfaces and reverse marks. |
| Accessible green ink | `#007A32` | Links, compact green text, and controls requiring white text on green. |
| Accessible green hover | `#006B2C` | Hover for dark-green controls with white text. |

**Contrast rule:** do not place white small text on `#00C853`; its contrast is 2.24:1. Use black text on the bright-green fill (8.85:1), or use `#007A32` with white text (5.48:1). These ratios are calculated from the listed hex values; they are not a full WCAG audit. Keep success, warning, danger, and info colors distinct from brand green; they are semantic state, not alternate logo colors.

The core values are centralized in `src/app/globals.css` and its Tailwind 4 `@theme` block. Existing component/page code should use the `live-*` tokens/utilities rather than introducing new palette literals. Light/dark surface, text, muted, borders, focus, spacing, size, radii, shadows, motion, breakpoints, and layer tokens live in the same stylesheet.

## Logo asset directory

All paths below are relative to `public/` and are available at the matching site URL.

| Asset | Use |
| --- | --- |
| `brand/live-logo-horizontal.svg` | Primary horizontal lockup for light surfaces. |
| `brand/live-logo-horizontal-inverse.svg` | Reverse lockup for dark/black surfaces. |
| `brand/live-logo-horizontal-compact.svg` | Tighter horizontal lockup for constrained light layouts. |
| `brand/live-logo-horizontal-compact-inverse.svg` | Tighter reverse lockup for constrained dark layouts. |
| `brand/live-logo-horizontal-mono.svg` | Single-color black lockup. |
| `brand/live-logo-horizontal-mono-inverse.svg` | Single-color white lockup on dark surfaces. |
| `brand/live-wordmark.svg` | Wordmark-only use where the symbol is already present. |
| `brand/live-symbol.svg` | Standalone symbol for light surfaces. |
| `brand/live-symbol-inverse.svg` | White symbol for dark surfaces. |
| `brand/live-symbol-mono.svg` | Black single-color symbol. |
| `brand/live-app-icon.svg` | Rounded app-icon source artwork. |
| `brand/live-app-icon-maskable.svg` | Full-bleed maskable icon artwork with centered safe-area mark. |
| `brand/live-app-icon-light.svg` | Light-background icon artwork. |
| `brand/live-social-card.svg` / `brand/live-social-card.png` | Share-card source and 1200×630 raster image; Open Graph/Twitter metadata points to it only when `LIVE_PUBLIC_BASE_URL` or `NEXT_PUBLIC_APP_URL` passes the existing public-HTTPS URL validation. |
| `favicon.svg`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `src/app/favicon.ico` | Browser, PWA, and Apple touch icons. |

Use the shared React wrapper from `@/components/BrandLogo` for UI. It supports horizontal, inverse, monochrome, symbol, and wordmark variants. Keep logos proportionally scaled; do not recolor, add effects, or place the inverse version on a light background.

```tsx
<BrandLogo variant="horizontal" decorative />
<BrandLogo variant="inverse" decorative />
```

The site header chooses the light/dark lockup from the active theme; the merchant workspace, admin, auth screens, footer, manifest, and metadata use the appropriate local assets. No remote font or logo CDN is required.

## Interface tokens & behavior

- Theme selection continues to use the existing `system`, `light`, and `dark` modes. Dark theme keeps deep black as its base and lifts surfaces in layers.
- Primary text, muted text, borders, and focus rings use theme variables. Focus stays visible; keep interactive hit areas at least 44px where possible.
- Shared spacing, typography, sizing, radii, shadows, focus, motion, breakpoints, and stacking levels are defined in `globals.css`/Tailwind `@theme`. Existing responsive layout rules are preserved and should be checked at 320px, 375px, 768px, 1024px, 1440px, and 1920px when the correct validation environment is available.
- Reduced-motion preferences remain respected by the shared stylesheet.
- Listing pages should retain their real category-specific fields, current data, and availability caveats. Do not invent stock, sellers, locations, ratings, payments, delivery events, analytics, or enabled categories for a visual example.
- Keep all visible controls connected to their existing routes/state/API. A visual refresh must not remove server-side authorization, legal/readiness gates, data privacy controls, or error states.

## Rights & verification note

The mark and social artwork are original vector compositions created for this workspace. This implementation does **not** establish trademark/domain availability, rights clearance, registration, or legal approval. Review with appropriate counsel before external brand launch. WCAG conformance, browser compatibility, Core Web Vitals, and production build status are not claimed by this guide; test them before release.
