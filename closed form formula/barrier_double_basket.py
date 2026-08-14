"""Double barrier option on a WEIGHTED-SUM basket B = sum_i weights[i]*S_i(T).
NPV only. Self-contained (numpy/scipy only) -- deliberately duplicates the
core spectral machinery from barrier_double.py verbatim rather than
importing it (see that file's docstring for the design note this mirrors).

Basket handling: same effective-lognormal (2-moment/Levy) collapse used in
barrier_single_basket.py -- see that file's docstring for the rationale and
its documented limits (exact for the terminal law up to the moment-matching
approximation; approximate for anything path-dependent, i.e. every trigger
except "european").
"""

import math

import numpy as np
from scipy.stats import norm

BGK_BETA = 0.5825971579390107
NUM_MODES = 256
_Y_INTERVALS = 640
_OBS_PER_YEAR = {"daily": 252.0, "weekly": 52.0, "monthly": 12.0}
_SIGMA_UNREACHABLE = 8.0


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


def _bgk_shift_double(lower, upper, vol, obs_per_year):
    factor = math.exp(BGK_BETA * vol * math.sqrt(1.0 / obs_per_year))
    return lower / factor, upper * factor


def _barrier_negligible(spot, vol, maturity, lower, upper):
    root_t = vol * math.sqrt(maturity)
    if root_t <= 1e-12:
        return True
    dist_lower = math.log(spot / lower)
    dist_upper = math.log(upper / spot)
    return min(dist_lower, dist_upper) > _SIGMA_UNREACHABLE * root_t


def _strip_modes(spot, carry, vol, lower, upper):
    log_l, log_u = math.log(lower), math.log(upper)
    width = log_u - log_l
    x0 = math.log(spot) - log_l
    theta = (carry - 0.5 * vol * vol) / (vol * vol)
    n = np.arange(1, NUM_MODES + 1)
    wave = n * math.pi / width
    lam = 0.5 * vol * vol * wave * wave + 0.5 * theta * theta * vol * vol
    sign = np.where(n % 2 == 0, 1.0, -1.0)
    i_n = wave / (theta * theta + wave * wave) * (1.0 - sign * math.exp(theta * width))
    c_n = (2.0 / width) * np.sin(wave * x0) * i_n
    return {"log_l": log_l, "width": width, "x0": x0, "theta": theta, "wave": wave, "lam": lam, "c": c_n}


def _survival_probability(spot, carry, vol, maturity, lower, upper):
    if not (lower < spot < upper):
        return 0.0
    if _barrier_negligible(spot, vol, maturity, lower, upper):
        return 1.0
    st = _strip_modes(spot, carry, vol, lower, upper)
    return float(np.clip(np.sum(st["c"] * np.exp(-st["lam"] * maturity)), 0.0, 1.0))


def _vanilla_price(spot, strike, rate, carry, maturity, vol, option_type):
    root_t = vol * math.sqrt(maturity)
    disc_pay = math.exp(-rate * maturity)
    disc_carry = math.exp((carry - rate) * maturity)
    if root_t <= 0.0:
        forward = spot * math.exp(carry * maturity)
        return disc_pay * (max(forward - strike, 0.0) if option_type == "call" else max(strike - forward, 0.0))
    d1 = (math.log(spot / strike) + (carry + 0.5 * vol * vol) * maturity) / root_t
    d2 = d1 - root_t
    if option_type == "call":
        return spot * disc_carry * norm.cdf(d1) - strike * disc_pay * norm.cdf(d2)
    return strike * disc_pay * norm.cdf(-d2) - spot * disc_carry * norm.cdf(-d1)


def _spectral_out_price(spot, strike, rate, carry, maturity, vol, lower, upper, option_type):
    if not (lower < spot < upper):
        return 0.0
    if _barrier_negligible(spot, vol, maturity, lower, upper):
        return _vanilla_price(spot, strike, rate, carry, maturity, vol, option_type)
    st = _strip_modes(spot, carry, vol, lower, upper)
    width, x0, theta = st["width"], st["x0"], st["theta"]
    mode_decay = np.exp(-st["lam"] * maturity)
    mode_vec = np.sin(st["wave"] * x0) * mode_decay

    y_grid = np.linspace(0.0, width, _Y_INTERVALS + 1)
    dy = width / _Y_INTERVALS
    simp_w = np.ones(_Y_INTERVALS + 1)
    simp_w[1:-1:2] = 4.0
    simp_w[2:-1:2] = 2.0

    sin_y = np.sin(np.outer(st["wave"], y_grid))
    series = mode_vec @ sin_y
    density = (2.0 / width) * np.exp(theta * (y_grid - x0)) * series
    density = np.maximum(density, 0.0)

    prices_y = np.exp(y_grid + st["log_l"])
    payoff = np.maximum(prices_y - strike, 0.0) if option_type == "call" else np.maximum(strike - prices_y, 0.0)
    undiscounted = float(np.sum(simp_w * density * payoff)) * dy / 3.0
    disc_pay = math.exp(-rate * maturity)
    return disc_pay * undiscounted


def _european_touch_probability(spot, rate, carry, maturity, vol, lower, upper):
    root_t = vol * math.sqrt(maturity)
    if root_t <= 0.0:
        forward = spot * math.exp(carry * maturity)
        return 0.0 if lower < forward < upper else 1.0
    mean = math.log(spot) + carry * maturity - 0.5 * vol * vol * maturity
    z_lower = (math.log(lower) - mean) / root_t
    z_upper = (math.log(upper) - mean) / root_t
    inside = norm.cdf(z_upper) - norm.cdf(z_lower)
    return float(np.clip(1.0 - inside, 0.0, 1.0))


def _truncated_vanilla_region(spot, strike, rate, carry, maturity, option_type, vol, lower, upper):
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


def _rebate_at_expiry_double(spot, rate, carry, maturity, vol, lower, upper, style, rebate, trigger):
    if trigger == "european":
        touch_prob = _european_touch_probability(spot, rate, carry, maturity, vol, lower, upper)
    else:
        touch_prob = 1.0 - _survival_probability(spot, carry, vol, maturity, lower, upper)
    disc = math.exp(-rate * maturity)
    return rebate * disc * (touch_prob if style == "out" else (1.0 - touch_prob))


def _rebate_at_hit_double(spot, rate, carry, maturity, vol, lower, upper, rebate):
    if not (lower < spot < upper):
        # Already beyond a barrier: the hit happens NOW -- undiscounted.
        return rebate
    st = _strip_modes(spot, carry, vol, lower, upper)
    c, lam = st["c"], st["lam"]
    kernel = lam / (rate + lam) * (1.0 - np.exp(-(rate + lam) * maturity))
    truncated = float(np.sum(c * kernel))
    tail_correction = 1.0 - float(np.sum(c))
    return rebate * (truncated + tail_correction)


def price_barrier_double_basket(
    spots,
    weights,
    strike,
    rate,
    div_yields,
    borrows,
    maturity,
    option_type,
    lower_barrier,
    upper_barrier,
    style,
    trigger,
    vol_times_list,
    vol_values_list,
    correlation,
    rebate=0.0,
    rebate_timing="hit",
    payment_time=None,
    already_touched=False,
    *,
    value_date,
):
    """Double barrier on a weighted-sum basket. n=1, weights=[1.0] is the
    single-underlying case (reproduces barrier_double.py exactly).

    `already_touched` (scalar bool -- one scenario per call, `spots` being
    the per-asset vector) is the seasoned state: whether EITHER barrier was
    breached before value_date. Semantics as barrier_single_basket.py.

    `value_date` (required) and `strike == 0` (epsilon substitution) follow
    barrier_single_basket.py's conventions -- see that file's docstring.
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    if style not in ("in", "out"):
        raise ValueError('style must be "in" or "out".')
    if trigger not in ("european", "monthly", "weekly", "daily", "continuous"):
        raise ValueError('trigger must be one of "european","monthly","weekly","daily","continuous".')
    if rebate_timing not in ("hit", "expiry"):
        raise ValueError('rebate_timing must be "hit" or "expiry".')
    if lower_barrier <= 0.0 or upper_barrier <= lower_barrier:
        raise ValueError("Require 0 < lower_barrier < upper_barrier.")
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
    if already_touched and trigger == "european":
        raise ValueError('already_touched is meaningless for trigger="european" (barrier observed only at maturity).')

    if value_date > payment_time:
        return 0.0

    if value_date >= maturity:
        realized = float(np.sum(np.asarray(weights, dtype=float) * np.asarray(spots, dtype=float)))
        strike_eff = max(strike, 1e-8 * max(realized, 1.0))
        beyond = not (lower_barrier < realized < upper_barrier)
        eff_touched = (already_touched or beyond) if trigger != "european" else beyond
        intrinsic = max(realized - strike_eff, 0.0) if option_type == "call" else max(strike_eff - realized, 0.0)
        disc = math.exp(-rate * (payment_time - value_date))
        price = (0.0 if eff_touched else intrinsic) if style == "out" else (intrinsic if eff_touched else 0.0)
        price *= disc
        if rebate != 0.0 and rebate_timing == "expiry":
            price += rebate * disc * (1.0 if (eff_touched == (style == "out")) else 0.0)
        return price

    remaining_maturity = maturity - value_date
    remaining_payment = payment_time - value_date
    basket_spot, eff_vol, eff_carry = basket_effective_lognormal(
        spots, weights, rate, div_yields, borrows, remaining_maturity, vol_times_list, vol_values_list, correlation
    )
    strike = max(strike, 1e-8 * max(basket_spot, 1.0))
    maturity = remaining_maturity
    payment_time = remaining_payment
    deferral = math.exp(-rate * (payment_time - maturity))

    if already_touched:
        if style == "out":
            # Dead option; only a still-owed expiry rebate survives.
            if rebate != 0.0 and rebate_timing == "expiry":
                return rebate * math.exp(-rate * payment_time)
            return 0.0
        # Activated: vanilla European on the effective-GBM basket; no rebate.
        vanilla = _vanilla_price(basket_spot, strike, rate, eff_carry, maturity, eff_vol, option_type)
        return vanilla * deferral

    if not (lower_barrier < basket_spot < upper_barrier):
        vanilla = _vanilla_price(basket_spot, strike, rate, eff_carry, maturity, eff_vol, option_type)
        price = 0.0 if style == "out" else vanilla
        if rebate != 0.0 and rebate_timing == "expiry":
            price += rebate * math.exp(-rate * maturity) * (1.0 if style == "out" else 0.0)
        price *= deferral
        if rebate != 0.0 and rebate_timing == "hit":
            # Effective basket is beyond a barrier NOW: the hit happens
            # immediately, so the rebate's PV is the undiscounted rebate
            # (fixes an earlier full-maturity discounting).
            price += rebate
        return price

    if trigger == "european":
        out_price = _truncated_vanilla_region(basket_spot, strike, rate, eff_carry, maturity, option_type, eff_vol,
                                               lower_barrier, upper_barrier)
        eff_lower, eff_upper = lower_barrier, upper_barrier
    else:
        if trigger in _OBS_PER_YEAR:
            eff_lower, eff_upper = _bgk_shift_double(lower_barrier, upper_barrier, eff_vol, _OBS_PER_YEAR[trigger])
        else:
            eff_lower, eff_upper = lower_barrier, upper_barrier
        out_price = _spectral_out_price(basket_spot, strike, rate, eff_carry, maturity, eff_vol,
                                         eff_lower, eff_upper, option_type)

    vanilla = _vanilla_price(basket_spot, strike, rate, eff_carry, maturity, eff_vol, option_type)
    price = out_price if style == "out" else (vanilla - out_price)

    if rebate != 0.0 and rebate_timing == "expiry":
        price += _rebate_at_expiry_double(basket_spot, rate, eff_carry, maturity, eff_vol, eff_lower, eff_upper,
                                           style, rebate, trigger)
    price *= deferral
    if rebate != 0.0 and rebate_timing == "hit":
        price += _rebate_at_hit_double(basket_spot, rate, eff_carry, maturity, eff_vol, eff_lower, eff_upper, rebate)
    return price
