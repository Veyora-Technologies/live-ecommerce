# Live — Merchant Guide

1. **Create account**: Sign up, then “Merchant console” → Create store (name, area, address, phone) → Pending approval
2. **Approval**: Admin verifies phone/address; you’ll see Verified badge when approved
3. **Add products**: Products tab → Add product (name, price in NGN, stock, threshold) → stock updates create availability events
4. **Update stock quickly**: Products list → “Update stock: 12” → type new number → saved with confirmation; target <30s
5. **Manage reservations**: Reservations tab → Pending shows new orders → Confirm (holds stock) or Reject (releases) → Mark ready → Mark collected (deducts stock)
6. **Store status**: Top bar toggle Open/Closed; affects search “Open now” filter but not individual product stock
7. **Low stock**: Overview shows items ≤ threshold; restock and update
8. **Offline**: if no internet, edits queue locally (when implemented) and sync when back; never overwrites newer data silently

Tips: keep `lastConfirmedAt` fresh by updating stock; inaccuracy hurts reliability score. Verification required for payments (future).

Support: in-app notifications + reports; admin resolves disputes.
