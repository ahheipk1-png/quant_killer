# Architecture

> Documentation status: synchronized on 2026-08-04; see `docs/testing/validation.md` for verification dates.

## Runtime flow

```text
Browser page
  -> page controller
    -> dedicated Web Worker for pricing/path batches
       -> JavaScript reference engine, or
       -> C++/Rust WebAssembly, or
       -> Python/Pyodide, or
       -> C#/.NET WebAssembly
    -> main-thread research calibration for CVI/Dupire/SLV
    <- structured result/progress message or synchronous calibration result
  <- rendered price, diagnostics, charts, or test table
```

The supplied Python server is deliberately thin. It serves `web/` from `127.0.0.1`, assigns correct JavaScript/WebAssembly MIME types, and disables caching during development. It never receives pricing requests.

## Presentation layer

- `web/index.html` + `web/app.js`: vanilla and American lab.
- `web/exotics.html` + `web/exotics.js`: advanced payoff/model lab.
- `web/portfolio.html` + `web/portfolio.js`: multi-deal batch workspace.
- `web/path-lab.html` + `web/path-lab.js`: path-distribution analysis.
- `web/volatility.html` + `web/volatility-lab.js`: implied-volatility, surface, Dupire, and SLV calibration workspace.
- `web/payoff-tests.html` + `web/payoff-tests.js`: executable specification report.
- `web/polyglot-conformance.html` + `web/polyglot-conformance.js`: four-engine comparison.
- `web/styles.css` supplies the shared visual system; page-specific CSS extends it.

## Worker layer

Pricing batches and large path simulations are isolated from the UI thread.

- Vanilla: `pricer-worker.js`, `rust-worker.js`, `python-worker.mjs`, `csharp-worker.mjs`.
- Advanced pricing: `exotic-worker.js`, `advanced-cpp-worker.js`, `advanced-rust-worker.js`, `advanced-python-worker.mjs`, `advanced-csharp-worker.mjs`.
- Portfolio: `portfolio-worker.js` loops through deal tickets, reports progress, and returns per-deal success or errors.
- Distribution: `path-distribution-worker.js` runs the shared JavaScript path model without a payoff.

The current volatility fitter and the optional particle-SLV demonstrator run on the main thread. The sample workload is deliberately small; moving large calibration jobs into a dedicated worker is production-hardening work.

Workers communicate with plain structured-clone objects. Request IDs prevent stale results from replacing newer requests.

## Numerical layers

`web/exotic-pricer.js` contains foundational probability functions, Black-Scholes, barrier and compound formulas, the CRR Bermudan tree, one-factor PDE, basic GBM MC/QMC, payoff functions, and direct tests.

`web/advanced-pricer.js` builds on that foundation with volatility models, baskets, extended path payoffs, Asian approximations/ADI, generalized compound options, static variance replication, path-distribution simulation, and volatility-limit tests.

`web/volatility-models.js` is a separate UMD calibration library. It owns quote parsing, safeguarded implied-volatility inversion, maturity interpolation, smile/surface fits, the dense CVI quadratic program, arbitrage diagnostics, Dupire extraction, an independent strike-space forward PDE for price round trips, and seeded particle SLV leverage calibration. It builds on `web/exotic-pricer.js` for Black-Scholes prices but does not alter the packed four-language pricing ABI.

The compiled advanced engines intentionally share a compact parameter-array ABI. `web/polyglot-contract.js` owns the browser-side packing rules and schedule layout. Changing parameter positions requires coordinated changes in every language.

The current ABI is a fixed `Float64Array` with a 64-value header followed by up
to 260 schedule entries. It has no generated schema or explicit wire-version
field yet. A versioned source schema that generates constants and validators for
all languages is the recommended next contract change.

## Language implementations

| Language | Core source | Advanced source | Browser runtime |
|---|---|---|---|
| C++ | `src/pricer.cpp` | `src/advanced_pricer.cpp` | Emscripten WebAssembly |
| Rust | `rust-engine/src/lib.rs` | `rust-engine/src/advanced.rs` | WebAssembly |
| Python | `web/python/pricer.py` | `web/python/advanced_pricer.py` | Pyodide |
| C# | `csharp-engine/Pricer.cs` | `csharp-engine/AdvancedPricer.cs` | .NET WebAssembly |
| JavaScript | `web/exotic-pricer.js` | `web/advanced-pricer.js` | Native browser JavaScript |

The JavaScript reference engine currently has the broadest deterministic-method coverage. The four compiled advanced engines provide the shared seeded Monte Carlo contract. Do not infer that every JavaScript formula or PDE method is implemented in every language.

## Generated and bundled artifacts

- `web/pricer.js` and `web/pricer.wasm` are generated from the C++ sources.
- `web/rust-pricer.wasm` is generated from the Rust crate.
- Pyodide and .NET browser runtime directories under `web/` are bundled dependencies.
- Generated artifacts should be rebuilt from their source rather than manually edited.

## Deployment boundary

`serve.py` is a development server: it binds to loopback and sends `Cache-Control:
no-store`. It is intentionally not an internet-facing pricing service. A hosted
deployment should preserve local pricing while adding immutable hashed assets,
HTTPS, CSP, dependency notices, and appropriate cross-origin isolation headers.
