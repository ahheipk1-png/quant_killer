# American option (Ju-Zhong) — `american_ju_zhong.py`

## Settlement lag (replaces payment_time)

A European-style `payment_time` is a conceptual bug for American exercise —
a fixed payment date detached from the (random) exercise date has no
consistent meaning. The correct concept is a **cash-settlement lag**:
exercising at time τ locks the cash amount (intrinsic at τ), which is paid
at τ + L. This admits an **exact** closed form:

```
V_lag = sup_τ E[e^(−r(τ+L)) · payoff(S_τ)]
      = e^(−rL) · sup_τ E[e^(−rτ) · payoff(S_τ)]
      = e^(−rL) · V_no_lag
```

The constant `e^(−rL)` factors out of the optimal-stopping problem, so the
**exercise boundary is unchanged** and no approximation is introduced
beyond Ju-Zhong itself (verified by the boundary-invariance test: the
lagged/unlagged price ratio is the same constant at every spot, including
deep ITM). The alternative *physical-settlement* convention — where the
exchange itself happens at τ+L — maps instead to Ju-Zhong with adjusted
strike `K·e^(−rL)` and spot `S·e^(−qL)`, which shifts the boundary; still
closed form, not implemented here.

## Exercise-now indicator (PFE seasoned state, done right)

`price_american_ju_zhong` returns a **pair** `(price, exercise_now)` — the
second output is the per-scenario optimal-exercise boolean (spot beyond the
BAW critical boundary, the same boundary the price itself is built on, and
provably unchanged by the settle lag). Standalone helpers
`american_exercise_boundary()` / `should_exercise_now()` expose the same
decision without pricing.

Why an indicator OUTPUT rather than an `already_exercised` INPUT (the
barrier families' `already_touched` pattern): a touched knock-in *remains
an option* (a vanilla), so the pricer must know the state; an exercised
American is *no longer an option at all* — just a known cash amount paid
at exercise_time + settle_lag, which needs the locked amount and the
exercise date, booking facts a boolean cannot carry and the PFE engine
already owns. The pricer therefore owes the engine the *decision* (to flip
scenarios into the exercised state as the simulation steps through dates),
and the engine books exercised scenarios itself as fixed cash flows.
Consistency is test-enforced: wherever `exercise_now` is True the unlagged
price sits exactly at intrinsic, wherever False it is strictly above.
Past maturity the indicator degenerates to "in the money" (the terminal
exercise rule); past settlement it is False.

## Formula

Ju & Zhong (1999) quadratic approximation — a second-order correction to
Barone-Adesi-Whaley (1987). Chosen over Bjerksund-Stensland 2002 after an
earlier measurement in this project found Ju-Zhong both more accurate AND
~290x faster. **APPROXIMATE under a term-vol curve** (collapsed to a single
effective vol, same convention as every barrier family). Ported and
adapted from this project's own validated `python/quantkiller/models/american.py`
(added: term-vol collapse, an explicit borrow rate folded into the
effective dividend yield, the cash-settlement lag above, and
spot-vectorisation — the BAW/Ju-Zhong critical boundary is spot-INDEPENDENT,
so it is solved once per call and the closed-form pieces broadcast over a
whole scenario vector).

Requires `rate >= 0` and `(div_yield + borrow) >= 0` — not defined/tested
outside that regime. Two numerical singularities of the underlying BAW
boundary equation are guarded rather than left to crash: `rate` is nudged
away from exactly 0 (a genuine root of `m = 2*rate*T/variance` that zeros a
denominator for puts), and `vol <= 0.5%` falls back to the exact `vol=0`
limit (`max(intrinsic, European)`) rather than risking `exp()` overflow in
the boundary solve.

## Valuation conventions

`value_date` (required): past `maturity + settle_lag` -> 0; in
`[maturity, maturity + settle_lag]` -> discounted intrinsic of the
realized spot (assumes no early exercise -- an early-exercised trade is a
fixed cash flow the caller books directly, see the exercise-indicator
section); before maturity -> Ju-Zhong on the remaining horizon times
e^(-r*settle_lag). `strike = 0` via the same epsilon substitution as the
barrier families.

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

## Tests — `test_american_ju_zhong.py` (45 tests)

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

## Throughput (PFE inner loop)

Measured on this dev machine (vectorised over a 100,000-scenario spot
array, best of 5, constant vol, put):

| kernel | throughput |
|---|---|
| `price_american_ju_zhong` (vectorised) | ~9.7M prices/s |

The boundary solve runs once per call regardless of scenario count, so
throughput is essentially numpy-bound.
