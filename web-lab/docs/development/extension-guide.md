# Extension guide

> Documentation status: synchronized with the current five-language integration points on 2026-08-04.

## Add a payoff

1. Define the payoff and boundary conventions in a focused function.
2. Add direct unit cases to the executable payoff report.
3. Add the product label, description, available methods, and form fields.
4. Add the pricing dispatch in the JavaScript reference engine.
5. Add at least one reduction or independent benchmark.
6. If the product uses the shared advanced MC contract, assign a product code and update parameter packing in every language.
7. Add volatility-limit and cross-language tests.
8. Update the corresponding file under `docs/payoffs/`.
9. Update `docs/models/`, `docs/interface/`, validation counts, roadmap/handoff scope, and the root README when the new capability changes those claims.

Primary integration points:

- `web/exotic-pricer.js`: foundational products and methods.
- `web/advanced-pricer.js`: extended path payoffs and models.
- `web/exotics.js`: labels, fields, method notes, and UI filtering.
- `web/polyglot-contract.js`: packed ABI.
- `src/advanced_pricer.cpp`, `rust-engine/src/advanced.rs`, `web/python/advanced_pricer.py`, `csharp-engine/AdvancedPricer.cs`: compiled-language parity.

## Add a deterministic method

- Keep method names stable and lowercase with hyphens.
- Add the method to the relevant `PRODUCT_METHODS` entry.
- Reject unsupported volatility models explicitly.
- Return the standard result shape: `price`, `standardError`, `standardDeviation`, `samples`, plus elapsed time/configuration from the outer dispatcher.
- Add a method note and workload label in the interface.
- Benchmark against a genuinely independent implementation.

## Add a path-model parameter

Changing the packed path contract is high risk. Update:

1. `web/polyglot-contract.js` header position and packing.
2. JavaScript normalization/simulation.
3. C++ parameter access.
4. Rust parameter access.
5. Python parameter access.
6. C# parameter access.
7. Four-language conformance cases.

Use an unused header position; do not silently repurpose an existing slot. Keep schedules within the contract's maximum size.

The current header has 64 numeric slots followed by up to 260 schedule values
and no explicit ABI version. Until a generated versioned schema is introduced,
every contract change must remain additive and be validated in all languages.

## Add a page

Reuse `styles.css`, the common lab navigation, and the existing panel/field patterns. Expensive calculations belong in a worker. Link the new page from every lab navigation and add a static asset test.

## Add a calibration method

- State whether the fit is per-expiry or joint-expiry and what is interpolated in maturity.
- Accept or reject price, mid-IV, and bid/ask-IV inputs explicitly.
- Keep fit constraints separate from the independent diagnostic grid.
- Add synthetic recovery, static-arbitrage, boundary, and noisy-data tests.
- If extracting local volatility, add price-space forward-PDE round trips rather than checking only implied-volatility derivatives.
- Label research approximations and third-party-paper alignment without implying bit-for-bit reproduction of an external implementation.

## Numerical implementation checklist

- Validate domains before computation.
- State continuous/discrete monitoring conventions.
- Treat equality at strikes/barriers consistently.
- Preserve deterministic seeds.
- Report whether uncertainty is statistical, empirical across randomizations, or unavailable.
- Test grid/time/path convergence rather than only a single resolution.
- Separate source changes from generated artifacts and rebuild explicitly.
