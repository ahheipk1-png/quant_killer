# Roadmap and known limitations

> Documentation status: reprioritized on 2026-08-04 from the full audit and focused regression evidence.

This file records requested or important work that is **not yet fully implemented**.

## 1. Reproducible release baseline - highest priority

- Put the currently untracked subproject under a reviewed Git baseline.
- Add a project license and third-party notices for bundled runtimes and generated artifacts.
- Add `package.json` test commands and CI that runs all eight Node suites plus browser smoke/conformance checks.
- Define versioned JSON schemas for deals, results, the packed ABI, and calibrated surfaces.

These changes should precede another large payoff expansion because they make
subsequent numerical changes reviewable and reproducible.

## 2. Calibration-to-pricing pipeline

The CVI/Dupire/SLV lab and its dense round-trip tests are implemented. Remaining work is to:

- move calibration and particle SLV into a cancellable worker with progress and stale-request protection;
- persist quote snapshot, curves, conventions, fitter version, constraints, diagnostics, and tolerances as one calibrated-surface artifact;
- inject that artifact into vanilla, exotic, portfolio, and distribution engines;
- test sparse/noisy/bid-ask/inconsistent market data and report quote rejection or repair explicitly;
- add convergence and independent-reference evidence beyond the current clean synthetic round trip.

## 3. General Brownian-bridge Sobol path construction

The existing barrier MC has conditional Brownian-bridge survival correction. The advanced QMC engine still assigns Sobol coordinates to sequential time increments. Add a selectable sequential/Brownian-bridge construction to all QMC-capable path payoffs and the distribution lab.

The prior requirement also asked for consistent behavior across C++, Rust, Python, and C#. That requires a carefully specified coordinate ordering and new conformance tests.

## 4. Configurable LSMC regression

Bermudan Longstaff-Schwartz currently uses `[1, S/K, (S/K)^2]`. Add user-selectable basis families and degree, robust least-squares handling, and regression tests against the tree across calls, puts, exercise schedules, and moneyness.

## 5. Cross-language method breadth

The compiled advanced engines currently expose seeded Monte Carlo for all packed payoff/model combinations. JavaScript has broader formula, tree, PDE/ADI, and QMC coverage. Extending “every method in every language” remains substantial work and should be tracked method by method rather than claimed globally.

## 6. PDE follow-up

American projected, PSOR, and penalty solvers; payoff/Rannacher smoothing; and
uniform/strike-sinh/spot-sinh grids are implemented in JavaScript. Unequal grids
cover the digital, single-barrier, double-barrier, Bermudan, American, and
two-axis Asian routes, with 2,342 focused assertions.

Remaining PDE work is cross-language duplication, Greek convergence, adaptive
grids, and integration with calibrated curve/surface artifacts—not the existing
JavaScript controls.

## 7. Production-hardening gaps

- Full business-day holiday calendars and day-count conventions.
- Market-data adapters, curve bootstrapping, quote cleaning, and production calibration governance. The current SVI/SSVI/SABR/Vanna-Volga/CVI/Dupire/SLV lab is a local research implementation; its CVI solver follows the paper but is independent of Volptima's production implementation.
- Greeks and stable Greek convergence tests across methods.
- Cash-flow/event inspection for structured products.
- Portfolio risk aggregation, scenario grids, and dependency-aware parallelism.
- Model governance, audit persistence, authentication, and deployment controls.
- Development/production cache separation for the approximately 47 MiB web payload.
- Versioned/generated polyglot ABI instead of manually synchronized numeric offsets.
- Accessibility, responsive viewport, and hosted-security browser checks.

## Delivery sequence

1. Release baseline, schemas, and CI.
2. Worker-based calibrated-surface artifact and calibration-to-pricing integration.
3. Greeks/scenarios, Brownian-bridge QMC, configurable LSMC, and deployment hardening.

The rationale and acceptance bar are detailed in the
[whole-project review](project/review-2026-08-03.md).
