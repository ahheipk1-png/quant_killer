# Path-dependent payoffs

> Documentation status: synchronized with the current Asian, lookback, ladder, and accumulator tests on 2026-08-04.

## Discrete arithmetic Asian

```text
max(phi * (mean(S(t_i)) - K), 0)
```

Fixings may be evenly spaced or explicitly uneven. The initial spot can optionally participate. Reference methods include Levy, shifted-lognormal, two Curran variants, Ju order-six expansion, Asian ADI, MC, and QMC.

The browser can also generate a monthly weekday-adjusted schedule using
ACT/365F. That generator adjusts weekends only and should not be described as a
full business-day calendar.

Reduction: one fixing at maturity without an initial fixing is a vanilla option.

## Fixed-strike lookback

```text
call: max(max_i S(t_i) - K, 0)
put:  max(K - min_i S(t_i), 0)
```

Monitoring is discrete in the path engine. Reduction: a single terminal fixing is vanilla.

## Ladder

The payoff locks intrinsic value when configured price rungs are crossed, then compares the locked amount with terminal intrinsic value. Call rungs are normally above strike; put rungs are normally below strike.

Reduction: if no rung can be reached, the payoff is terminal vanilla.

## Accumulator

At each fixing before an upper knock-out, the holder receives a scheduled quantity of `(S_i-K)`. The quantity is multiplied by downside gearing when spot is below strike.

```text
sum_i q_i * (S_i-K), until first upper knock-out
```

Each fixing is discounted at its own time by the pricing engine. The direct tests cover favorable accumulation, downside gearing, and termination before settlement on the knock-out fixing.

For all path-dependent products, changing the observation schedule can be as
material as changing volatility. Tests should therefore retain explicit fixing
times rather than relying only on a fixing count.
