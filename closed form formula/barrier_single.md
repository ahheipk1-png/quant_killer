# Single barrier option — `barrier_single.py`

## Formula

Reiner-Rubinstein closed form (Haug's standard A/B/C/D-term decomposition),
**APPROXIMATE under a term-vol curve** (collapsed to a single effective vol
`sigma_eff = sqrt(W(T)/T)` — unlike European/Digital/Asian-Curran, which are
exact).

**5 monitoring triggers**:
- `continuous`: textbook Reiner-Rubinstein.
- `daily`/`weekly`/`monthly`: Broadie-Glasserman-Kou (BGK) continuity
  correction — barrier shifted by `exp(+-beta*sigma*sqrt(1/m))`,
  `beta = -zeta(1/2)/sqrt(2*pi) ~= 0.5825971579`, `m` = observations/year.
- `european`: barrier tested only at maturity — a truncated vanilla, no
  continuous-monitoring risk at all.

**Rebate** (`rebate`, `rebate_timing`): "hit" (Haug's F term — undefined for
`style="in"` and `trigger="european"`, paid and discounted at the hit time
itself, not deferred to `payment_time`) or "expiry" (Haug's E term,
discounted from T, contingent on knock-out having occurred by maturity —
supported everywhere).

Low-volatility overflow guard: `(H/S)^(2*mu)` overflows for `sigma` below
~1%; falls back to the deterministic-drift limit.

## Valuation conventions

`value_date` (required) follows `european.md`'s three-regime convention;
past maturity, `spot` is the realized S(maturity) and `already_touched`
(or the realized spot being beyond the barrier) decides the payoff.
`strike = 0` is priced by substituting an economically negligible positive
epsilon -- this family's closed form bakes strike into several log() terms
with no clean K=0 special case.

## Benchmark

`barrier_single_qmc.py`: for `continuous`, a **Brownian-bridge survival
weight** (`1 - exp(-2*gap_i*gap_j/(sigma^2*dt))` per step, reflection
principle) rather than a discrete indicator — this reproduces the true
continuous-monitoring price from a coarse grid. Discrete triggers use a
plain indicator on the actual monitoring grid (that IS the definition of
discrete monitoring). Rebate-at-hit needs an actual hit *time*, which the
bridge weight doesn't give, so that path uses a fine (1024+ steps/year)
hard-indicator grid and a looser, printed-error tolerance.

## Tests — `test_barrier_single.py` (63 tests)

In+out=vanilla parity (all 5 triggers x call/put, ~1e-7), monotonicity
(`continuous <= daily <= weekly <= monthly <= european` KO price), rebate
identities (`rebate_out + rebate_in = rebate*discount`). Measured errors:

| check | error |
|---|---|
| daily vs matched discrete QMC | 0.647% |
| weekly vs matched discrete QMC | 1.444% |
| rebate-at-hit vs fine-grid MC | 1.986% |
| sloped term-vol vs QMC | 0.954% |

Two real bugs were caught and fixed by this test suite during development:
the `european`-trigger up/down region mapping was inverted, and the put
in/out combination formulas (Haug's cdi/cui/pdi/pui) had their up/down
branches swapped.

## Seasoned state and PFE vectorisation

`already_touched` (bool, scalar or per-scenario array) is the barrier's
seasoned state — whether it was breached between inception and value_date.
Essential for PFE revaluation of in-flight trades (spot alone cannot tell
you a knock-out died last month and drifted back inside): out+touched is
dead (an "expiry"-timing rebate is still owed; a "hit"-timing rebate was
already paid), in+touched is a plain vanilla European on the remaining
horizon. Raises for `trigger="european"` (nothing observable before
maturity).

`spot` is vectorised (array in, array out) — verified element-by-element
against the scalar path.

## Throughput (PFE inner loop)

Measured on this dev machine (100,000-scenario spot array, best of 5,
continuous trigger, no rebate): **~2.9M prices/s**.
