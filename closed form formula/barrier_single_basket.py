"""Single barrier option on a WEIGHTED-SUM basket B = sum_i weights[i]*S_i(T).
NPV only. Self-contained (numpy/scipy only) -- deliberately duplicates the
core Reiner-Rubinstein machinery from barrier_single.py verbatim rather than
importing it (see that file's docstring for the same design note).

Basket handling: effective-lognormal (2-moment / Levy) match. The sum of
correlated lognormals isn't itself lognormal, but its first two moments are
closed-form from the forwards and pairwise log-covariance, so the basket's
terminal law is collapsed to a single synthetic GBM (spot = actual basket
spot B0 = sum w_i*S_i(0), forward = matched forward F, vol = matched total
variance) and handed to the SAME single-asset barrier machinery used for a
single underlying. This is an approximation for any payoff whose value
depends on the basket's PATH (i.e. every trigger except "european" -- a
single terminal-only check IS exact under the matched terminal law, up to
the moment-matching approximation itself); the paired QMC benchmark
measures the actual size of that gap rather than asserting it away.
"""

import math

import numpy as np
from scipy.stats import norm

BGK_BETA = 0.5825971579390107
_OBS_PER_YEAR = {"daily": 252.0, "weekly": 52.0, "monthly": 12.0}


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


def basket_effective_lognormal(spots, weights, rate, div_yields, borrows, maturity,
                                vol_times_list, vol_values_list, correlation):
    """2-moment (Levy) match: returns (basket_spot, eff_vol, eff_carry)."""
    spots = np.asarray(spots, dtype=float)
    weights = np.asarray(weights, dtype=float)
    n = spots.size
    div_yields = np.broadcast_to(np.asarray(div_yields, dtype=float), (n,))
    borrows = np.broadcast_to(np.asarray(borrows, dtype=float), (n,))
    carries = rate - div_yields - borrows
    forwards = spots * np.exp(carries * maturity)
    basket_spot = float(np.sum(weights * spots))
    forward = float(np.sum(weights * forwards))

    if np.ndim(correlation) == 0:
        corr = np.full((n, n), float(correlation))
        np.fill_diagonal(corr, 1.0)
    else:
        corr = np.asarray(correlation, dtype=float)

    total_vars = np.array([total_variance(vol_times_list[i], vol_values_list[i], maturity) for i in range(n)])
    root_vars = np.sqrt(np.maximum(total_vars, 0.0))
    cov = corr * np.outer(root_vars, root_vars)
    legs = weights * forwards
    second_moment = float(legs @ np.exp(cov) @ legs)
    if forward <= 0.0 or second_moment <= forward * forward * (1.0 + 1e-14):
        w_basket = 0.0
    else:
        w_basket = math.log(second_moment / (forward * forward))
    eff_vol = math.sqrt(max(w_basket, 0.0) / maturity) if maturity > 0.0 else 0.0
    eff_carry = math.log(forward / basket_spot) / maturity if (maturity > 0.0 and basket_spot > 0.0) else 0.0
    return basket_spot, eff_vol, eff_carry


def _bgk_shift(barrier, vol, obs_per_year, direction):
    factor = math.exp(BGK_BETA * vol * math.sqrt(1.0 / obs_per_year))
    return barrier * factor if direction == "up" else barrier / factor


def _truncated_vanilla(spot, strike, rate, carry, maturity, option_type, vol, lower, upper):
    disc_pay = math.exp(-rate * maturity)
    disc_carry = math.exp((carry - rate) * maturity)
    root_t = vol * math.sqrt(maturity)
    if root_t <= 0.0:
        forward = spot * math.exp(carry * maturity)
        inside = lower < forward < upper
        payoff = max(forward - strike, 0.0) if option_type == "call" else max(strike - forward, 0.0)
        return disc_pay * payoff if inside else 0.0

    def d1(level):
        if level <= 0.0:
            return math.inf
        if math.isinf(level):
            return -math.inf
        return (math.log(spot / level) + (carry + 0.5 * vol * vol) * maturity) / root_t

    def d2(level):
        return d1(level) - root_t

    if option_type == "call":
        a, b = max(lower, strike), upper
    else:
        a, b = lower, min(upper, strike)
    if a >= b:
        return 0.0
    stock_leg = spot * disc_carry * (norm.cdf(d1(a)) - norm.cdf(d1(b)))
    cash_leg = strike * disc_pay * (norm.cdf(d2(a)) - norm.cdf(d2(b)))
    return stock_leg - cash_leg if option_type == "call" else cash_leg - stock_leg


def _reiner_rubinstein(spot, strike, rate, carry, maturity, vol, barrier, option_type, direction, style):
    phi = 1.0 if option_type == "call" else -1.0
    eta = 1.0 if direction == "down" else -1.0
    root_t = vol * math.sqrt(maturity)
    disc_pay = math.exp(-rate * maturity)
    disc_carry = math.exp((carry - rate) * maturity)

    if vol <= 0.01 or maturity <= 0.0:
        forward = spot * math.exp(carry * maturity)
        touched = (forward >= barrier) if direction == "up" else (forward <= barrier)
        vanilla = disc_pay * (max(forward - strike, 0.0) if option_type == "call" else max(strike - forward, 0.0))
        if style == "out":
            return 0.0 if touched else vanilla
        return vanilla if touched else 0.0

    mu = (carry - 0.5 * vol * vol) / (vol * vol)

    def n(x):
        return norm.cdf(x)

    x1 = math.log(spot / strike) / root_t + (1.0 + mu) * root_t
    x2 = math.log(spot / barrier) / root_t + (1.0 + mu) * root_t
    y1 = math.log(barrier * barrier / (spot * strike)) / root_t + (1.0 + mu) * root_t
    y2 = math.log(barrier / spot) / root_t + (1.0 + mu) * root_t

    log_hs = math.log(barrier / spot)
    power1 = 2.0 * (mu + 1.0)
    power2 = 2.0 * mu
    with np.errstate(over="ignore"):
        image_asset = math.exp(power1 * log_hs) if abs(power1 * log_hs) < 700 else (math.inf if power1 * log_hs > 0 else 0.0)
        image_cash = math.exp(power2 * log_hs) if abs(power2 * log_hs) < 700 else (math.inf if power2 * log_hs > 0 else 0.0)

    term_a = phi * spot * disc_carry * n(phi * x1) - phi * strike * disc_pay * n(phi * x1 - phi * root_t)
    term_b = phi * spot * disc_carry * n(phi * x2) - phi * strike * disc_pay * n(phi * x2 - phi * root_t)
    term_c = (
        phi * spot * disc_carry * image_asset * n(eta * y1)
        - phi * strike * disc_pay * image_cash * n(eta * y1 - eta * root_t)
    )
    term_d = (
        phi * spot * disc_carry * image_asset * n(eta * y2)
        - phi * strike * disc_pay * image_cash * n(eta * y2 - eta * root_t)
    )

    is_call = option_type == "call"
    if is_call and direction == "down":
        knock_in = term_c if strike >= barrier else (term_a - term_b + term_d)
    elif is_call and direction == "up":
        knock_in = term_a if strike >= barrier else (term_b - term_c + term_d)
    elif (not is_call) and direction == "up":
        knock_in = (term_a - term_b + term_d) if strike >= barrier else term_c
    else:  # put, down
        knock_in = (term_b - term_c + term_d) if strike >= barrier else term_a

    d1v = (math.log(spot / strike) + (carry + 0.5 * vol * vol) * maturity) / root_t
    d2v = d1v - root_t
    vanilla = phi * spot * disc_carry * n(phi * d1v) - phi * strike * disc_pay * n(phi * d2v)

    knock_out = vanilla - knock_in
    return knock_out if style == "out" else knock_in


def _touch_probability(spot, rate, carry, maturity, vol, barrier, direction):
    if vol <= 0.01 or maturity <= 0.0:
        forward = spot * math.exp(carry * maturity)
        touched = (forward >= barrier) if direction == "up" else (forward <= barrier)
        return 1.0 if touched else 0.0
    root_t = vol * math.sqrt(maturity)
    mu = (carry - 0.5 * vol * vol) / (vol * vol)
    eta = 1.0 if direction == "down" else -1.0
    x2 = math.log(spot / barrier) / root_t + (1.0 + mu) * root_t
    y2 = math.log(barrier / spot) / root_t + (1.0 + mu) * root_t
    log_hs = math.log(barrier / spot)
    power2 = 2.0 * mu
    image_cash = math.exp(power2 * log_hs) if abs(power2 * log_hs) < 700 else (math.inf if power2 * log_hs > 0 else 0.0)
    no_touch = norm.cdf(eta * x2 - eta * root_t) - image_cash * norm.cdf(eta * y2 - eta * root_t)
    return 1.0 - no_touch


def _rebate_at_expiry(spot, rate, carry, maturity, vol, barrier, direction, style, rebate):
    touch_prob = _touch_probability(spot, rate, carry, maturity, vol, barrier, direction)
    disc = math.exp(-rate * maturity)
    return rebate * disc * (touch_prob if style == "out" else (1.0 - touch_prob))


def _rebate_at_hit(spot, rate, carry, maturity, vol, barrier, direction, rebate):
    if vol <= 0.01 or maturity <= 0.0:
        forward = spot * math.exp(carry * maturity)
        touched = (forward >= barrier) if direction == "up" else (forward <= barrier)
        return rebate * math.exp(-rate * maturity) if touched else 0.0
    root_t = vol * math.sqrt(maturity)
    mu = (carry - 0.5 * vol * vol) / (vol * vol)
    lam = math.sqrt(max(mu * mu + 2.0 * rate / (vol * vol), 0.0))
    eta = 1.0 if direction == "down" else -1.0
    z = math.log(barrier / spot) / root_t + lam * root_t
    log_hs = math.log(barrier / spot)
    p1 = mu + lam
    p2 = mu - lam
    hs1 = math.exp(p1 * log_hs) if abs(p1 * log_hs) < 700 else (math.inf if p1 * log_hs > 0 else 0.0)
    hs2 = math.exp(p2 * log_hs) if abs(p2 * log_hs) < 700 else (math.inf if p2 * log_hs > 0 else 0.0)
    return rebate * (hs1 * norm.cdf(eta * z) + hs2 * norm.cdf(eta * z - 2.0 * eta * lam * root_t))


def price_barrier_single_basket(
    spots,
    weights,
    strike,
    rate,
    div_yields,
    borrows,
    maturity,
    option_type,
    barrier,
    direction,
    style,
    trigger,
    vol_times_list,
    vol_values_list,
    correlation,
    rebate=0.0,
    rebate_timing="hit",
    payment_time=None,
    *,
    value_date,
):
    """Single barrier on a weighted-sum basket. n=1, weights=[1.0] is the
    single-underlying case (reproduces barrier_single.py exactly).

    `value_date` (required) and `strike == 0` (epsilon substitution) follow
    barrier_single.py's conventions. For value_date >= maturity, the TRUE
    realized basket value (sum(weights*spots), not the moment-matched
    proxy) is used -- once realized, no approximation is needed.
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    if direction not in ("up", "down"):
        raise ValueError('direction must be "up" or "down".')
    if style not in ("in", "out"):
        raise ValueError('style must be "in" or "out".')
    if trigger not in ("european", "monthly", "weekly", "daily", "continuous"):
        raise ValueError('trigger must be one of "european","monthly","weekly","daily","continuous".')
    if rebate_timing not in ("hit", "expiry"):
        raise ValueError('rebate_timing must be "hit" or "expiry".')
    if barrier <= 0.0:
        raise ValueError("barrier must be positive.")
    if strike < 0.0:
        raise ValueError("strike must be non-negative.")
    if payment_time is None:
        payment_time = maturity
    if payment_time < maturity - 1e-12:
        raise ValueError("payment_time cannot precede maturity.")
    if value_date < 0.0:
        raise ValueError("value_date must be non-negative.")
    if rebate != 0.0 and rebate_timing == "hit" and style == "in":
        raise ValueError('rebate_timing="hit" is undefined for style="in".')
    if rebate != 0.0 and rebate_timing == "hit" and trigger == "european":
        raise ValueError('rebate_timing="hit" is undefined for trigger="european".')

    if value_date > payment_time:
        return 0.0

    if value_date >= maturity:
        realized = float(np.sum(np.asarray(weights, dtype=float) * np.asarray(spots, dtype=float)))
        strike_eff = max(strike, 1e-8 * max(realized, 1.0))
        touched0 = (realized >= barrier) if direction == "up" else (realized <= barrier)
        intrinsic = max(realized - strike_eff, 0.0) if option_type == "call" else max(strike_eff - realized, 0.0)
        price = (0.0 if touched0 else intrinsic) if style == "out" else (intrinsic if touched0 else 0.0)
        return price * math.exp(-rate * (payment_time - value_date))

    remaining_maturity = maturity - value_date
    remaining_payment = payment_time - value_date
    basket_spot, eff_vol, eff_carry = basket_effective_lognormal(
        spots, weights, rate, div_yields, borrows, remaining_maturity, vol_times_list, vol_values_list, correlation
    )
    strike = max(strike, 1e-8 * max(basket_spot, 1.0))
    maturity = remaining_maturity
    payment_time = remaining_payment
    deferral = math.exp(-rate * (payment_time - maturity))

    if trigger == "european":
        if direction == "up":
            lower, upper = (barrier, math.inf) if style == "in" else (0.0, barrier)
        else:
            lower, upper = (0.0, barrier) if style == "in" else (barrier, math.inf)
        price = _truncated_vanilla(basket_spot, strike, rate, eff_carry, maturity, option_type, eff_vol, lower, upper)
        if rebate != 0.0:
            price += _rebate_at_expiry(basket_spot, rate, eff_carry, maturity, eff_vol, barrier, direction, style, rebate)
        return price * deferral

    if trigger in _OBS_PER_YEAR:
        shifted_barrier = _bgk_shift(barrier, eff_vol, _OBS_PER_YEAR[trigger], direction)
    else:
        shifted_barrier = barrier

    price = _reiner_rubinstein(basket_spot, strike, rate, eff_carry, maturity, eff_vol, shifted_barrier,
                                option_type, direction, style)
    if rebate != 0.0 and rebate_timing == "expiry":
        price += _rebate_at_expiry(basket_spot, rate, eff_carry, maturity, eff_vol, shifted_barrier, direction, style, rebate)
    price *= deferral
    if rebate != 0.0 and rebate_timing == "hit":
        price += _rebate_at_hit(basket_spot, rate, eff_carry, maturity, eff_vol, shifted_barrier, direction, rebate)
    return price
