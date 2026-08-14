# Single barrier on a basket — `barrier_single_basket.py`

## Formula

A weighted-sum basket `B = sum_i weights[i]*S_i(T)` collapsed to a single
**effective lognormal** via the same 2-moment (Lévy) match used in
`digital.py`'s basket case: `basket_spot = sum(w_i*S_i(0))`,
`forward = sum(w_i*F_i)`, `Cov_ij = rho_ij*sqrt(W_i(T)*W_j(T))`,
matched total variance `-> eff_vol`, `eff_carry = ln(forward/basket_spot)/T`.
That synthetic single-asset GBM is then handed to the SAME
Reiner-Rubinstein machinery as `barrier_single.py` (deliberately duplicated
verbatim, not imported — see the self-contained-file convention).

This is exact for the basket's TERMINAL law up to the moment-matching
approximation (so `trigger="european"` is as accurate as the digital
basket case); every path-dependent trigger (monitored or continuous) is a
further approximation, since the basket's true running extremum isn't
generally well-represented by a single effective-GBM path.

## Benchmark

`barrier_single_basket_qmc.py`: simulates the ACTUAL correlated multi-asset
basket path (fine grid, per-asset term-vol curve, fixed correlation via
Cholesky) and monitors the true `B_t` against the barrier — deliberately
NOT using the closed form's effective-lognormal shortcut, so the gap is
exactly the basket-collapse approximation error.

## Tests — `test_barrier_single_basket.py` (18 tests)

Exact reduction: 1-asset basket = `barrier_single.py` bit-for-bit (weights
`[1.0]`). Correlation sweep (continuous trigger, 2-asset basket) against
QMC:

| correlation | measured error |
|---|---|
| 0.0  | 5.122% |
| 0.35 | 8.057% |
| 0.90 | 10.575% |

All within the documented 15% bound; error grows with correlation, matching
the earlier web-lab basket-barrier finding that the effective-GBM
approximation degrades as the basket's components become more co-moving
(and therefore further from the single-effective-vol collapse the moment
match assumes).

## Seasoned state and throughput

`already_touched` (scalar bool — this family prices ONE scenario per call,
since `spots` is the per-asset vector; a PFE engine loops over scenarios):
out+touched is dead (expiry rebate still owed), in+touched is a vanilla
European on the effective-GBM basket. Raises for `trigger="european"`.

Measured throughput (2-asset basket, continuous trigger): **~2,000
calls/s** per scenario-call.
