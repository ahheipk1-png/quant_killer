# American option (Ju-Zhong) — `american_ju_zhong.py`

## Formula

Ju & Zhong (1999) quadratic approximation — a second-order correction to
Barone-Adesi-Whaley (1987). Chosen over Bjerksund-Stensland 2002 after an
earlier measurement in this project found Ju-Zhong both more accurate AND
~290x faster. **APPROXIMATE under a term-vol curve** (collapsed to a single
effective vol, same convention as every barrier family). Ported and
adapted from this project's own validated `python/quantkiller/models/american.py`
(added: term-vol collapse, an explicit borrow rate folded into the
effective dividend yield, payment_time deferral).

Requires `rate >= 0` and `(div_yield + borrow) >= 0` — not defined/tested
outside that regime. Two numerical singularities of the underlying BAW
boundary equation are guarded rather than left to crash: `rate` is nudged
away from exactly 0 (a genuine root of `m = 2*rate*T/variance` that zeros a
denominator for puts), and `vol <= 0.5%` falls back to the exact `vol=0`
limit (`max(intrinsic, European)`) rather than risking `exp()` overflow in
the boundary solve.

## Benchmark

`american_pde.py` — this is the one family using a **PDE** instead of a QMC
benchmark (American exercise has no simple unbiased Monte Carlo estimator).
Crank-Nicolson finite differences on a **sinh-clustered non-uniform grid**
(true unequal-spacing 3-point stencils) with a **Forsyth-Vetzal penalty
iteration** for early exercise (not projection, which is only first-order
accurate at the boundary), **Rannacher start-up** (first two steps fully
implicit, damping the payoff kink's initial ringing before switching to
Crank-Nicolson), **cell-averaged payoff** as the terminal condition, and
**Richardson extrapolation** (space+time both doubled). A separate
`convergence_table()` function runs undoubled at 5 grid sizes for
independent verification of near-second-order convergence — measured
(American put, S=K=100, r=5%, q=2%, vol=25%, T=1):

| grid size | price |
|---|---|
| 25  | 8.676 |
| 50  | 8.591 |
| 100 | 8.569 |
| 200 | 8.565 |

Successive differences shrink by roughly the expected factor as resolution
doubles.

## Tests — `test_american_ju_zhong.py` (29 tests)

Call with zero dividend/borrow reduces exactly to European (~1e-9).
Ju-Zhong vs PDE, across strikes/spots:

| option | spot | error |
|---|---|---|
| call | 80  | 0.003% |
| call | 100 | 0.003% |
| call | 120 | 0.004% |
| put  | 80  | 0.123% |
| put  | 100 | 0.320% |
| put  | 120 | 0.052% |
| put  | sloped term-vol | 0.302% |

All well under the documented 2% bound — consistent with Ju-Zhong's known
sub-1% accuracy for vanilla American puts.
