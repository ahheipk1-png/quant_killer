# Validation and executable specifications

> Documentation status: synchronized on 2026-08-04 with focused claim checks; the last complete Node/browser run was 2026-08-03.

## Test layers

The current suite has eight root-level Node entry points. On 2026-08-03 all
eight passed in one clean sequential run and all seven browser routes were
audited. On 2026-08-04 the advanced, PDE, pricing-regression, and volatility
suites were rerun to verify the numerical claims repeated across the updated
Markdown set.

### `smoke-test.cjs`

Loads the generated C++ WebAssembly module in Node and compares core European/American analytics, trees, sampling modes, variance controls, uncertainties, and distribution samples with the reference behavior.

### `exotic-test.cjs`

Checks the foundational JavaScript exotic payoff functions, reductions, methods, and browser report assets.

### `advanced-test.cjs`

Exercises 75 direct payoff cases across 20 payoff/effective-underlying families, 84 nested volatility-limit checks, Asian method comparisons, Carr parity, basket contracts, and C++/Rust advanced-engine comparisons.

### `path-distribution-test.cjs`

Checks distribution-session dimensions, seeded reproducibility, volatility-model reductions, basket series, moments, and page assets.

### `pde-test.cjs`

Runs 2,342 assertions, including 36 American solver/grid cases, 144 one-factor
payoff/grid/smoothing/damping cases, 36 two-axis Asian ADI cases on an uneven
schedule, 16 invalid-control paths, eight breached-barrier reductions, unequal-grid
operator identities, diagnostics, selector activation, and UI/worker wiring.

### `pricing-regression-test.cjs`

Runs the browser pricing regression module and verifies the expected matrix composition:

- 14 pricing identities/reductions,
- 4 European duality cases,
- 37 independent-method benchmarks,
- 13 PDE feature regressions covering every spatial grid, smoothing and damping branches,
  barrier boundary reductions, and uneven-schedule Asian ADI,
- 24 American duality cases.

### `portfolio-test.cjs`

Prices a representative five-deal portfolio containing vanilla, barrier, Bermudan, uneven Asian, and Phoenix positions. It also verifies portfolio page assets and navigation links.

### `volatility-test.cjs`

Runs 598 assertions over implied-volatility inversion and bounds, all maturity interpolators, calendar repair, SVI representations, synthetic SVI/SSVI/SABR/Dumas fits, Vanna-Volga anchors, CVI B-spline/QP constraints and matching maturity interpolation, separate convex-call slopes and bounds, all ten public fit methods, Dupire reductions and arbitrage flags, a 300-price dense local-vol forward-PDE round trip, seeded SLV calibration, browser unit rows, and page/navigation assets.

### Browser reports

- `payoff-tests.html` presents 182 executable checks: 75 direct payoff cases, 15 volatility-calibration reductions, and 92 pricing regressions.
- `polyglot-conformance.html` independently loads all four compiled client engines for eight seeded cases and requires their public price/SE/SD serialization to agree exactly at eight decimal places.

The 2026-08-03 verified browser snapshot is:

| Report | Result |
|---|---:|
| Direct payoff cases | 75 / 75 |
| Volatility-calibration rows | 15 / 15 |
| Pricing regressions | 92 / 92 |
| Combined executable report | 182 / 182 in 26 groups |
| Four-language conformance | 8 seeded cases at matching 8-decimal public serialization |

The default CVI browser sample additionally reports zero butterfly and zero
calendar flags on its 328-point audit grid. That is a sampled diagnostic, not a
continuous-domain proof.

## Run the suite

From the project root:

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

Run syntax checks for changed browser scripts as well:

```powershell
node --check .\web\exotic-pricer.js
node --check .\web\advanced-pricer.js
node --check .\web\exotics.js
node --check .\web\volatility-models.js
node --check .\web\volatility-lab.js
```

Documentation changes should also verify that every relative Markdown link
resolves, every documented HTML/script asset exists, and all repeated counts
match the executable sources. Generated Pyodide/.NET manifests should be
excluded from broad text searches to avoid false matches and excessive output.

## Required testing pattern for a new payoff

1. Direct hand-computed payoff cases, including zero and boundary cases.
2. Call and put directions where meaningful.
3. Multiple strikes and maturities.
4. A reduction to a simpler existing contract.
5. An independent numerical-method comparison where available.
6. Seeded cross-language comparison if added to the packed production contract.
7. Volatility-limit checks for every supported path model.

## Numerical claims

Tolerance is part of every numerical test. Exact equality is expected only for algebraic identities, direct payoffs, pathwise nested-model limits, and the explicitly rounded conformance contract. Independent approximations, PDE, MC, and QMC comparisons use method-appropriate tolerances.

Passing tests provide regression confidence; they do not constitute model validation for trading or financial reporting.

For a production-readiness acceptance bar, see the
[whole-project review](../project/review-2026-08-03.md).
