"""Cox–Ross–Rubinstein binomial tree, European and American.

Tree parameters (derivation: docs/models/binomial.md):

    Δt = T/n,  u = e^{σ√Δt},  d = 1/u,
    p  = (e^{(r-q)Δt} - d) / (u - d),   discount per step e^{-rΔt}

Backward induction over option values; American style takes
max(continuation, intrinsic) at every node.

Tree Greeks (standard estimates, deterministic across languages):
    delta from the two step-1 nodes,
    gamma from the three step-2 nodes,
    theta from the middle step-2 node vs the root over 2Δt.

The loop order below IS the spec — every language reproduces it exactly.
"""

import math

from .. import QKError
from ._common import CALL, get_int, get_num, get_option_type, get_style


def price(spot, strike, rate, div_yield, vol, time, option_type, style, steps):
    is_call = option_type == CALL
    sign = 1.0 if is_call else -1.0
    american = style == "american"

    if vol <= 0.0:
        raise QKError("binomial_crr requires vol > 0")
    if time <= 0.0:
        raise QKError("binomial_crr requires time > 0")

    dt = time / steps
    u = math.exp(vol * math.sqrt(dt))
    d = 1.0 / u
    a = math.exp((rate - div_yield) * dt)
    p = (a - d) / (u - d)
    if not 0.0 < p < 1.0:
        raise QKError(f"CRR risk-neutral probability out of (0,1): p={p}; "
                      "use more steps or check rate/div_yield/vol")
    disc = math.exp(-rate * dt)
    u2 = u * u

    # Terminal layer: S_j = spot * d^n * u^{2j},  j = 0..n
    values = [0.0] * (steps + 1)
    s = spot * (d ** steps)
    for j in range(steps + 1):
        values[j] = max(sign * (s - strike), 0.0)
        s *= u2

    # Saved low-layer values for Greeks
    v2 = None  # option values at step 2 (3 nodes)
    v1 = None  # option values at step 1 (2 nodes)

    for i in range(steps - 1, -1, -1):  # layer i has i+1 nodes
        s = spot * (d ** i)
        for j in range(i + 1):
            cont = disc * (p * values[j + 1] + (1.0 - p) * values[j])
            if american:
                cont = max(cont, sign * (s - strike))
            values[j] = cont
            s *= u2
        if i == 2:
            v2 = values[0:3]
        elif i == 1:
            v1 = values[0:2]

    root = values[0]

    results = {"price": root}
    if steps >= 2 and v1 is not None and v2 is not None:
        s_u, s_d = spot * u, spot * d
        delta = (v1[1] - v1[0]) / (s_u - s_d)
        s_uu, s_mid, s_dd = spot * u2, spot, spot * d * d
        delta_up = (v2[2] - v2[1]) / (s_uu - s_mid)
        delta_dn = (v2[1] - v2[0]) / (s_mid - s_dd)
        gamma = (delta_up - delta_dn) / (0.5 * (s_uu - s_dd))
        theta = (v2[1] - root) / (2.0 * dt)
        results.update({"delta": delta, "gamma": gamma, "theta": theta})
    return results


def run(params: dict) -> dict:
    return price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        vol=get_num(params, "vol", minimum=0.0),
        time=get_num(params, "time", minimum=0.0),
        option_type=get_option_type(params),
        style=get_style(params),
        steps=get_int(params, "steps", minimum=1),
    )
