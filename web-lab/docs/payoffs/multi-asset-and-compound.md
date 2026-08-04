# Multi-asset, basket, and compound payoffs

> Documentation status: synchronized with the current basket and four-way compound tests on 2026-08-04.

## Rainbow

The current rainbow product applies a vanilla call/put direction to either the best or worst selected terminal asset value.

Reduction: identical, perfectly correlated assets reduce to the matching vanilla option.

## Himalayan

At each observation, the best return among remaining assets is locked and that asset is removed. The payoff applies a strike to the average selected returns and scales by notional.

Reduction: one asset and one observation reduce to a scaled vanilla call on return.

## Effective baskets

Compatible payoffs may replace their single underlying with:

- weighted sum of prices,
- order statistic of performance,
- weighted sum of returns,
- return of a weighted price sum.

Direct tests verify the constructed series numerically before it enters a payoff. See [volatility and baskets](../models/volatility-and-baskets.md) for path-model details.

The current UI/ABI supports up to three assets, three weights, and one common
pairwise correlation. General covariance matrices or larger baskets require a
contract extension.

## Compound options

At decision time, the outer option is written on the value of an inner European call or put:

```text
max(phi_outer * (V_inner(S(t_decision)) - K_compound), 0)
```

All four combinations are supported:

- call on call,
- put on call,
- call on put,
- put on put.

The constant-volatility reference uses a generalized Geske formula. The path method simulates to the compound decision time and values the remaining inner option there.

Reductions and identities:

- zero compound strike for a call-on-call → underlying call;
- outer call minus outer put → inner option value minus discounted compound strike.

The generalized closed form is a constant-volatility reference. Term, local,
Heston, and SLV combinations use path methods under the current dispatch rules.
