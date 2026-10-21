# Performance and capacity plan — V9

**Status:** Local sequential smoke evidence exists. No real-user field metrics, mobile-device benchmark, PostgreSQL load run, or capacity claim exists.

## Web performance objectives

Use the following Core Web Vitals targets at the 75th percentile after real-user measurement is available:

- LCP ≤ 2.5 seconds.
- INP ≤ 200 milliseconds.
- CLS ≤ 0.1.

These are release objectives, not current results. The repository has no configured real-user measurement/analytics provider, so V9 cannot report p75 Core Web Vitals. Do not add analytics until privacy, consent, retention, and vendor setup are approved.

## API objectives for initial staging validation

Provisional targets for a low-volume, single-region pilot test (not a service commitment):

- Search/catalog read p95 ≤ 750 ms.
- Product/merchant detail read p95 ≤ 500 ms.
- Authenticated reservation submit p95 ≤ 1,000 ms, excluding deliberately contended requests.
- Non-contention server error rate < 1% during the sustained profile.
- Zero oversold units; every intentional stock race has one valid winner and one safe conflict.
- Keep connection-pool usage below 70% of the configured provider limit; avoid growing job backlog.

Revisit these budgets with the product owner and hosting/database provider before launch.

## Provisional load-test profile (assumption, not validated capacity)

No owner traffic forecast, hosting plan, database tier, region, or spend limit has been supplied. For a first isolated staging test, use this conservative starting profile and revise it after infrastructure is selected:

- 50 concurrent virtual users.
- 20 read requests/second sustained for 15 minutes.
- Up to 2 reservation submissions/second with mixed available, stale, and intentionally contended stock.
- A separate 60-second burst at 2× the read/write rates.
- Representative catalogue, merchant, batch, variant, branch, user, and reservation records.
- A PostgreSQL staging database with the same pool/instance limits planned for the pilot; never use live production stock for a load test.

The profile is a starting acceptance-test workload, not an assertion that the current app can sustain it. No k6/Locust or other load test was executed. The available SQLite sandbox is not an appropriate PostgreSQL capacity target.

## V9 local production-build smoke

Next.js 16.4.2 production build under Node 24.22.0 on the sandbox, demo-seeded SQLite fixture, loopback HTTP client. Five warm-ups followed by 30 sequential measured GETs per endpoint; all 35 requests per endpoint returned 200:

| Endpoint | p50 | p95 | max |
|---|---:|---:|---:|
| `/api/v1/health` | 2.5 ms | 3.6 ms | 5.2 ms |
| `/api/v1/search?q=paracetamol` | 11.4 ms | 13.0 ms | 14.9 ms |

These timings include neither real user devices nor real networks and do not measure concurrency, throughput, saturation, browser rendering, PostgreSQL, or external providers. They must not be compared directly to the staging targets as proof of capacity.

## Measurement and scale-up sequence

1. Select provider, region, app/database sizes, pool settings, CDN, and a budget.
2. Add privacy-reviewed real-user performance instrumentation and alerting.
3. Run the documented sustained/burst mix against isolated PostgreSQL with realistic data.
4. Capture latency percentiles, error rate, query plans, database connections, CPU, memory, I/O, queue depth, and inventory outcomes.
5. Fix the measured bottleneck before adding cache/search/worker infrastructure.
6. Repeat after material releases and raise the target only with evidence.

No “millions of users”, horizontal-scaling, uptime, or fixed RPS capacity claim is supported today.
