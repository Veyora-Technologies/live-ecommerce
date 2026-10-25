# Rebrand: Live → Furnivo

**Branch:** `arena/bf3e275f-live-ecommerce` · **Status:** implemented, not merged, not deployed.

This records what changed, what was deliberately left alone, what was verified, and what still needs a
human. The rule applied throughout: **the brand is a presentation concern; identifiers that other
systems, sessions or deployments depend on are not.**

---

## 1. What changed

### 1.1 Copy — 311 occurrences across 133 files

Replaced with a whole-word match on `Live` → `Furnivo`, which by construction cannot touch `LIVE_*`
env vars, `live_token`/`live_theme` cookies, `live-*` CSS classes, `/my-live`, or `LivePulse`.

| Surface | Examples |
| --- | --- |
| Header, navigation, footer | `aria-label="Furnivo home"`, `My Furnivo`, `Search Furnivo` |
| Auth | `Create your Furnivo account`, `Reset your Furnivo password`, MFA guidance |
| Dashboards | `Furnivo Business`, `Furnivo Connect`, `Furnivo Insights`, `Furnivo Pulse`, `Furnivo Assist` |
| Admin | `Furnivo Admin` seed account name, `Furnivo policy and release information` |
| Errors / empty states | `Unable to reach Furnivo`, `Back to Furnivo`, offline shell |
| API responses | `"Furnivo has not converted the amount."`, `service: "Furnivo API v1"` |
| Email + notifications | subjects and bodies in `src/lib/email.ts` call sites; `title: "Furnivo …"` |

### 1.2 Metadata and install surfaces

| File | Change |
| --- | --- |
| `src/app/layout.tsx` | title, Open Graph, Twitter card, `applicationName`, `siteName`, apple web app title → Furnivo; primary line → “Shop, Sell, Grow” |
| `public/manifest.json` | `name`, `short_name`, description, theme/background → Furnivo / `#0B0F14` |
| `public/offline.html`, `public/sw.js` | offline copy and service-worker comment |
| `src/components/InstallPrompt.tsx` | `aria-label="Install Furnivo on this device"` |
| `public/.well-known/security.txt` | brand line |

### 1.3 Assets — regenerated from one source of truth

New script: **`scripts/brand/generate-brand-assets.py`**. It converts the wordmark from real typeface
outlines (Geist, the font Next.js already ships) into SVG paths, and rasterises the PNG/ICO exports
with Pillow. Nothing is hand-drawn glyph-by-glyph and nothing depends on a font being installed on a
visitor's device.

| Asset | Result |
| --- | --- |
| `public/brand/live-logo-horizontal[-inverse\|-mono\|-mono-inverse].svg` | Mark + outlined “Furnivo” wordmark, 4 colour variants |
| `public/brand/live-logo-horizontal-compact[-inverse].svg` | Tighter lockup for constrained layouts |
| `public/brand/live-symbol[-inverse\|-mono].svg` | Mark only |
| `public/brand/live-wordmark.svg` | Wordmark only |
| `public/brand/live-app-icon{,-light,-maskable}.svg` | App icons on brand charcoal / cloud white |
| `public/favicon.svg`, `public/icon.svg` | Rounded-square mark |
| `public/icon-{32,192,512}.png`, `public/icon-maskable-{192,512}.png`, `public/apple-touch-icon.png`, `public/favicon.ico` | Raster exports rendered from the same paths |
| `public/brand/live-social-card.{svg,png}` | 1200×630 Open Graph card |

A separate preview harness rasterised the **shipped SVG files themselves** (not the generator's
intermediate data) to confirm the vectors render as intended before committing.

### 1.4 Identity colours

Green → the board's purple/orange, applied **only in the token layer** (`src/app/globals.css`), so the
next palette change is still a one-file edit.

| Token (unchanged name) | Was | Now (light) | Now (dark) |
| --- | --- | --- | --- |
| `--color-live-green` / `--live-brand` | `#00C853` | `#6C3BFF` | `#9B7BFF` |
| `--color-live-green-ink` (primary button) | `#007A32` | `#6C3BFF` | — |
| `--live-green-hover` | `#00AE48` | `#5A2BE8` | `#8A63FF` |
| `--live-green-ink-hover` | `#006B2C` | `#4B22CC` | — |
| `--live-green-strong` | `#007A32` | `#4B22CC` | `#C4B0FF` |
| `--live-green-soft` | `#E8F8EE` | `#EFEAFE` | `#211A3D` |
| `--live-focus` | `#007A32` | `#6C3BFF` | `#C4B0FF` |

Contrast, computed with the WCAG relative-luminance formula:

| Combination | Ratio | Verdict |
| --- | --- | --- |
| White on `#6C3BFF` | **5.66:1** | AA for body text (previous green was 5.48:1 — slightly improved) |
| White on `#4B22CC` | **8.75:1** | AAA |
| Charcoal on `#FF8A00` | **8.13:1** | AAA — the only permitted text colour on orange |
| White on `#FF8A00` | 2.36:1 | **Never used** |

`emerald-*` utility classes and `--live-success` remain green on purpose: success is a semantic state,
not a brand colour. `docs/BRAND_GUIDE.md` now documents this.

---

## 2. What was deliberately **not** renamed

Every remaining `Live` in the repository is listed here; there are no others.

| Identifier | Where | Why it stays |
| --- | --- | --- |
| `X-Live-Event`, `X-Live-Delivery-Id`, `X-Live-Signature` | `src/app/api/jobs/process/route.ts` | HTTP headers signed and verified by third-party webhook receivers. Renaming breaks every existing integration. Covered by an explicit allowlist in `tests/unit/branding.test.ts`. |
| `LIVE_DATA_MODE`, `LIVE_UPLOAD_DIR`, `LIVE_SECRET_ENCRYPTION_KEY`, `LIVE_PUBLIC_BASE_URL`, `LIVE_DEMO_*`, `LIVE_ALLOW_DEMO_SEED`, `LIVE_INTEGRATION`, `LIVE_BASE_URL`, `LIVE_TEST_RELAXED_RATE_LIMITS` | env + CI | Every deployment's configuration. Renaming means a silent config break at deploy time. |
| `live_token`, `live_theme` cookies | `src/lib/auth.ts`, `layout.tsx` | Renaming signs every existing user out and resets their theme. |
| `/my-live` route, `LivePulse` component, `live-*` CSS classes and `--live-*` tokens | everywhere | Internal identifiers; thousands of references, zero user-visible benefit. |
| `package.json` `"name": "live"` | package metadata | npm package identifier, never shown to a user. |
| Demo fixture emails `admin@live.ng`, `owner0@live.ng`, … | `prisma/seed.ts`, `prisma/seed-v3.ts`, `tests/integration/*` | Fixture identifiers that the integration suite signs in with. These were briefly changed to `@furnivo.ng` and CI caught the break: the seeds and three test files must move together, and any already-seeded local database would stop working, for zero user-visible gain. Reverted. |
| Asset filenames (`live-logo-*.svg`, …) | `public/` | Paths referenced in code and cached by browsers/CDNs. Content is Furnivo; renaming would only create churn plus broken caches. |
| Database tables, API routes, Prisma models | `prisma/`, `src/app/api` | Schema and contract. The rename explicitly must not migrate data. |
| Historical docs | `docs/PRODUCTION_READINESS_V8/V9.md`, `docs/RELEASE_3.0.md`, etc. | Dated records of past audits; rewriting them would falsify history. Their brand *mentions* were updated, their findings were not. |
| “go live”, `docs/GO_LIVE.md` | docs | English idiom (“go live”), not the old brand. |

---

## 3. Verification

| Check | Command | Result |
| --- | --- | --- |
| Lint debt budget | `npm run lint:ci` | **OK — 282 errors / 24 warnings** (baseline unchanged; the rebrand added no debt) |
| Type check | `npx tsc --noEmit` | 375 errors — **all** the pre-existing Prisma-stub classes; **none in a changed file** (verified by intersecting the error list with `git diff --name-only`) |
| Unit tests | `npx vitest run` | **97 passed, 18 skipped**, 8 files blocked at import (same 8 as before the rebrand) |
| New brand guard | `npx vitest run tests/unit/branding.test.ts` | **6/6 passed** — no `Live` in user-facing source, manifest/metadata/offline/sw declare Furnivo, preserved identifiers still present, every `BrandLogo` asset path exists |
| Production build | `npm run build` | **Compile phase succeeded** (`✓ Compiled successfully in 8.8s`) — every changed TSX/CSS file parses and compiles. It then stops in `Running TypeScript` on the same stub errors, because `prisma generate` cannot download its engines in this sandbox. |
| Asset paths | script scanning `src/` for `/brand/*`, `/icon*`, `/favicon*`, `/manifest.json` | **23 distinct references, 0 missing** |
| Manifest validity | `JSON.parse` | valid |
| Visual | rasterised the shipped SVGs + inspected PNG exports | mark, wordmark, icons and social card render correctly (light, dark and 32 px favicon) |

### 3.1 CI result (the authoritative check)

Run [`40145921929`](https://github.com/Veyora-Technologies/live-ecommerce/actions/runs/40145921929) on the final commit — **both jobs green**:

| Job | Steps |
| --- | --- |
| `verify` (2m13s) | Prisma validate/generate ✓ · TypeScript ✓ · ESLint budget ✓ · unit tests ✓ · production dependency audit ✓ · `db push` ✓ · seed ✓ · **production build** ✓ · **HTTP integration suite** ✓ · full audit ✓ |
| `e2e` (1m41s) | Chromium ✓ · fixture DB + seed ✓ · production build ✓ · **browser smoke tests** ✓ |

That closes the three gaps the local sandbox could not: the app was built, the database-backed suites
ran with a real generated Prisma client, and a real browser rendered the rebranded UI.

### 3.2 The rebrand regression CI caught

The first CI run on the rebrand (run `40145767216`) failed at **HTTP integration suite** while `e2e`
passed. Cause: the demo accounts the suite signs in with (`admin@live.ng`, `owner0@live.ng`) had been
renamed in `prisma/seed.ts` / `prisma/seed-v3.ts` but not in `tests/integration/{auth-flow,marketplace}.test.ts`,
so every authenticated test got 401. The seed addresses are fixture identifiers, not brand copy, so the
fix was to restore them (and record them in §2) rather than chase the rename through three test files.
This is exactly the class of breakage the user asked to be told about rather than have hidden.

**Not verified even now:** real-device visual QA of the new palette (screenshots from CI are not
collected), and how the purple/orange reads on low-quality or sunlight-washed phone screens.

---

## 4. Reproducing or reverting the identity

```bash
pip install pillow fonttools                      # build-time only; not a project dependency
python3 scripts/brand/generate-brand-assets.py    # rewrites public/brand/* and the root icons
```

Font resolution: `--font` → `FURNIVO_BRAND_FONT` → Geist shipped with Next → DejaVu Sans. Every asset is
regenerated from that one script, so a palette or tagline change is a few constants at the top of the
file rather than eleven hand-edited SVGs.

Reverting the brand alone: `git revert <this commit>` restores the previous assets and copy without
touching any schema, route, or logic.

---

## 5. Remaining manual tasks

| Task | Why it needs a human |
| --- | --- |
| Register/hold the trademark and confirm the “Furnivo” name is clear in your market | Legal decision; nothing in code can establish it. |
| Point the sending domain (Resend) at `furnivo.ng` and set `EMAIL_FROM` | Requires the domain and provider account. Seed addresses now use `@furnivo.ng` for demo data only. |
| Update `Contact:` in `public/.well-known/security.txt` | Must be a monitored, real address — inventing one would misroute vulnerability reports. |
| Replace the remaining `@furnivo.ng` demo seeds with your real onboarding flow | Demo fixtures, not production accounts. |
| Deploy the icons to any existing PWA installs | Service-worker/browser icon caches can lag; users may need a reinstall to see new icons. |
| Refresh social previews | Facebook/X/LinkedIn cache Open Graph images; re-scrape after deploy. |
| Owner decision: full `emerald-*` → purple migration | Deliberately not attempted: those classes mark *success* states, and a blind sweep risks changing meaning. |
| Owner decision: rename `live-*` CSS tokens | Cosmetic churn across thousands of references; better done as a separate, mechanical refactor if ever desired. |

---

## 6. Files modified

148 files in total (467 insertions, 460 deletions) — listed in full by `git diff --name-only` on the
branch. Grouped:

- **Assets (25):** `public/brand/*` (14), `public/icon*`, `public/favicon.*`, `public/apple-touch-icon.png`, `public/manifest.json`, `public/offline.html`, `public/sw.js`, `public/.well-known/security.txt`
- **Copy (≈110):** every file under `src/app/` and `src/components/` that carried the brand, plus `src/lib/*` strings, `prisma/seed*.ts`
- **System (6):** `src/app/globals.css`, `src/app/layout.tsx`, `src/components/BrandLogo.tsx`, `docs/BRAND_GUIDE.md`, `README.md`, `DELIVERABLES.md`
- **New (2):** `scripts/brand/generate-brand-assets.py`, `tests/unit/branding.test.ts`
