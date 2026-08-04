"""Implied volatility: invert Black–Scholes–Merton for σ.

Algorithm (deterministic, shared by all languages — docs/models/implied-vol.md):

  1. No-arbitrage bounds check on the target price.
  2. Initial guess: Brenner–Subrahmanyam σ₀ = √(2π/T)·target/spot,
     clamped to [1e-4, 5].
  3. Safeguarded Newton: keep a bisection bracket [lo, hi] = [1e-9, 5];
     take the Newton step σ - (price(σ)-target)/vega(σ) when it stays inside
     the bracket and vega is healthy, otherwise bisect.
  4. Stop when |price(σ) - target| ≤ 1e-12·(1 + |target|) or the bracket/step
     is below 1e-14. Hard cap: 100 iterations.
"""

import math

from .. import QKError
from ._common import CALL, get_num, get_option_type
from .black_scholes import price as bs_price

_SIGMA_MIN, _SIGMA_MAX = 1e-9, 5.0
_MAX_ITER = 100


def solve(target, spot, strike, rate, div_yield, time, option_type):
    if time <= 0.0:
        raise QKError("implied_vol requires time > 0")

    df_r = math.exp(-rate * time)
    df_q = math.exp(-div_yield * time)
    if option_type == CALL:
        lower = max(spot * df_q - strike * df_r, 0.0)
        upper = spot * df_q
    else:
        lower = max(strike * df_r - spot * df_q, 0.0)
        upper = strike * df_r

    tol = 1e-12 * (1.0 + abs(target))
    if target < lower - tol or target > upper + tol:
        raise QKError(f"target price {target} violates no-arbitrage bounds "
                      f"[{lower}, {upper}]")
    if target <= lower + tol:
        return {"implied_vol": 0.0, "iterations": 0.0}

    sigma = math.sqrt(2.0 * math.pi / time) * target / spot
    sigma = min(max(sigma, 1e-4), _SIGMA_MAX)
    lo, hi = _SIGMA_MIN, _SIGMA_MAX

    def f(vol):
        return bs_price(spot, strike, rate, div_yield, vol, time, option_type)

    iterations = 0
    for iterations in range(1, _MAX_ITER + 1):
        out = f(sigma)
        diff = out["price"] - target
        if abs(diff) <= tol:
            break
        if diff > 0.0:
            hi = sigma
        else:
            lo = sigma
        vega = out["vega"]
        step_ok = False
        if vega > 1e-12:
            candidate = sigma - diff / vega
            if lo < candidate < hi:
                step_ok = abs(candidate - sigma) > 1e-14
                sigma_next = candidate
        if not step_ok:
            sigma_next = 0.5 * (lo + hi)
            if abs(sigma_next - sigma) <= 1e-14:
                break
        sigma = sigma_next
    else:
        iterations = _MAX_ITER

    if abs(f(sigma)["price"] - target) > max(tol, 1e-8 * (1.0 + abs(target))):
        raise QKError("implied_vol did not converge")

    return {"implied_vol": sigma, "iterations": float(iterations)}


def run(params: dict) -> dict:
    return solve(
        target=get_num(params, "price", minimum=0.0),
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        time=get_num(params, "time", minimum=0.0),
        option_type=get_option_type(params),
    )
