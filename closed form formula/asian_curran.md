# Asian option (Curran conditioning) — `asian_curran.py`

## Formula

Discrete arithmetic Asian on a **weighted basket of averages** (n=1,
weights=[1.0] is the single-underlying case), with an arbitrary (unevenly
spaced) fixing schedule, partly-seasoned fixings (`observed_sum`/
`observed_count`), and per-underlying cap/floor.

**Curran's geometric conditioning**: condition on
`Y = sum_i weights[i]/m * sum_k X_{i,k}` (weighted sum of each asset's
mean log-fixing over the *remaining* fixings). Given `Y`, every `X_{i,k}`
is exactly jointly normal, so each fixing's conditional law is exactly
lognormal.

- **one-moment**: collapse each conditional fixing to its conditional
  MEAN (deterministic given `Y`). Exact for a single fixing (the "average"
  degenerates to `S_T`, proven by `test_single_fixing_equals_european_exactly`
  in `test_asian_curran.py`), and the variant under which per-underlying
  capping is exact (clip the conditional mean once per asset before
  combining into the basket — capping breaks joint lognormality, so it is
  NOT compatible with two-moment).
- **two-moment**: fit a lognormal to the conditional first AND second
  moment of the whole basket average. More accurate when components retain
  real uncertainty given `Y` (correlation not close to 1).

Cross-asset time-covariance is approximated as
`Cov(X_i(s),X_j(t)) = rho_ij*sqrt(W_i(min(s,t))*W_j(min(s,t)))` — exact for
same-asset or parallel-shaped term-vol curves, approximate otherwise.

The z-integral (over the conditioning variable) uses **adaptive quadrature**
(`scipy.integrate.quad`) rather than a fixed-node rule: the payoff has a
kink in z that a fixed 320-node Simpson rule only resolved to ~1e-3 (this
was a real bug, caught by the single-fixing-equals-European test); QUADPACK's
adaptive subdivision handles the kink automatically, reaching ~1e-11.

## Benchmark

`asian_qmc.py`: fine-sub-grid Sobol QMC that simulates the *actual*
constant-instantaneous-correlation multi-asset model, deliberately NOT
reproducing the closed form's `rho*sqrt(W_i*W_j)` shortcut — the gap is
exactly what the cross-covariance approximation costs.

## Tests — `test_asian_curran.py` (28 tests)

Exact identities: single-fixing = European (fresh and seasoned), capped
Asian = call-spread of two uncapped Curran prices, 1-asset basket = single
asset, put-call parity on the average. Measured basket accuracy
(two-asset, unevenly spaced schedule, one_moment vs two_moment vs QMC):

| correlation | one-moment error | two-moment error |
|---|---|---|
| 0.0  | 0.102% | 0.236% |
| 0.35 | 0.264% | 0.312% |
| 0.90 | 0.324% | 0.329% |

Both variants stay well under 1% here; this project's earlier web-lab study
found one-moment can be unsafe (up to -7.8% error) for low-correlation
baskets with many fixings — always cross-check against QMC for production
use outside the ranges tested here.
