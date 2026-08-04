# Realized variance and volatility products

> Documentation status: synchronized with the current swap, option, and static-replication tests on 2026-08-04.

## Realized statistic

The path engine computes annualized realized variance from discrete log returns:

```text
RV = annualization * sum_i(log(S_i/S_(i-1))^2) / elapsed_time
```

Realized volatility is `sqrt(max(RV,0))`.

## Variance swap

```text
varianceNotional * (RV - varianceStrike)
```

The payoff may be positive or negative. A separate reference method statically replicates the expected variance leg with an OTM Black-Scholes option strip.

## Volatility swap

```text
varianceNotional * (sqrt(RV) - volatilityStrike)
```

The field is named `varianceNotional` in the shared contract even when it scales a volatility product.

## Option on variance

```text
varianceNotional * max(phi * (RV - varianceStrike), 0)
```

## Option on volatility

```text
varianceNotional * max(phi * (sqrt(RV) - volatilityStrike), 0)
```

All four path-dependent statistics use the configured observation schedule and are discounted to present value. The static-replication method applies only to the variance swap reference case.

The realized statistic uses simple discrete log returns without separate
corporate-action, disruption, corridor, cap, or holiday-adjustment rules. The
static strip is a Black-Scholes reference integral; it is not a replication of
volatility swaps or options on realized variance/volatility.
