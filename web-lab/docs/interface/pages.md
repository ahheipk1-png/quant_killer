# Browser interfaces

> Documentation status: synchronized on 2026-08-04 with the seven-page browser audit last completed on 2026-08-03.

Start the server and open the listed route under `http://127.0.0.1:8000/`.
All seven routes below were loaded successfully in the 2026-08-03 browser audit.

## Vanilla & American lab — `index.html`

Use this page for a single European or American vanilla option.

- Select C++, Rust, Python, or C#.
- European methods: Black-Scholes, CRR, PCG MC, Sobol QMC, randomized Sobol QMC.
- American methods: CRR, Barone-Adesi-Whaley, Ju-Zhong, Carr randomization, and Bjerksund-Stensland 1993/2002.
- MC variance controls: none, antithetic, discounted-stock control, or both.
- Optional diagnostics show terminal prices, payoffs, and the payoff function.

The main language selector is near the top of the form. Python and C# may take longer on their first load because their browser runtimes are larger.

## Exotic option lab — `exotics.html`

Use this page for advanced payoffs, volatility models, baskets, and method comparisons.

The form is method-aware: fields appear only when relevant. JavaScript exposes formulas, tree, PDE/ADI, MC, and QMC where available. Its American PDE product offers projected Crank-Nicolson, PSOR, and penalty solvers plus spatial-grid and smoothing controls. C++, Rust, Python, and C# currently expose the advanced seeded MC path engine.

Schedules can be equally spaced, generated from monthly weekday-adjusted dates, or supplied as explicit dates. The date utility adjusts weekends only; it is not a complete holiday calendar.

General Brownian-bridge Sobol coordinate ordering is not yet available. Barrier
survival correction between monitoring dates is a different feature.

## Portfolio pricer — `portfolio.html`

Use this page to assemble and value many deals in one run.

- Each position stores name, product, method, quantity, market inputs, paths, seed, and optional JSON overrides.
- Quantities may be positive or negative.
- Deals can be edited, copied, removed, cleared, or loaded from a five-deal sample.
- Pricing runs in a background worker and reports row-level failures without discarding successful rows.
- The summary shows deal count, priced count, total position PV, and runtime.
- Deal definitions persist in browser local storage; prices are intentionally recomputed.
- CSV export includes the displayed valuation columns.

The batch is non-blocking but currently sequential inside one worker; it is not
yet a dependency-aware or multi-worker risk engine.

## Path distribution lab — `path-lab.html`

This is an independent simulation session. It attaches no option payoff.

- Choose PCG MC, deterministic Sobol, or randomized Sobol.
- Choose constant, term, local, Heston, or SLV dynamics.
- Analyze an asset or constructed basket at any simulated time step.
- Inspect a histogram, moments, tail quantiles, threshold probability, quantile fan, and representative paths.
- Export the selected time slice to CSV.

## Volatility surface lab — `volatility.html`

Use this page to invert option prices, fit and compare volatility smiles/surfaces, audit sampled static-arbitrage conditions, extract Dupire local volatility, and calibrate an SLV leverage grid.

- Input implied volatilities, bid/ask implied volatilities, or call/put prices as CSV.
- Select raw/natural/jump-wings SVI, SSVI, SABR, Vanna-Volga, PCHIP total variance, Dumas, Deschâtres CVI variance splines, or the separate constrained convex-call interpolator.
- CVI controls expose the number of cubic-spline knots and strike-regularization strength; quote CSV can include bid and ask implied volatilities. CVI locks maturity interpolation to linear total variance so the displayed surface matches the joint-expiry constraint construction.
- For the other fitters, select linear or PCHIP total-variance interpolation, or linear implied-volatility interpolation.
- Optionally repair decreasing calendar total variance before interpolation.
- Inspect residuals, parameters, a smile chart, local-volatility cells, and butterfly/calendar flags.
- Run a seeded Heston-particle leverage calibration against the extracted local-volatility surface.

The calibration currently runs on the main browser thread. The supplied sample is small; large quote sets or large particle counts can briefly occupy the page.

## Tests & benchmarks — `payoff-tests.html`

This page is the human-readable executable specification. It combines direct payoff cases with pricing regressions and renders inputs, expected values, actual values, tolerances, rationale, and pass/fail status.

The verified report contains 182 passing rows: 75 direct payoff cases, 15
volatility-calibration rows, and 92 pricing regressions in 26 groups.

## Four-language conformance — `polyglot-conformance.html`

This page loads C++, Rust, Python, and C# together and replays the same packed seeded MC cases. The public contract requires price, standard error, and standard deviation to match exactly after serialization to eight decimal places.

The conformance claim applies to the cases on this page, not to every deterministic formula or numerical method in the JavaScript reference engine.
Because this page intentionally loads Python and C# as well as both compact
WebAssembly engines, its first visit is the heaviest startup path in the project.
