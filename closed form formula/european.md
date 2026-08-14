# European option — `european.py`

## Formula

Standard Black-Scholes-Merton, generalized to a **term-vol curve** rather
than a constant vol: the input is a curve of *terminal* (Black) vols at
pillar maturities, interpolated **linearly in total variance**
`W(t) = sigma_term(t)^2 * t`. This is exact for a European payoff (it only
ever needs `W(T)`, not the instantaneous path of vol), unlike every barrier
and American family in this folder, which collapse the curve to a single
effective vol and are therefore approximate.

```
d1 = (ln(S/K) + (b*T + 0.5*W(T))) / sqrt(W(T)),   b = r - q - borrow
d2 = d1 - sqrt(W(T))
call = S*exp(-q_eff*T)*N(d1) - K*exp(-r*T)*N(d2)
put  = K*exp(-r*T)*N(-d2) - S*exp(-q_eff*T)*N(-d1)
```

Edge cases handled exactly: `T=0` -> intrinsic; `W(T)=0` -> discounted
forward intrinsic; `payment_time > maturity` -> diffuse to maturity,
discount the extra gap at `rate`.

## Valuation conventions (all families share these)

- `value_date` (required, no implicit "today"): the as-of time on the same
  axis as `maturity`/`payment_time`. Three regimes: past `payment_time` ->
  0 (settled); in `[maturity, payment_time)` -> the payoff is already fixed
  (`spot` IS the realized S(maturity)), just a deferred discounted cash
  amount; before `maturity` -> standard pricing on the remaining horizon.
- `strike = 0` is legal and exact here: a put is identically worthless, a
  call is the discounted forward (no log-based formula is touched).

## Benchmark

`european_qmc.py`: randomized (shifted) Sobol Monte Carlo under the same
term-vol curve, martingale-corrected terminal draws. Since the closed form
is exact, this exists mainly as the *pattern* every other family's QMC
benchmark reuses (shifted-Sobol standard-error estimation), and as a
regression check that the closed form and an independent simulation agree.

## Tests — `test_european.py` (48 tests)

Three layers (analytic invariants incl. put-call parity, boundary cases
incl. T->0/vol->0/deep ITM-OTM, market-data stress incl. vol 0.1%-500%,
rates -10%-20%, maturities 1 day-30y) plus a sloped-term-vol-curve case,
all passing to closed-form tolerance (~1e-9 relative) or within a few QMC
standard errors where the QMC benchmark is used.

## Throughput (PFE inner loop)

Measured on this dev machine (100,000-scenario spot array, best of 5):
**~16M prices/s**.
