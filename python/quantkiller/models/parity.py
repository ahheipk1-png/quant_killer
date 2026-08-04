"""Put–call parity (derivation: docs/models/put-call-parity.md).

    C - P = S·e^{-qT} - K·e^{-rT}

Give one leg to derive the other; give both legs to measure the arbitrage
residual (0 for consistent European prices):

    residual = C - P - (S·e^{-qT} - K·e^{-rT})
"""

import math

from .. import QKError
from ._common import get_num


def run(params: dict) -> dict:
    spot = get_num(params, "spot", minimum=0.0, strict_min=True)
    strike = get_num(params, "strike", minimum=0.0, strict_min=True)
    rate = get_num(params, "rate")
    div_yield = get_num(params, "div_yield", default=0.0)
    time = get_num(params, "time", minimum=0.0)

    has_call = "call_price" in params
    has_put = "put_price" in params
    if not has_call and not has_put:
        raise QKError("put_call_parity needs call_price and/or put_price")

    basis = spot * math.exp(-div_yield * time) - strike * math.exp(-rate * time)
    results = {}
    if has_call and has_put:
        call = get_num(params, "call_price")
        put = get_num(params, "put_price")
        results["residual"] = call - put - basis
    elif has_call:
        call = get_num(params, "call_price")
        results["put_price"] = call - basis
        results["residual"] = 0.0
    else:
        put = get_num(params, "put_price")
        results["call_price"] = put + basis
        results["residual"] = 0.0
    return results
