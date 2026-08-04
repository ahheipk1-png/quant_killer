# AI agent handoff

> Documentation status: synchronized on 2026-08-04 from the 2026-08-03 full audit and 2026-08-04 focused regressions.

## Mission

Continue the QuantKiller local browser pricing library without overstating numerical or cross-language coverage. Preserve the existing local-only architecture, executable specifications, and deterministic comparison behavior.

## Workspace

```text
C:\Users\Michael Cheng\Documents\QuantKiller\wasm-mc-demo
```

The project is inside a parent working tree that may show the entire directory as untracked. Treat all existing files as user work. Do not run destructive Git commands or discard unrelated changes.

## Start here

1. Read `docs/README.md` and `docs/roadmap.md`.
2. Inspect `web/exotic-pricer.js`, `web/advanced-pricer.js`, `web/volatility-models.js`, and the relevant page controller before changing numerical methods.
3. Run the current tests before and after edits.
4. Serve `web/` through `serve.ps1`; do not test through `file:///`.

## Current verified implementation

- Vanilla European pricing in C++, Rust, Python, and C# with Black-Scholes, CRR, PCG MC, Sobol, randomized Sobol, variance controls, and distribution diagnostics where exposed by the vanilla contract.
- American vanilla in those four languages with CRR, Barone-Adesi-Whaley, Ju-Zhong, Carr randomization, and Bjerksund-Stensland 1993/2002.
- Twenty advanced payoff/effective-underlying families with JavaScript reference definitions and seeded advanced MC implementations in C++, Rust, Python, and C#.
- Constant, term, local, Heston, and SLV advanced path models with 84 pathwise limit checks.
- Asian Levy, shifted-lognormal, Curran, Curran two-moment, Ju order-six, ADI, MC, and QMC reference methods.
- American projected, PSOR, and penalty PDE methods in the JavaScript reference engine, with selectable payoff/Rannacher smoothing and uniform/strike-sinh/spot-sinh grids.
- Nonuniform-grid support across every current PDE payoff, including both Asian ADI axes.
- Generalized four-way compound options.
- Static variance-swap replication.
- Independent path-distribution page.
- Multi-deal local portfolio page with background batch pricing, local storage, totals, row errors, sample deals, and CSV export.
- Local volatility-surface lab with robust implied-volatility inversion; total-variance interpolation/repair; SVI, SSVI, SABR, Vanna-Volga, PCHIP, Dumas, Deschâtres CVI variance-spline QP, and separate convex-call fitting; static-arbitrage diagnostics; Dupire local volatility; a dense forward-PDE price round trip; and seeded particle SLV leverage calibration.
- Browser payoff/regression report and dedicated four-language conformance page.
- A dated whole-project audit with prioritized engineering/model-governance recommendations in `docs/project/review-2026-08-03.md`.

Most recently verified (complete run 2026-08-03; claim-bearing suites rerun 2026-08-04):

```text
portfolio-test.cjs: 5 representative deals passed
advanced-test.cjs: 75 direct payoff tests and 84 volatility-limit tests passed
pde-test.cjs: 2,342 assertions; 224 numerical matrix cases plus validation/integration checks passed
volatility-test.cjs: 598 focused calibration assertions passed, including 300 local-vol round-trip prices
payoff-tests.html contract: 182 checks (75 direct + 15 calibration + 92 pricing regressions)
four-language conformance: 8 seeded public results equal at 8 decimals
all seven HTML pages: loaded through http://127.0.0.1:8000 on 2026-08-03
documentation set: 25 Markdown files synchronized on 2026-08-04
```

Re-run rather than relying on this snapshot after any numerical edit.

## Known pending work

### American PDE and grids — completed in JavaScript

The requested projected, PSOR, and penalty methods, payoff/Rannacher smoothing, and nonuniform grids are implemented and exposed in the Exotic Lab. `pde-test.cjs` covers every current PDE payoff and the new American reductions. Remaining work would be duplication in compiled languages, adaptive grids, or broader Greek/convergence research.

### Brownian-bridge Sobol

General bridge-ordered QMC construction remains pending. Do not confuse it with `bridgeSurvival` in `web/exotic-pricer.js`, which is a barrier-crossing survival correction. Sequential Sobol dimensions are currently used in `web/advanced-pricer.js::simulatePath`.

### LSMC basis selection

`web/advanced-pricer.js::bermudanLsm` uses a fixed quadratic monomial basis. No UI selector for basis or degree exists.

### Release and calibration architecture

The highest-priority non-numerical work is a Git/release baseline, license,
standard test scripts/CI, and versioned schemas for deals, results, the packed
ABI, and calibrated surfaces. Calibration and SLV still run on the main thread,
and fitted Dupire/CVI surfaces are not yet injected into the four-language path
contract. Follow `docs/roadmap.md` and `docs/project/review-2026-08-03.md`.

## Numerical caveats to preserve

- The four-language exact-equality statement covers the conformance cases and eight-decimal public serialization, not every internal floating-point operation.
- Non-JavaScript advanced language choices currently expose MC only in `web/exotics.js::availableMethods`.
- Deterministic Sobol does not have a classical standard error.
- The schedule generator adjusts weekends only.
- Asian approximations/ADI and most formulas require constant Black-Scholes volatility; MC/QMC is used for term/local/Heston/SLV.
- Portfolio pricing is batched in one Worker. It is non-blocking but currently processes rows sequentially inside that worker.
- CVI intentionally locks maturity interpolation to linear total variance so its intermediate-maturity constraints and evaluated surface coincide.
- PCHIP variance is an exact interpolator, not an arbitrage-free fit; the dense sample currently reports two butterfly flags.
- Convex-call nodal slope/bound tests are authoritative for that piecewise price-space method; smooth total-variance derivatives react to its kinks.
- The development server disables caching for the approximately 47 MiB web payload. Hosted assets need immutable content hashing.

## Commands

Start server:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Core validation:

```powershell
node .\smoke-test.cjs
node .\exotic-test.cjs
node .\advanced-test.cjs
node .\pde-test.cjs
node .\path-distribution-test.cjs
node .\pricing-regression-test.cjs
node .\portfolio-test.cjs
node .\volatility-test.cjs
```

C++ rebuild:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

If `node` is not on `PATH` in the Codex desktop environment, a bundled Node executable is typically available under:

```text
C:\Users\Michael Cheng\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
```

## PDE implementation landmarks

- `web/exotic-pricer.js`: grid construction, unequal-spacing coefficients, smoothing, projected/PSOR/penalty solves, diagnostics, and one-factor dispatch.
- `web/advanced-pricer.js`: unequal-grid bilinear interpolation and Asian ADI axes.
- `web/exotics.html` / `web/exotics.js`: American product and PDE controls.
- `pde-test.cjs`: focused numerical contract.
- `web/volatility-models.js`: quote inversion, CVI/other surface fitting, diagnostics, Dupire, forward-PDE round trip, and SLV calibration.
- `web/volatility.html` / `web/volatility-lab.js`: volatility calibration page.
- `volatility-test.cjs`: focused calibration contract.

When extending this code, preserve intrinsic/European lower bounds, cross-solver agreement, monotone grid construction, formula/tree reductions, and the distinction between JavaScript PDE coverage and compiled-language MC coverage.
