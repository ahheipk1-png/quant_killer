# Volatility models and effective underlyings

> Documentation status: synchronized with the current nested-model and basket regressions on 2026-08-04.

## Constant volatility

The instantaneous volatility is fixed at the initial input. This is the reduction target for every nested volatility model and is the domain of the deterministic Black-Scholes-based methods.

## Term volatility

Instantaneous volatility interpolates linearly from the initial volatility to `termVolatility` at maturity. Setting the terminal value equal to the initial value reduces pathwise to constant volatility.

## Local volatility

The term volatility is multiplied by a bounded leverage function based on `(S/S0)^localBeta`. Setting `localBeta = 0` reduces pathwise to the term-volatility model.

This path-engine mode is a deliberately compact demonstrator. It is distinct from the calibrated Dupire surface and round-trip validator in [volatility calibration](volatility-calibration.md); fitted local-vol grids are not yet injected automatically into the four-language path ABI.

## Heston stochastic volatility

The path engine uses a full-truncation Euler-style variance update with mean reversion, long-run variance, vol-of-vol, and spot/variance correlation. Setting vol-of-vol to zero and initializing at the long-run variance produces the appropriate deterministic-volatility limit under the contract tests.

## Stochastic-local volatility

SLV multiplies the stochastic variance volatility by the local leverage. Its tested nested limits are:

```text
SLV --local beta = 0--> Heston
SLV --vol-of-vol = 0--> local volatility
local --local beta = 0--> term volatility
term --same start/end vol--> constant volatility
```

The volatility regression suite replays identical seeded paths so these reductions can be compared path by path.

`advanced-test.cjs` currently contains 84 volatility-limit checks, while the
path-distribution suite independently checks the same nested reductions in an
analysis session without a payoff.

## Effective basket underlyings

Compatible payoffs can consume one of five constructed series:

1. Single asset.
2. Weighted sum of asset prices.
3. Order statistic of normalized asset performances.
4. Weighted sum of normalized returns, rescaled to the first spot.
5. Return of the weighted price sum, rescaled to the first spot.

Rainbow and Himalayan retain their native multi-asset semantics. Other compatible path payoffs consume the effective basket series as if it were their underlying.

The current implementation supports up to three assets in the browser UI and uses a common pairwise correlation parameter.

The packed ABI also stores three basket weights and a single correlation input.
General covariance matrices, dynamic correlation, quanto terms, and larger
baskets require a versioned contract extension rather than reinterpretation of
the existing slots.
