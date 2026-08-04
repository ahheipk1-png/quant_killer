"""Shared test fixtures: an independent Black-Scholes oracle built directly
from math.erf, so tests never trust qkmath.norm_cdf to grade its own homework.
"""

import math


def oracle_norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def oracle_black_scholes(spot, strike, rate, div_yield, vol, time, is_call):
    """Independent Black-Scholes-Merton reference, built from math.erf only."""
    if time == 0.0:
        return max((spot - strike) if is_call else (strike - spot), 0.0)
    root_t = math.sqrt(time)
    d1 = (math.log(spot / strike) + (rate - div_yield + 0.5 * vol * vol) * time) / (vol * root_t)
    d2 = d1 - vol * root_t
    df_r = math.exp(-rate * time)
    df_q = math.exp(-div_yield * time)
    if is_call:
        return spot * df_q * oracle_norm_cdf(d1) - strike * df_r * oracle_norm_cdf(d2)
    return strike * df_r * oracle_norm_cdf(-d2) - spot * df_q * oracle_norm_cdf(-d1)
