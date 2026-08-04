# Payoff family map

> Documentation status: synchronized with the 75 direct payoff cases on 2026-08-04.

The project currently tests 20 payoff or effective-underlying families. The files in this folder group related products while retaining each payoff's definition and key reductions.

The executable browser report currently contains 75 direct payoff cases across
these families. Pricing identities and independent-method comparisons are kept
in separate groups, bringing the full report to 182 passing rows.

| Family | Documentation | Core reduction |
|---|---|---|
| Vanilla | [vanilla and exercise](vanilla-and-exercise.md) | European Black-Scholes |
| American | [vanilla and exercise](vanilla-and-exercise.md) | No-dividend call → European call |
| Bermudan | [vanilla and exercise](vanilla-and-exercise.md) | One exercise date → European |
| Digital | [barriers and digitals](barriers-and-digitals.md) | Tight vanilla call spread |
| Single barrier | [barriers and digitals](barriers-and-digitals.md) | Knock-in + knock-out → vanilla |
| Double barrier | [barriers and digitals](barriers-and-digitals.md) | Double in + double out → vanilla |
| Asian | [path dependent](path-dependent.md) | One terminal fixing → vanilla |
| Lookback | [path dependent](path-dependent.md) | One terminal fixing → vanilla |
| Ladder | [path dependent](path-dependent.md) | Unreachable rungs → vanilla |
| Accumulator | [path dependent](path-dependent.md) | Sum of scheduled geared purchases |
| Rainbow | [multi-asset and compound](multi-asset-and-compound.md) | Identical perfectly correlated assets → vanilla |
| Himalayan | [multi-asset and compound](multi-asset-and-compound.md) | One asset/fixing → scaled vanilla |
| Basket underlying | [multi-asset and compound](multi-asset-and-compound.md) | Direct weighted/ranked path checks |
| Compound | [multi-asset and compound](multi-asset-and-compound.md) | Zero outer strike → inner option |
| Autocallable | [structured products](structured-products.md) | No call/coupon + protection → zero-coupon note |
| Phoenix autocall | [structured products](structured-products.md) | Conditional coupon/call/redemption scenarios |
| Yield seeker | [structured products](structured-products.md) | Phoenix-style note without autocall |
| Variance swap | [realized volatility](realized-volatility.md) | Realized variance less strike |
| Volatility swap | [realized volatility](realized-volatility.md) | Square root of realized variance less strike |
| Variance/volatility option | [realized volatility](realized-volatility.md) | Vanilla payoff applied to realized statistic |

## Convention

`phi = +1` for a call and `phi = -1` for a put. Discounting belongs to the pricing method; the payoff definitions below describe cash flow before discounting unless a payment time is explicitly part of the contract.

Product labels are not substitutes for term sheets. Monitoring, barrier
equality, coupon memory, settlement, fixing calendars, and basket construction
must remain explicit inputs or documented conventions.
