# Digital and barrier payoffs

> Documentation status: synchronized with the current formula/PDE/bridge-QMC regressions on 2026-08-04.

## Cash-or-nothing digital

```text
cash * 1{call: S(T) > K; put: S(T) < K}
```

The strict terminal inequality is intentional. Supported reference methods are closed form, PDE, MC, and QMC.

Reduction: a unit cash digital is the negative strike derivative of a vanilla call and can be approximated with a tight symmetric call spread.

## Single barrier

The vanilla terminal payoff is multiplied by a survival or hit indicator. The barrier can be up/down and knock-in/knock-out.

```text
knock-out: vanilla payoff * 1{barrier never hit}
knock-in:  vanilla payoff * 1{barrier hit}
```

The formula treats monitoring as continuous. The base MC path uses Brownian-bridge survival probabilities between simulated monitoring dates. The direct advanced payoff consumes its simulated monitored path.

Reduction:

```text
single knock-in + matching single knock-out = vanilla
```

## Double barrier

The contract monitors lower and upper barriers. A double knock-out survives only if neither boundary is hit; the matching knock-in pays when a boundary is hit.

Reference methods include a spectral series, PDE, MC, and QMC.

Reduction:

```text
double knock-in + matching double knock-out = vanilla
```

Barrier conventions, continuous versus discrete monitoring, rebate rules, and barrier equality treatment must be explicit when extending these products. The current implementation has no separate rebate input.

The pricing regression matrix varies call/put direction, strike, maturity, and
single/double barrier placement. Formula/PDE comparisons target continuous
monitoring; path methods use their stated bridge correction or discrete path
convention, so tolerances are method-specific.
