"""Monte Carlo pricing of European options under GBM.

Exact algorithm specified in contracts/rng-spec.md §5 — the loop order,
accumulation order, and antithetic pairing are part of the spec so that
all five languages produce the same price for the same seed.

    S_T = S · exp[(r - q - σ²/2)T + σ√T · Z]
    price = e^{-rT} · mean(payoffs),  std_error = e^{-rT} · √(var/n)

With antithetic=true each sample is the average of the payoffs at +Z and -Z.
"""

import math

from .. import QKError
from ..rng import Pcg32
from ._common import CALL, get_bool, get_int, get_num, get_option_type


def price(spot, strike, rate, div_yield, vol, time, option_type, paths, seed, antithetic):
    is_call = option_type == CALL
    sign = 1.0 if is_call else -1.0

    if time <= 0.0:
        raise QKError("monte_carlo_gbm requires time > 0")
    if paths < 2:
        raise QKError("monte_carlo_gbm requires paths >= 2")

    rng = Pcg32(seed)
    disc = math.exp(-rate * time)
    drift = (rate - div_yield - 0.5 * vol * vol) * time
    volt = vol * math.sqrt(time)

    total = 0.0
    total_sq = 0.0
    for _ in range(paths):
        z = rng.next_normal()
        p1 = max(sign * (spot * math.exp(drift + volt * z) - strike), 0.0)
        if antithetic:
            p2 = max(sign * (spot * math.exp(drift - volt * z) - strike), 0.0)
            s = 0.5 * (p1 + p2)
        else:
            s = p1
        total += s
        total_sq += s * s

    mean = total / paths
    var = (total_sq - paths * mean * mean) / (paths - 1)
    if var < 0.0:  # single-pass variance can go slightly negative at var ~ 0
        var = 0.0

    return {"price": disc * mean,
            "std_error": disc * math.sqrt(var / paths)}


def run(params: dict) -> dict:
    return price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        vol=get_num(params, "vol", minimum=0.0),
        time=get_num(params, "time", minimum=0.0),
        option_type=get_option_type(params),
        paths=get_int(params, "paths", minimum=2),
        seed=get_int(params, "seed", default=42, minimum=0),
        antithetic=get_bool(params, "antithetic", True),
    )
