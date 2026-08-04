# Project overview

> Documentation status: synchronized on 2026-08-04; see `docs/testing/validation.md` for verification dates.

QuantKiller is a self-contained browser option-pricing laboratory. It demonstrates how pricing code written in JavaScript, C++, Rust, Python, and C# can execute on a client device without installing a native application and without sending deal terms to a pricing server.

## Main capabilities

- European calls and puts using Black-Scholes, CRR trees, Monte Carlo, Sobol QMC, and randomized Sobol QMC.
- American calls and puts using CRR, Barone-Adesi-Whaley, Ju-Zhong, Carr maturity randomization, and Bjerksund-Stensland 1993/2002.
- Exotic and path-dependent products including digitals, barriers, Bermudans, Asians, lookbacks, ladders, compound options, baskets, structured notes, and realized-volatility products.
- Constant, term, local, Heston, and stochastic-local volatility path models.
- Price-to-implied-volatility inversion and local SVI/SSVI, SABR, Vanna-Volga, CVI variance-spline QP, constrained convex-call, polynomial, Dupire/forward-PDE round-trip, and particle-SLV calibration tools.
- Independent path-distribution analysis without attaching a payoff.
- A local portfolio page that prices multiple positions in one background batch and aggregates their present values.
- Executable payoff, reduction, parity, duality, volatility-limit, and cross-language conformance reports.

## Design principles

1. **Local execution.** Pricing inputs remain in the browser. The HTTP server only serves static files.
2. **Responsive interface.** Pricing and large path simulations run in Web Workers; the small research calibration lab is currently synchronous.
3. **Executable definitions.** Payoff descriptions are tied to direct unit tests and numerical reductions.
4. **Deterministic comparison.** Seeded PCG streams and a packed cross-language contract allow reproducible engine comparison.
5. **Progressive numerical complexity.** Simple reductions and closed forms are retained alongside trees, PDE methods, MC, and QMC.
6. **Explicit scope.** Method availability, language coverage, tolerances, and sampled-versus-proven arbitrage claims are documented separately.

## Scope boundaries

This is a research and demonstration library, not a production risk system. It now provides local calibration experiments, but it does not provide market-data ingestion, curve bootstrapping, calibration governance, persistence on a server, authentication, distributed pricing, or production controls such as independent model approval and audit storage.

The Python and C# browser runtimes have larger initial downloads than the C++ and Rust WebAssembly engines. Once loaded, their workers are reused for the current page session.

The current `web/` payload is approximately 47 MiB. The development server uses
`no-store`; a hosted build should use fingerprinted immutable assets for the
large language runtimes. See the [whole-project review](review-2026-08-03.md)
for the prioritized production-hardening plan.

## Source-of-truth hierarchy

- Human-facing behavior: files under `web/`.
- JavaScript reference analytics, path pricing, and calibration: `web/exotic-pricer.js`, `web/advanced-pricer.js`, and `web/volatility-models.js`.
- Cross-language packed simulation contract: `web/polyglot-contract.js`.
- Compiled implementations: `src/`, `rust-engine/src/`, `web/python/`, and `csharp-engine/`.
- Automated evidence: root-level `*-test.cjs` files and the browser test pages.
- Current numerical and delivery gaps: `docs/roadmap.md` and `docs/project/review-2026-08-03.md`.
