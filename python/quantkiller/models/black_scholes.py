"""Black–Scholes–Merton closed form with continuous dividend yield, plus Greeks.

Model (derivation: docs/models/black-scholes.md):

    d1 = [ln(S/K) + (r - q + σ²/2) T] / (σ √T)
    d2 = d1 - σ √T
    call = S e^{-qT} N(d1) - K e^{-rT} N(d2)
    put  = K e^{-rT} N(-d2) - S e^{-qT} N(-d1)

Conventions: r and q continuously compounded, T in years, σ annualized.
theta is per year; vega and rho are per unit of vol / rate.

Edge conventions (shared by all languages, see contracts/README.md):
  T == 0        -> price = intrinsic; delta = indicator (0.5 at-the-money);
                   gamma = vega = theta = rho = 0.
  σ == 0, T > 0 -> price = discounted forward intrinsic; delta accordingly;
                   other Greeks 0.
"""

import math

from ..qkmath import norm_cdf, norm_pdf
from ._common import CALL, get_num, get_option_type


def price(spot, strike, rate, div_yield, vol, time, option_type):
    """Return dict with price, delta, gamma, vega, theta, rho (+ d1, d2 when defined)."""
    is_call = option_type == CALL
    sign = 1.0 if is_call else -1.0

    if time == 0.0:
        intrinsic = max(sign * (spot - strike), 0.0)
        if spot == strike:
            delta = sign * 0.5
        else:
            in_money = sign * (spot - strike) > 0.0
            delta = sign if in_money else 0.0
        return {"price": intrinsic, "delta": delta, "gamma": 0.0,
                "vega": 0.0, "theta": 0.0, "rho": 0.0}

    df_r = math.exp(-rate * time)
    df_q = math.exp(-div_yield * time)

    if vol == 0.0:
        fwd = spot * df_q / df_r  # e^{-rT}·max(±(F-K),0) with F = S e^{(r-q)T}
        intrinsic = max(sign * (fwd - strike), 0.0) * df_r
        in_money = sign * (fwd - strike) > 0.0
        delta = sign * df_q if in_money else 0.0
        return {"price": intrinsic, "delta": delta, "gamma": 0.0,
                "vega": 0.0, "theta": 0.0, "rho": 0.0}

    sqrt_t = math.sqrt(time)
    d1 = (math.log(spot / strike) + (rate - div_yield + 0.5 * vol * vol) * time) / (vol * sqrt_t)
    d2 = d1 - vol * sqrt_t
    pdf_d1 = norm_pdf(d1)

    gamma = df_q * pdf_d1 / (spot * vol * sqrt_t)
    vega = spot * df_q * pdf_d1 * sqrt_t

    if is_call:
        nd1, nd2 = norm_cdf(d1), norm_cdf(d2)
        p = spot * df_q * nd1 - strike * df_r * nd2
        delta = df_q * nd1
        theta = (-spot * df_q * pdf_d1 * vol / (2.0 * sqrt_t)
                 + div_yield * spot * df_q * nd1
                 - rate * strike * df_r * nd2)
        rho = strike * time * df_r * nd2
    else:
        nmd1, nmd2 = norm_cdf(-d1), norm_cdf(-d2)
        p = strike * df_r * nmd2 - spot * df_q * nmd1
        delta = -df_q * nmd1
        theta = (-spot * df_q * pdf_d1 * vol / (2.0 * sqrt_t)
                 - div_yield * spot * df_q * nmd1
                 + rate * strike * df_r * nmd2)
        rho = -strike * time * df_r * nmd2

    return {"price": p, "delta": delta, "gamma": gamma, "vega": vega,
            "theta": theta, "rho": rho, "d1": d1, "d2": d2}


def run(params: dict) -> dict:
    return price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        vol=get_num(params, "vol", minimum=0.0),
        time=get_num(params, "time", minimum=0.0),
        option_type=get_option_type(params),
    )
