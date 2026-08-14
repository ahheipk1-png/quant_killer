# Digital option — `digital.py`

## Formula

Single-asset cash-or-nothing / asset-or-nothing, exact under the same
term-vol curve as `european.py` (only ever needs `W(T)`):

```
cash-or-nothing call = cash * exp(-r*T) * N(d2)
asset-or-nothing call = S*exp(-q_eff*T) * N(d1)
```
(puts via `N(-d2)`/`N(-d1)`).

**Basket digital** (`price_digital_basket`): the sum of correlated
lognormals isn't itself lognormal, so the basket is collapsed to a single
effective lognormal via a **2-moment (Lévy) match** —
`F = sum(w_i*F_i)`, `Cov_ij = rho_ij*sqrt(W_i(T)*W_j(T))`,
`second_moment = legs @ exp(Cov) @ legs`, `W_basket = ln(second_moment/F^2)`
— then the same digital formulas are applied to that synthetic asset. This
is APPROXIMATE (unlike the single-asset case); the size of the error is
measured directly, not asserted away.

## Benchmark

`digital_qmc.py`: shifted-Sobol QMC, single-asset exact terminal draw, or
correlated multi-asset terminal draws (Cholesky, eigenvalue-clipped for
near-degenerate correlation matrices) for the basket.

## Tests — `test_digital.py` (28 tests)

Exact reduction checks (1-asset basket = single asset; identical assets at
rho=1 = single asset; basket forward = weighted sum of forwards), boundary
cases, and a correlation sweep against QMC that prints the measured
2-moment-match error:

| correlation | measured error vs QMC |
|---|---|
| 0.0  | 0.409% |
| 0.35 | 0.280% |
| 0.90 | 0.195% |

All below the documented 5% bound the tests assert against.
