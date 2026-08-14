# Double barrier option — `barrier_double.py`

## Formula

Absorbing-boundary spectral closed form. `X = ln(S)` lives on the strip
`[L, U] = [ln(lower), ln(upper)]`; with the Girsanov-tilted drift
`theta = (carry - sigma^2/2)/sigma^2`, the transition density has the
classic sine-series eigenfunction expansion (`NUM_MODES = 256`,
`wave_n = n*pi/w`, `lam_n = sigma^2*wave_n^2/2 + theta^2*sigma^2/2`).
Survival probability `S(t) = sum_n c_n*exp(-lam_n*t)`, and `S(0) = 1`
EXACTLY (the density integrates to 1) — this identity is the basis of the
rebate-at-hit derivation below.

Same 5 triggers / rebate timings as `barrier_single.py`; knock-in via
parity (`vanilla - out`), since there's no simple cui/cdi-style closed
form for a strip.

**Rebate at hit — derived here, not sourced from a paper.** The
first-passage density is `-S'(t) = sum_n c_n*lam_n*exp(-lam_n*t)`, giving
expected discounted rebate `rebate * sum_n c_n*lam_n/(r+lam_n)*(1-exp(-(r+lam_n)*T))`.
As `n -> infinity`, `lam_n -> infinity`, so `lam_n/(r+lam_n) -> 1` and the
exp term `-> 0` — each tail mode's contribution `-> c_n`. Truncating at 256
modes and adding the EXACT tail correction `(1 - sum_{n<=256} c_n)` (using
`S(0)=1`) avoids the O(1/n) truncation error this specific kernel is prone
to (the same bug pattern as the earlier web-lab double-barrier fix). This
was verified against a dedicated fine-step hitting-time Monte Carlo, not
merely asserted — see the benchmark section.

**Barrier-negligible guard**: the coefficients `c_n` decay like O(1/n), so
`sum_{n<=256} c_n` undershoots 1 by an amount that does NOT vanish as
`t -> 0` (representing a near-delta initial condition needs infinitely many
modes) — unlike the rebate kernel's tail, which genuinely -> 1 for any
fixed t. When both barriers are >8 standard deviations away (in log space)
from spot, the truncated sum is bypassed entirely in favor of the exact
`S=1` / `price=vanilla` limit, rather than papering over the truncation
bias.

## Benchmark

`barrier_double_qmc.py`: a double barrier's continuous crossing probability
has no simple closed form (it's itself an infinite series), so this
benchmark uses a dense discrete grid (4096 steps/year default) for every
trigger including "continuous" — discretization bias shrinks like
`O(1/sqrt(steps))` and was confirmed to converge toward the closed form by
hand (a 1024/2048/4096/8192-step sweep gave 0.732/0.706/0.684/0.677,
extrapolating to ~0.66 against the closed form's 0.653).

## Tests — `test_barrier_double.py` (40 tests)

`S(0)=1` checked directly (not just through a price), in+out parity,
already-breached / wide-barrier / narrow-corridor edge cases. Measured
errors:

| check | error |
|---|---|
| continuous vs dense-grid QMC | 4.672% (documented <8% bound; slow O(1/sqrt(m)) convergence) |
| daily vs matched discrete QMC | 0.756% |
| weekly vs matched discrete QMC | 0.824% |
| rebate-at-hit vs dedicated fine-grid (4096 steps/yr) hitting-time MC | 0.219% |
| sloped term-vol vs QMC | 6.543% |

## Seasoned state and PFE vectorisation

`already_touched` (bool, scalar or per-scenario array): same semantics as
`barrier_single.md`, with "touched" meaning EITHER barrier was breached.
Additionally, a spot **currently** beyond a barrier with
`already_touched=False` knocks *now* — in that case a rebate-at-hit's PV is
the full undiscounted rebate (this fixed an earlier version that wrongly
discounted the immediate rebate by the whole remaining maturity).

`spot` is vectorised: the sine-series mode sums and the Simpson payoff
integral batch over the whole scenario vector as matrix products.

## Throughput (PFE inner loop)

Measured on this dev machine (100,000-scenario spot array, best of 5,
continuous trigger, 256 modes x 640 Simpson intervals): **~105K prices/s**
— an order of magnitude slower than the single barrier, dominated by the
(scenarios x modes) @ (modes x grid) density product.
