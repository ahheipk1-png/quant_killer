"""Digital (binary) options: cash-or-nothing and asset-or-nothing, single
underlying and weighted basket.

Self-contained (numpy/scipy only). NPV only, no Greeks.

Single-asset -- EXACT, same building block as european.py:

    cash-or-nothing call = disc_pay * cash * N(d2)
    cash-or-nothing put  = disc_pay * cash * N(-d2)
    asset-or-nothing call = disc_pay * F * N(d1)
    asset-or-nothing put  = disc_pay * F * N(-d1)

with d1, d2 from the same (F, K, W) as european.price_european. Exact under
term vol for the same reason europeans are: it only ever uses total
variance W(T), never an instantaneous vol.

Basket -- APPROXIMATE, via a 2-moment (Levy) match. The weighted sum of
correlated lognormals B = sum(w_i * S_i(T)) is not itself lognormal, but
its first two moments are closed form:

    F_i          = S_i * exp((r - q_i - b_i) * T)      per-asset forward
    F            = sum(w_i * F_i)                       basket forward
    Cov_ij       = rho_ij * sqrt(W_i(T) * W_j(T))        cross log-covariance
    E[B^2]       = sum_i sum_j (w_i F_i)(w_j F_j) exp(Cov_ij)
    W_basket     = ln(E[B^2] / F^2)

Then the SAME digital formulas above are evaluated on (F, W_basket) as if
the basket were a single lognormal asset. This is the one approximate step
in this family; the tests report its measured error against a Sobol
reference rather than assert an unverified tolerance.
"""

import math

import numpy as np
from scipy.stats import norm


def total_variance(vol_times, vol_values, t):
    """Verbatim copy of european.total_variance."""
    vt = np.atleast_1d(np.asarray(vol_times, dtype=float))
    vv = np.atleast_1d(np.asarray(vol_values, dtype=float))
    if vt.shape != vv.shape:
        raise ValueError("vol_times and vol_values must have the same length.")
    if np.any(vt <= 0.0):
        raise ValueError("Vol pillar times must be strictly positive.")
    order = np.argsort(vt)
    vt, vv = vt[order], vv[order]
    pillar_t = np.concatenate(([0.0], vt))
    pillar_w = np.concatenate(([0.0], vv * vv * vt))
    if np.any(np.diff(pillar_w) < -1e-10):
        raise ValueError("Term-vol curve implies negative forward variance.")
    t_arr = np.atleast_1d(np.asarray(t, dtype=float))
    w = np.interp(t_arr, pillar_t, pillar_w)
    last_t = pillar_t[-1]
    if last_t > 0.0:
        last_sigma2 = pillar_w[-1] / last_t
        beyond = t_arr > last_t
        if np.any(beyond):
            w = np.where(beyond, pillar_w[-1] + last_sigma2 * (t_arr - last_t), w)
    return float(w[0]) if np.ndim(t) == 0 else w


def _d1_d2(forward, strike, w):
    root_w = math.sqrt(w)
    d1 = (math.log(forward / strike) + 0.5 * w) / root_w
    return d1, d1 - root_w


def price_digital(
    spot,
    strike,
    rate,
    div_yield,
    borrow,
    maturity,
    option_type,
    payout_type,
    vol_times,
    vol_values,
    cash=1.0,
    payment_time=None,
    *,
    value_date,
):
    """Single-asset digital. `option_type` in {"call","put"};
    `payout_type` in {"cash", "asset"}. `spot` may be an array.

    `value_date` (required; see european.price_european's docstring for the
    full three-regime semantics) and `strike == 0` (handled directly, no
    log-based formula) follow the same conventions as every other family.
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    if payout_type not in ("cash", "asset"):
        raise ValueError('payout_type must be "cash" or "asset".')
    if strike < 0.0:
        raise ValueError("strike must be non-negative.")
    if payment_time is None:
        payment_time = maturity
    if payment_time < maturity - 1e-12:
        raise ValueError("payment_time cannot precede maturity.")
    if value_date < 0.0:
        raise ValueError("value_date must be non-negative.")

    spot = np.asarray(spot, dtype=float)
    is_call = option_type == "call"

    if value_date > payment_time:
        return 0.0 * spot

    if value_date >= maturity:
        above = spot > strike
        hit = above if is_call else ~above
        payoff = np.where(hit, (cash if payout_type == "cash" else spot), 0.0)
        return payoff * math.exp(-rate * (payment_time - value_date))

    remaining_maturity = maturity - value_date
    remaining_payment = payment_time - value_date
    carry = rate - div_yield - borrow
    disc_pay = math.exp(-rate * remaining_payment)
    forward = spot * np.exp(carry * remaining_maturity)

    if strike == 0.0:
        # forward > 0 always (spot > 0), so a call is always in the money
        # and a put never is -- no log-based formula needed.
        if is_call:
            return disc_pay * (cash if payout_type == "cash" else forward)
        return 0.0 * forward

    w = total_variance(vol_times, vol_values, remaining_maturity)
    if w <= 1e-14:
        above = forward > strike
        hit = above if is_call else ~above
        payoff = np.where(hit, (cash if payout_type == "cash" else forward), 0.0)
        return disc_pay * payoff

    root_w = math.sqrt(w)
    d1 = (np.log(forward / strike) + 0.5 * w) / root_w
    d2 = d1 - root_w
    sign = 1.0 if is_call else -1.0
    if payout_type == "cash":
        return disc_pay * cash * norm.cdf(sign * d2)
    return disc_pay * forward * norm.cdf(sign * d1)


def basket_forward_and_variance(
    spots, weights, rate, div_yields, borrows, maturity, vol_times_list, vol_values_list, correlation,
):
    """2-moment (Levy) match of a weighted basket to an effective single
    lognormal. Returns (basket_spot_today, basket_forward, total_variance).
    `correlation` may be a scalar (equicorrelation, matching every
    off-diagonal pair) or a full (n, n) matrix.
    """
    spots = np.asarray(spots, dtype=float)
    weights = np.asarray(weights, dtype=float)
    n = spots.size
    if weights.size != n:
        raise ValueError("weights must match spots in length.")
    div_yields = np.broadcast_to(np.asarray(div_yields, dtype=float), (n,))
    borrows = np.broadcast_to(np.asarray(borrows, dtype=float), (n,))
    carries = rate - div_yields - borrows
    forwards = spots * np.exp(carries * maturity)
    basket_spot = float(np.sum(weights * spots))
    basket_forward = float(np.sum(weights * forwards))

    total_vars = np.array(
        [total_variance(vol_times_list[i], vol_values_list[i], maturity) for i in range(n)]
    )
    if np.ndim(correlation) == 0:
        corr = np.full((n, n), float(correlation))
        np.fill_diagonal(corr, 1.0)
    else:
        corr = np.asarray(correlation, dtype=float)
        if corr.shape != (n, n):
            raise ValueError("correlation matrix must be (n, n).")

    cov = corr * np.sqrt(np.outer(total_vars, total_vars))
    legs = weights * forwards
    second_moment = float(legs @ np.exp(cov) @ legs)
    if second_moment <= basket_forward * basket_forward * (1.0 + 1e-14):
        w_basket = 0.0
    else:
        w_basket = math.log(second_moment / (basket_forward * basket_forward))
    return basket_spot, basket_forward, max(w_basket, 0.0)


def price_digital_basket(
    spots,
    weights,
    strike,
    rate,
    div_yields,
    borrows,
    maturity,
    option_type,
    payout_type,
    vol_times_list,
    vol_values_list,
    correlation,
    cash=1.0,
    payment_time=None,
    *,
    value_date,
):
    """Basket digital via the 2-moment moment-matched effective lognormal.
    See module docstring: this is the family's one approximate step.
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    if payout_type not in ("cash", "asset"):
        raise ValueError('payout_type must be "cash" or "asset".')
    if strike < 0.0:
        raise ValueError("strike must be non-negative.")
    if payment_time is None:
        payment_time = maturity
    if payment_time < maturity - 1e-12:
        raise ValueError("payment_time cannot precede maturity.")
    if value_date < 0.0:
        raise ValueError("value_date must be non-negative.")

    is_call = option_type == "call"

    if value_date > payment_time:
        return 0.0

    if value_date >= maturity:
        # No approximation needed once realized: use the TRUE basket value
        # from the given (now realized) per-asset spots directly, not the
        # moment-matched proxy.
        basket_realized = float(np.sum(np.asarray(weights, dtype=float) * np.asarray(spots, dtype=float)))
        hit = (basket_realized > strike) if is_call else (basket_realized <= strike)
        payoff = (cash if payout_type == "cash" else basket_realized) if hit else 0.0
        return payoff * math.exp(-rate * (payment_time - value_date))

    remaining_maturity = maturity - value_date
    remaining_payment = payment_time - value_date
    _, forward, w = basket_forward_and_variance(
        spots, weights, rate, div_yields, borrows, remaining_maturity, vol_times_list, vol_values_list, correlation,
    )
    disc_pay = math.exp(-rate * remaining_payment)

    if strike == 0.0:
        if is_call:
            return disc_pay * (cash if payout_type == "cash" else forward)
        return 0.0

    if w <= 1e-14:
        hit = (forward > strike) if is_call else (forward <= strike)
        payoff = (cash if payout_type == "cash" else forward) if hit else 0.0
        return disc_pay * payoff

    d1, d2 = _d1_d2(forward, strike, w)
    sign = 1.0 if is_call else -1.0
    if payout_type == "cash":
        return disc_pay * cash * norm.cdf(sign * d2)
    return disc_pay * forward * norm.cdf(sign * d1)
