# Monte Carlo and quasi-Monte Carlo

> Documentation status: synchronized with the current PCG/Sobol path engines on 2026-08-04.

## Random streams

PCG32 is the seeded pseudorandom generator used for reproducible Monte Carlo and the cross-language advanced contract. Normal draws are produced from uniforms using the shared inverse-normal approximation.

Sobol QMC maps low-discrepancy points to normal variates. The implementation contains explicit early direction parameters and can generate additional dimensions. A digital shift provides randomized Sobol behavior.

The advanced JavaScript QMC implementation supports up to 16 Sobol dimensions
before its extensible fallback. Dimension availability is not equivalent to a
Brownian-bridge ordering or an optimal high-dimensional construction.

## Estimator statistics

PCG Monte Carlo results report:

- mean discounted payoff (price),
- sample payoff standard deviation,
- estimator standard error,
- sample count.

Deterministic Sobol results report the price and payoff dispersion but intentionally return no classical standard error. The vanilla randomized-QMC route uses independent shifts for an empirical estimator error.

## Variance controls

The vanilla MC engine supports:

- antithetic variates,
- discounted terminal stock as a control variate,
- the combination of antithetic and control-variate estimators.

The advanced payoff contract currently focuses on common random-number reproducibility and does not expose the same variance-control selector for every product.

## Path construction

The advanced simulator evolves each asset over the selected schedule. It supports correlated assets and an additional spot/variance shock for Heston and SLV.

The base barrier MC implementation applies conditional Brownian-bridge **survival probabilities between monitoring dates**. This corrects missed barrier crossings. It is different from a general Brownian-bridge ordering of Sobol dimensions.

General Brownian-bridge QMC path construction is currently pending. Sobol dimensions are assigned sequentially to path increments in the production advanced engine.

This limitation applies to every QMC-capable advanced path payoff and to the
distribution lab. It does not invalidate the separate conditional bridge
survival correction used by barrier MC/QMC.

## Bermudan LSMC

Longstaff-Schwartz regression is used for Bermudan MC/QMC. The current continuation basis is fixed to quadratic monomials:

```text
1, S/K, (S/K)^2
```

The user cannot yet select basis family or polynomial degree. This is an explicit roadmap item.

## Distribution session

`simulatePathDistribution` reuses the same path dynamics without evaluating a payoff. It retains the selected series at every time step, subject to an interactive memory cap, and returns data for cross-sectional and through-time diagnostics.

## Language boundary

JavaScript exposes the broad advanced PCG/QMC method set. The C++, Rust, Python,
and C# advanced selectors currently expose the common seeded MC route. The
vanilla page separately exposes its compiled Sobol and randomized-Sobol methods.
