# Live browser-support policy

This is a **support target**, not a completed compatibility audit. No cross-engine or responsive browser run was performed in the current verification pass; previous workspace checks did not retain browser-engine/version metadata.

## Minimum support policy

For every supported deployment, support and test the **current stable and immediately preceding major release (N and N−1)** of:

| Platform | Required browser coverage | Minimum policy | Current evidence |
|---|---|---|---|
| Windows/macOS desktop | Chrome, Edge, Firefox | N and N−1 stable | Not run in this workspace |
| Android phones/tablets | Chrome; Firefox where offered/supported by the device | N and N−1 stable | Not run in this workspace |
| macOS | Safari on the two most recent macOS releases supported by Apple | Current Safari supplied by supported OS; test latest and prior supported OS | Not run in this workspace |
| iPhone/iPad | Safari on the two most recent iOS/iPadOS releases supported by Apple | Current Safari supplied by supported OS; test latest and prior supported OS | Not run in this workspace |

This policy excludes Internet Explorer and obsolete/unmaintained embedded WebViews. The testing owner must record exact browser and OS version numbers from actual test devices in the test evidence; the rolling N/N−1 policy avoids publishing stale fixed version numbers.

## Required fallbacks

- Voice search → ordinary text search.
- Device geolocation → manual location selection; do not replace a manually selected location silently.
- Native share → copy-link action.
- Camera/barcode discovery → ordinary search; neither scanning nor QR proves local stock, payment, or identity.
- Reduced-motion preference → usable non-animated state.
- Unsupported optional browser APIs → explicit unavailable state, never a dead control.

Essential authentication, discovery, reservation, merchant, and administration workflows must not depend on optional browser APIs.

## Compatibility test matrix

For every supported engine/device family, exercise registration/sign-in, session restoration, logout, direct protected-route access, search, product detail, location selection, forms, reservations, merchant inventory update, error/retry states, browser back/forward, refresh/deep links, keyboard/focus, responsive layouts, and failed-network recovery. Include at least 320px, 360px, 390px, 768px, 1024px, 1440px, and 1920px layouts; test mobile virtual-keyboard and safe-area behaviour on actual devices.

Automate cross-engine smoke tests with approved tooling once installed and available. Use actual Safari/iOS and Android devices when engine emulation is insufficient. A Chromium-only run is not cross-browser evidence.

## Current limitation

`@playwright/test` and a browser runner are not in the lockfile; `npm run test:e2e` currently fails with `playwright: not found`. No browser automation was available in this verification pass. Previous visual checks do not establish Chrome/Edge/Firefox/Safari compatibility. No compatibility or WCAG 2.2 AA conformance claim is made.
