# Polyglot browser option pricer

> Documentation status: synchronized on 2026-08-04; verification dates are recorded in `docs/testing/validation.md`.

Project documentation is organized under [`docs/`](docs/README.md). An AI agent
continuing the work should begin with [`docs/HANDOFF.md`](docs/HANDOFF.md).
The latest whole-project assessment and recommended delivery sequence are in
[`docs/project/review-2026-08-03.md`](docs/project/review-2026-08-03.md).

## Verified state

The complete 2026-08-03 verification passed all eight Node suites, loaded all
seven browser pages through the loopback server, passed 182/182 executable HTML
checks in 26 groups, and reported matching eight-decimal public results for the
eight four-language conformance cases. On 2026-08-04 the advanced, PDE, pricing-
regression, and volatility claim-bearing suites were rerun successfully. The
volatility suite contains 598 assertions, including a 300-price dense Dupire
round trip.

This standalone demo prices European calls and puts with three methods:

- Black-Scholes closed form with continuous dividend yield.
- Cox-Ross-Rubinstein (CRR) binomial tree with up to 2,000 steps.
- GBM Monte Carlo with PCG32, deterministic Sobol QMC, or eight-shift randomized Sobol QMC.

American calls and puts add six early-exercise methods:

- Barone-Adesi-Whaley semi-closed approximation.
- Ju-Zhong (1999) quadratic early-exercise-premium approximation.
- Peter Carr (1998) Erlang maturity randomization with two-level Richardson extrapolation.
- Bjerksund-Stensland (1993) semi-closed approximation.
- Bjerksund-Stensland (2002) two-boundary semi-closed approximation.
- CRR tree with an exercise decision at every node.

The JavaScript reference lab also provides three American finite-difference
variants: projected Crank-Nicolson, PSOR for the linear-complementarity problem,
and a penalty active-set solver. PDE controls include uniform or strike/spot-
centered sinh grids, cell-average payoff smoothing, and Rannacher damping. The
same nonuniform spot-grid machinery is used by every one-factor PDE payoff and
by both axes of the discrete-Asian ADI reference solver.

Monte Carlo variance controls include antithetic variates, a discounted-stock
control variate, and their combination. Results report estimator standard
deviation and standard error. An optional diagnostics panel charts terminal
prices, payoffs at maturity, and the call or put payoff function from up to
5,000 representative draws.

The language selector runs independent client-side implementations in C++, Python,
Rust, and C#. Calculations run in Web Workers so the interface stays responsive and
no pricing inputs are sent to a server. Browser-ready assets are included.

The linked Exotic Option Lab adds digital, single- and double-barrier, Bermudan,
rainbow, autocallable, Phoenix autocall, yield seeker, Himalayan, discrete
arithmetic Asian, lookback, ladder, all four compound-option combinations,
variance and volatility swaps/options, and accumulators. Every product has a
seeded pathwise implementation in JavaScript, C++, Rust, Python, and C#.

JavaScript is the reference engine with the broadest formula, tree, PDE/ADI,
and QMC method set. The compiled advanced-language selectors currently expose
the common seeded MC contract; availability of a JavaScript method does not
imply that method is duplicated in every language.

The shared path contract supports constant, linear term, local, Heston, and
stochastic-local volatility. Its deliberately nested definitions are regression
tested path by path for SLV -> Heston, SLV -> local volatility, local -> term,
and term -> constant volatility. Any compatible payoff can use a single asset,
a weighted sum of prices, an order statistic of asset performance, a weighted
sum of returns, or the return of a weighted price sum.

Asian reference methods include Levy and shifted-lognormal moment matching, two
Curran conditioning variants, Ju's published volatility-order-six Taylor expansion, a
two-state fixing-jump PDE/ADI split, PCG Monte Carlo, and extensible Sobol QMC.
Schedules can be equal, monthly business-day (weekends only, ACT/365F), or an
explicit uneven list. The variance-swap reference method integrates a static
strip of out-of-the-money Black-Scholes options across strike.

The independent Path Distribution Lab runs PCG Monte Carlo, deterministic Sobol
QMC, or digitally shifted randomized Sobol without attaching an option payoff.
It stores the selected asset or effective basket at every simulated time step,
then provides an interactive histogram, moments and tail quantiles, a probability
threshold, a through-time quantile fan, representative paths, and CSV export of
the currently selected cross-section. The same constant, term, local, Heston,
SLV, correlation, and basket definitions are reused from the pricing engine.

The Volatility Surface Lab accepts option prices or implied-volatility quotes,
performs safeguarded Black-Scholes implied-volatility inversion, and fits raw,
natural, or jump-wings SVI, power-law SSVI, Hagan SABR, Vanna-Volga, PCHIP total
variance, Dumas polynomial, Deschâtres CVI variance splines, or a separate
constrained convex-call interpolation. CVI uses a browser-local constrained QP
with joint-expiry cubic B-splines, calendar and Lee-wing constraints, and a
sequential butterfly linearization over quoted and intermediate maturities. CVI
uses linear total variance between expiry pillars so its evaluated interpolation
matches its constrained surface. The lab also offers total-variance term
interpolation, sampled arbitrage diagnostics, Dupire local-volatility extraction,
and seeded Heston-particle SLV leverage calibration.

The Payoff Unit Tests page executes 182 checks: 75 direct cases across 20
payoff/basket families, 15 volatility-calibration reductions, and 92 pricing
regressions. The pricing matrix spans
calls, puts, strikes, maturities, and single/double barriers; verifies European
call-put parity and duality; verifies American call-put duality across CRR,
Barone-Adesi-Whaley, Ju-Zhong, Carr randomization, and both
Bjerksund-Stensland versions; and compares formulas with PDE and Brownian-bridge
Sobol QMC. Every row shows its inputs, expected result, actual result,
pass/fail status, numerical tolerance, and financial rationale.

The focused PDE suite adds 2,342 assertions over American projected/PSOR/penalty
solvers, uniform and strike/spot-clustered grids, raw and cell-averaged terminal
payoffs, 0/2/4 Rannacher intervals, every one-factor PDE payoff, breached-barrier
reductions, and two-axis Asian ADI on uneven observation schedules.

The Four-Language Conformance page is a separate executable browser test for
the four production client engines: C++, Rust, Python, and C#. Eight seeded
cases cover calls, puts, low/ATM/high strikes, short/long maturities,
single/double barriers, an uneven Asian schedule, and constant, term, local,
Heston, and stochastic-local volatility. It requires price, standard error,
and standard deviation to serialize to exactly the same eight-decimal public
result in all four languages, while displaying the unrounded cross-engine
spread. Open <http://127.0.0.1:8000/polyglot-conformance.html> after starting
the local server.

The focused volatility suite includes a dense Dupire round trip: 300 input call
prices over 12 expiries and 25 log-moneyness points are converted to local
volatility and repriced through an independent 1,101-strike by 1,100-time-step
forward PDE. Every reconstructed price is required to be within 1.5 cents.
The current deterministic fixture has price RMSE 0.00301 and maximum absolute
price error 0.01067.

The Portfolio Pricer is a separate local batch workspace for valuing many
vanilla and exotic positions in one run. Each row keeps its own product,
pricing method, quantity, market data, random seed, and optional JSON model
parameters. It reports unit and position present values, aggregates a total PV,
persists unpriced deal definitions in browser storage, and exports the table as
CSV. Open <http://127.0.0.1:8000/portfolio.html> after starting the local server.

Open the Volatility Surface Lab at
<http://127.0.0.1:8000/volatility.html> after starting the local server.

Core model references include Reiner-Rubinstein's 1991 barrier construction,
Geske's 1979 compound-option model, and Longstaff-Schwartz least-squares Monte
Carlo for scheduled exercise:

- <https://digicoll.lib.berkeley.edu/record/86304/files/b120984374_C044481811.pdf>
- <https://citeseerx.ist.psu.edu/document?doi=e1594259ee4f5041a96ec2c344b425d78dd84b4d&repid=rep1&type=pdf>
- <https://escholarship.org/uc/item/43n1k4jb>

Carr maturity randomization follows the Erlang-horizon resolvent recursion in
Peter Carr's 1998 paper and applies two-level Richardson extrapolation. The Ju
Asian implementation follows Nengjiu Ju's moment-matched lognormal
characteristic-function expansion through volatility order six:

- <https://doi.org/10.1093/rfs/11.3.597>
- <https://doi.org/10.21314/jcf.2002.088>

## Run locally

WebAssembly must be loaded over HTTP rather than by opening `index.html` directly.
The supplied server also sends JavaScript modules with the MIME type required
by the Python and C# workers:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Open <http://127.0.0.1:8000>. Stop the server with `Ctrl+C`.

## Rebuild the C++ engine

Install and activate the Emscripten SDK so `em++` is available, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

You can also pass the compiler explicitly with `-EmscriptenCompiler`.

## Verify numerical parity

The smoke test loads the generated C++ WebAssembly module in Node and checks the
European and American approximations, Carr randomization, and trees plus PCG, Sobol, randomized Sobol, variance controls,
standard errors, standard deviations, and distribution samples against the
Python reference values:

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

## Main files

- `src/pricer.cpp` - C++ analytic, CRR tree, and Monte Carlo implementations.
- `src/advanced_pricer.cpp` - C++ advanced payoff/volatility/basket contract.
- `web/python/pricer.py` and `web/python/advanced_pricer.py` - Python implementations loaded through Pyodide.
- `rust-engine/src/lib.rs` - Rust WebAssembly implementation.
- `csharp-engine/Pricer.cs` and `AdvancedPricer.cs` - C# implementations loaded through .NET WebAssembly.
- `web/*-worker.*` - background worker adapters for each language.
- `web/app.js` and `web/exotics.js` - method-aware inputs, validation, and results.
- `web/path-lab.html`, `web/path-lab.js`, and `web/path-distribution-worker.js` - independent path-distribution analysis.
- `web/volatility-models.js`, `web/volatility.html`, and `web/volatility-lab.js` - volatility interpolation and calibration layer and UI.
- `web/polyglot-conformance.html` and `web/polyglot-conformance.js` - live four-engine numerical conformance test.
- `serve.py` - local server with explicit JavaScript-module and WebAssembly MIME types.
