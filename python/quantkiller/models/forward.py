"""Forward / futures pricing by cost of carry (derivation: docs/models/forward.md).

    F = S · e^{(r-q)T}

`q` (div_yield) is any continuous income yield on the asset: dividend yield,
foreign interest rate (FX), or convenience yield net of storage (commodities).

Value of an existing long forward with delivery price K:

    f = (F - K) · e^{-rT}
"""

import math

from ._common import get_num


def price(spot, rate, div_yield, time, strike=None):
    fwd = spot * math.exp((rate - div_yield) * time)
    results = {"forward_price": fwd}
    if strike is not None:
        results["value"] = (fwd - strike) * math.exp(-rate * time)
    return results


def run(params: dict) -> dict:
    strike = None
    if "strike" in params:
        strike = get_num(params, "strike")
    return price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        time=get_num(params, "time", minimum=0.0),
        strike=strike,
    )
