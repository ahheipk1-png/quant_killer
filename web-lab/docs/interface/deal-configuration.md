# Deal configuration

> Documentation status: synchronized with the current browser forms and packed path contract on 2026-08-04.

## Shared market inputs

| Field | Meaning | Internal unit |
|---|---|---|
| `spot` | Initial asset level | Currency/price units |
| `strike` | Payoff strike | Same units as spot |
| `maturity` | Time to maturity | Years |
| `rate` | Continuously compounded risk-free rate | Decimal |
| `dividendYield` | Continuous dividend yield | Decimal |
| `volatility` | Initial volatility | Decimal |
| `optionType` | Call or put direction | `call` / `put` |
| `paths` | MC/QMC sample count | Integer |
| `seed` | Reproducible PCG/digital-shift seed | Unsigned integer semantics |

The browser forms display rates and volatilities as percentages and convert them to decimals before pricing. Portfolio JSON overrides are already in internal units unless a product explicitly uses a ratio.

## Schedules

- `monitoringSteps`: number of equal monitoring times.
- `exerciseDates`: number of equal Bermudan exercise times.
- `observationTimes`: explicit increasing year fractions ending no later than maturity.
- `includeInitialFixing`: includes spot at time zero in an Asian average.

The advanced browser form can generate observation times from calendar dates using ACT/365F and weekend adjustment. Explicit numerical `observationTimes` are preferred in code and portfolio JSON.

The packed advanced contract reserves 260 schedule entries. Longer arrays are
truncated by the browser-side packer and should instead be rejected explicitly
by a future versioned schema.

## Volatility-model inputs

- Term: `termVolatility` is the maturity-end instantaneous volatility.
- Local: `localBeta` controls the bounded leverage `(S/S0)^beta`.
- Heston: `hestonKappa`, `hestonLongRunVol`, `hestonVolOfVol`, and `hestonRho`.
- SLV: combines the Heston variance factor and local leverage.

## Basket inputs

- `underlyingMode`: `single`, `weighted-price`, `order-performance`, `weighted-returns`, or `return-of-weighted-sum`.
- `basketAssetCount`: two or three in the current UI.
- `basketWeights`: array of weights; normalized by the engine when needed.
- `basketOrder`: one-based performance rank.
- Secondary assets use `spot2`, `volatility2`, `dividendYield2` and the corresponding `3` fields.
- `correlation` is the common cross-asset correlation in the current path construction.

## Portfolio JSON overrides

The portfolio ticket exposes common fields directly and accepts specialized fields in a JSON object. Examples:

```json
{"barrier":130,"barrierDirection":"up","barrierStyle":"out"}
```

```json
{"observationTimes":[0.08,0.21,0.43,0.68,1.0],"includeInitialFixing":true}
```

```json
{"notional":100,"coupon":0.02,"couponBarrier":0.7,"autocallBarrier":1.0,"protectionBarrier":0.7}
```

Invalid product configurations are reported on their individual portfolio rows.

## PDE controls

- `pdeGrid` / `pdeSpotGrid`: spot intervals.
- `pdeAverageGrid`: Asian accumulated-sum intervals.
- `pdeTimeSteps`: time intervals.
- `pdeGridType`: `uniform`, `sinh-strike`, or `sinh-spot`.
- `pdeGridConcentration`: sinh scale as a fraction of domain width; smaller values cluster more strongly.
- `pdePayoffSmoothing`: `none` or `cell-average`.
- `pdeRannacherSteps`: initial damped time intervals; each is replaced by two fully implicit half steps.
- `pdeSorOmega`, `pdeTolerance`, and `pdeMaxIterations`: American iterative-solver controls.
- `pdePenalty`: American penalty coefficient.

American PDE method identifiers are `pde-projection`, `pde-psor`, and `pde-penalty`.

## Volatility-surface quote CSV

The separate Volatility Surface Lab accepts these column families:

```text
maturity,strike,iv[,weight]
maturity,strike,bidiv,askiv[,weight]
maturity,strike,price,type[,weight]
```

Volatility values may be entered as decimals or percentages. CVI infers a mid
from bid/ask when `iv` is absent and locks maturity interpolation to linear
total variance so the evaluated surface matches its joint-expiry constraints.

## Public result shape

Pricing dispatchers return `price`, `standardError`, `standardDeviation`, and
`samples`, with method/runtime metadata added by the controller. Deterministic
Sobol has no classical standard error; randomized shifts provide an empirical
error estimate where exposed.
