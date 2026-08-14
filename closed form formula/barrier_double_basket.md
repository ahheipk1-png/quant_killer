# Double barrier on a basket — `barrier_double_basket.py`

## Formula

Same effective-lognormal basket collapse as `barrier_single_basket.py`,
handed to the SAME absorbing-boundary spectral machinery as
`barrier_double.py` (duplicated verbatim, including the `S(0)=1` tail
correction for rebate-at-hit and the barrier-negligible guard — see
`barrier_double.md` for the derivation).

## Benchmark

`barrier_double_basket_qmc.py`: true correlated multi-asset basket path
simulation (same approach as `barrier_single_basket_qmc.py`), monitored
against both barrier levels directly — not the effective-GBM shortcut.

## Tests — `test_barrier_double_basket.py` (12 tests)

Exact reduction: 1-asset basket = `barrier_double.py` bit-for-bit. Already-
breached and invalid-ordering edge cases. Correlation sweep against QMC:

| correlation | measured error |
|---|---|
| 0.0  | 5.196% |
| 0.35 | 8.435% |
| 0.90 | 11.969% |

Consistent with the single-barrier basket case (`barrier_single_basket.md`)
— error grows with correlation, all within the documented 15% bound.
