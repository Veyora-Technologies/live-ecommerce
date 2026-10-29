# Furnivo — Prioritised Roadmap (post-2.0)

## Next release (highest value / lowest risk)
1. **Impression logging (privacy-safe)** → unlock honest search-appearance & conversion metrics in Insights (aggregate, k-anonymised).
2. **Saved-search alert delivery job** — periodic match check → in-app/email per preferences, with dedupe + `lastNotifiedAt`.
3. **Postgres migration + row-level locking** for multi-instance concurrency; keep SQLite for dev.
4. **Playwright in CI** (browser install) + throttled-network perf budget on a low-end Android profile.
5. **Branch-level inventory** — move stock ownership from merchant to branch once multi-branch merchants onboard.

## Following
6. Vision provider integration (candidates only) + barcode camera polish (torch, multi-code).
7. First POS adapter (one provider, read-only sync → then two-way with reconciliation UI).
8. Delivery partner pilot in one Abuja zone (partner-confirmed states only).
9. Paystack subscriptions (verify via webhook) + plan-limit enforcement on writes.
10. Demand forecasting *only after* 8–12 weeks of clean history; evaluate vs. current rule baseline before shipping any "prediction" label.

## Later / ecosystem
- Supplier integrations, sponsored discovery (labelled, relevance-gated, flag-controlled), second city (config-driven areas), local-language voice (Hausa/Yoruba/Igbo after provider accuracy testing), native wrappers if PWA limits bite.

## Explicit non-goals
- Fake engagement metrics, pay-to-rank availability, autonomous medicine substitution, multi-merchant "single order" theatrics, training on private search histories.
