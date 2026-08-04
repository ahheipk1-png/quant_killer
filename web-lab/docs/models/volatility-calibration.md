# Volatility interpolation and calibration

> Documentation status: synchronized with the 598-assertion suite rerun on 2026-08-04 and browser audit completed on 2026-08-03.

The Volatility Surface Lab turns European option prices or implied-volatility quotes into an interpolated total-variance surface, static-arbitrage diagnostics, a Dupire local-volatility grid, and a seeded stochastic-local-volatility leverage calibration. It is a local JavaScript research implementation; it is not a production market-data or model-governance system.

## Quote and implied-volatility layer

CSV rows accept either:

```text
maturity, strike, impliedVolatility[, weight]
maturity, strike, bidVolatility, askVolatility[, weight]
maturity, strike, optionPrice, call|put[, weight]
```

The actual CSV column names are `iv`, `bidiv`, `askiv`, `price`, and `type`.
Volatilities may be written as decimals or percentages. If `iv` is absent but
both bid and ask are present, CVI infers the mid and uses the spread in its
quote weighting/hinge objective.

Implied volatility is recovered with a safeguarded Newton iteration. The root remains bracketed and falls back to bisection when Newton leaves the bracket or Vega is too small. European no-arbitrage price bounds are checked before inversion. Rates and dividend yields are continuous.

## Maturity interpolation

The common surface variable is total variance:

```text
w(T, k) = impliedVol(T, k)^2 * T
```

The page offers linear total variance, shape-preserving PCHIP total variance, and linear implied volatility. The optional calendar repair applies weighted isotonic regression to decreasing total-variance pillars before interpolation. This repair is local to each fitted cross-section coordinate; it does not replace a joint arbitrage-free surface calibration.

## Smile and surface fits

| Method | Implementation and intended use |
|---|---|
| Raw SVI | Five-parameter total-variance fit per expiry with bounded multi-start Nelder-Mead. |
| Natural SVI | The fitted raw SVI is converted exactly to natural-SVI parameters; prices are unchanged. |
| SVI jump-wings | The fitted raw SVI is reported in the jump-wings representation; prices are unchanged. |
| Power-law SSVI | One joint surface with interpolated ATM total variance and calibrated `rho`, `eta`, and `gamma`. |
| Hagan lognormal SABR | Per-expiry Hagan implied-volatility approximation with user-selected fixed `beta` and fitted `alpha`, `rho`, and `nu`. |
| Vanna-Volga | Per-expiry three-anchor construction using low, near-ATM, and high strikes and a common ATM reference volatility. |
| PCHIP variance | Shape-preserving interpolation of total variance against log-forward-moneyness. It reproduces quote nodes. |
| Dumas polynomial | Least-squares implied-volatility surface in maturity and log-moneyness polynomial terms. |
| CVI | Joint-expiry cubic B-splines in normalized variance space, fitted by a browser-local quadratic-program solver with positivity, calendar, Lee-wing, linear-tail, and sequentially linearized butterfly constraints. |
| Convex calls | Call prices are projected onto decreasing, convex, arbitrage-bounded nodes and interpolated in price space. This is retained as a separate price-space method. |

The CVI implementation follows Fabrice Deschâtres's published construction: normalized log-moneyness, cubic/B-spline variance parameterization, simultaneous expiry fitting, linear variance extrapolation, variance positivity, calendar constraints, Lee tail-slope bounds, strike regularization, and sequential constrained-QP passes using butterfly constraints linearized around the preceding solution. Mid, bid, and ask volatility columns are accepted. The browser implementation also constrains an intermediate-maturity audit grid and fixes CVI maturity interpolation to linear total variance so the evaluated surface matches those joint-expiry constraints. The local solver uses a dense ADMM quadratic program and iteratively reweighted quadratic strike regularization; it is independent of Volptima's production Rust/Clarabel implementation and is not claimed to reproduce that proprietary library bit for bit.

SVI and SSVI follow the total-variance parameterizations and static-arbitrage framework described by Gatheral and Jacquier. SABR uses Hagan's lognormal asymptotic implied-volatility formula. Vanna-Volga uses Vega, Vanna, and Volga matching at three liquid anchors.

## Static-arbitrage diagnostics

The surface audit samples every expiry over log-forward-moneyness and reports:

- calendar flags when total variance decreases with maturity;
- butterfly flags when the SVI-style density denominator is non-positive;
- negative or non-finite total variance.

These are grid diagnostics, not mathematical proofs over the full continuous domain. The CVI QP installs constraints on a configurable discrete grid and then independently audits another grid. The separate piecewise convex-call fit can be convex at its nodes while a smooth derivative diagnostic reacts to kinks between nodes; it therefore also exposes direct call-price slope and bound checks.

On the current default sample and 328-point audit, CVI reports zero butterfly
and zero calendar flags. PCHIP variance exactly reproduces nodes but currently
reports two butterfly flags on that denser audit. The convex-call method passes
its direct price-space bound/slope tests; smooth density derivatives are not an
appropriate sole acceptance criterion at its interpolation kinks.

## Dupire local volatility

The local-volatility extractor differentiates fitted total variance numerically in time and log-moneyness and applies the Dupire/Gatheral total-variance denominator. Each grid cell reports the implied volatility, local volatility, denominator, and validity. A non-positive time derivative or denominator is returned as invalid rather than silently clipped into a plausible number.

The flat-surface and term-only reductions are automated tests: a constant implied-volatility surface reduces to the same constant local volatility, and a term-only total-variance surface reduces to its instantaneous forward volatility.

### Dense local-volatility round trip

The focused suite also performs an independent price round trip:

```text
300 input call prices on 12 expiries x 25 log-moneyness points
  -> numerical Dupire local volatility
  -> Crank-Nicolson forward PDE in strike space
  -> 300 reconstructed call prices
```

The benchmark uses a smooth, non-flat SSVI surface, non-zero rates and dividends, a 1,101-point strike grid, and 1,100 time steps. Every reconstructed price must be within 1.5 cents of its input. The current deterministic result has a price RMSE of approximately 0.00301 and maximum absolute error of approximately 0.01067. Implied-volatility RMSE is approximately 0.00104 and the maximum implied-volatility error is approximately 0.00697; price error is the primary criterion because very low-Vega wing options can turn a tiny price error into a visibly larger volatility error.

## Stochastic-local volatility

The SLV demonstrator estimates the leverage function from seeded Heston particles:

```text
L(t, S) = localVol(t, S) / sqrt(E[V(t) | S(t) = S])
```

Conditional variance is estimated with a Gaussian kernel across log-moneyness, then damped and bounded before the next particle step. The UI exposes particle count, time steps, mean reversion, long-run variance, volatility of variance, and spot/variance correlation. The deterministic-variance limit, seeded reproducibility, leverage bounds, and local-volatility reproduction are tested.

This single forward particle sweep is intentionally transparent and useful for regression experiments. Production calibration normally needs substantially more particles, convergence controls, bandwidth studies, market-data cleaning, stable curve inputs, and independent validation.

Both surface fitting and particle SLV currently execute on the main browser
thread. The UI sample is bounded, but production-sized quote sets or particles
should move to a cancellable worker with progress and stale-result protection.

## Code and tests

- `web/volatility-models.js`: numerical library and browser test definitions.
- `web/volatility.html`, `web/volatility-lab.js`, `web/volatility.css`: interactive lab.
- `volatility-test.cjs`: 598 focused Node assertions, including all 300 dense round-trip price cells.
- `web/payoff-tests.html`: 15 visible volatility reductions inside the full executable report.

## Primary references

- Gatheral and Jacquier, [Arbitrage-free SVI volatility surfaces](https://arxiv.org/abs/1204.0646).
- Hagan, Kumar, Lesniewski, and Woodward, [Managing Smile Risk](https://www.maths.univ-evry.fr/pages_perso/crepey/Equities/SABR.pdf).
- Castagna and Mercurio, [The Vanna-Volga method for implied volatilities](https://www.researchgate.net/publication/285662078_The_Vanna-Volga_method_for_implied_volatilities).
- Guyon and Henry-Labordere, [Being particular about calibration](https://arxiv.org/abs/1711.03023), for particle SLV calibration.
- Zeliade Systems, [Quasi-explicit calibration of Gatheral's SVI model](https://www.zeliade.com/wp-content/uploads/whitepapers/zwp-0005-SVICalibration.pdf).
- Deschâtres, [Convex Volatility Interpolation](https://volptima.com/convex-volatility-interpolation.pdf), the author version of the Risk Cutting Edge CVI paper.
