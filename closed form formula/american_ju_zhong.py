"""American-exercise option via the Ju-Zhong (1999) quadratic approximation
-- a second-order correction to Barone-Adesi-Whaley (1987), chosen over
Bjerksund-Stensland 2002 after measuring Ju-Zhong to be both more accurate
AND ~290x faster (see web-lab/docs and this project's earlier American-method
study). NPV only. Self-contained (numpy/scipy only).

Ported and adapted from python/quantkiller/models/american.py (this
project's own validated reference implementation, tested against CRR-tree
convergence and cross-checked against BAW/Bjerksund/Carr) -- adapted here to
add: a term-vol curve (collapsed to a single effective vol, the same
approximate-under-term-vol convention as every barrier family), an explicit
borrow rate folded into the effective dividend yield ("borrow is part of the
asset", the web-lab convention), and payment_time deferral.

Requires rate >= 0 and (div_yield + borrow) >= 0 -- Ju-Zhong/BAW are not
defined/tested outside that regime (see project CLAUDE.md).
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


def effective_vol(vol_times, vol_values, maturity):
    if maturity <= 0.0:
        return 0.0
    return math.sqrt(max(total_variance(vol_times, vol_values, maturity), 0.0) / maturity)


def _intrinsic(spot, strike, is_call):
    return max((spot - strike) if is_call else (strike - spot), 0.0)


def _european_price(spot, strike, rate, div_yield, vol, time, is_call):
    if time <= 0.0:
        return _intrinsic(spot, strike, is_call)
    if vol <= 0.0:
        forward = spot * math.exp((rate - div_yield) * time)
        payoff = max(forward - strike, 0.0) if is_call else max(strike - forward, 0.0)
        return math.exp(-rate * time) * payoff
    root_t = vol * math.sqrt(time)
    disc_pay = math.exp(-rate * time)
    disc_carry = math.exp(-div_yield * time)
    d1 = (math.log(spot / strike) + (rate - div_yield + 0.5 * vol * vol) * time) / root_t
    d2 = d1 - root_t
    if is_call:
        return spot * disc_carry * norm.cdf(d1) - strike * disc_pay * norm.cdf(d2)
    return strike * disc_pay * norm.cdf(-d2) - spot * disc_carry * norm.cdf(-d1)


def _baw_critical_price(strike, rate, div_yield, vol, time, is_call):
    # m = 2*rate*T/variance has a root at rate=0 (upper_exponent=0 for puts
    # with n<1), a genuine singularity of the BAW boundary equation, not a
    # real answer; nudge away from it by an economically negligible amount.
    rate = max(rate, 1e-6)
    variance = vol * vol * time
    root_variance = math.sqrt(variance)
    risk_free_discount = math.exp(-rate * time)
    dividend_discount = math.exp(-div_yield * time)
    n = 2.0 * math.log(dividend_discount / risk_free_discount) / variance
    m = -2.0 * math.log(risk_free_discount) / variance
    carry_time = math.log(dividend_discount / risk_free_discount)

    if is_call:
        upper_exponent = (-(n - 1.0) + math.sqrt((n - 1.0) ** 2 + 4.0 * m)) / 2.0
        upper = strike / (1.0 - 1.0 / upper_exponent)
        h = -(carry_time + 2.0 * root_variance) * strike / (upper - strike)
        boundary = strike + (upper - strike) * (1.0 - math.exp(h))
    else:
        upper_exponent = (-(n - 1.0) - math.sqrt((n - 1.0) ** 2 + 4.0 * m)) / 2.0
        upper = strike / (1.0 - 1.0 / upper_exponent)
        h = (carry_time - 2.0 * root_variance) * strike / (strike - upper)
        boundary = upper + (strike - upper) * math.exp(h)

    coefficient = (
        -2.0 * math.log(risk_free_discount) / (variance * (1.0 - risk_free_discount))
        if abs(1.0 - risk_free_discount) > 1.0e-12 else 2.0 / variance
    )
    exponent = (
        (-(n - 1.0) + math.sqrt((n - 1.0) ** 2 + 4.0 * coefficient)) / 2.0 if is_call
        else (-(n - 1.0) - math.sqrt((n - 1.0) ** 2 + 4.0 * coefficient)) / 2.0
    )

    for _ in range(100):
        forward_boundary = boundary * dividend_discount / risk_free_discount
        d1 = (math.log(forward_boundary / strike) + 0.5 * variance) / root_variance
        european = _european_price(boundary, strike, rate, div_yield, vol, time, is_call)
        if is_call:
            lhs = boundary - strike
            rhs = european + (1.0 - dividend_discount * norm.cdf(d1)) * boundary / exponent
            slope = (dividend_discount * norm.cdf(d1) * (1.0 - 1.0 / exponent)
                     + (1.0 - dividend_discount * norm.pdf(d1) / root_variance) / exponent)
            if abs(lhs - rhs) / strike <= 1.0e-8:
                break
            boundary = (strike + rhs - slope * boundary) / (1.0 - slope)
        else:
            lhs = strike - boundary
            rhs = european - (1.0 - dividend_discount * norm.cdf(-d1)) * boundary / exponent
            slope = (-dividend_discount * norm.cdf(-d1) * (1.0 - 1.0 / exponent)
                     - (1.0 + dividend_discount * norm.pdf(-d1) / root_variance) / exponent)
            if abs(lhs - rhs) / strike <= 1.0e-8:
                break
            boundary = (strike - rhs + slope * boundary) / (1.0 + slope)
    return boundary, exponent


def _baw_price(spot, strike, rate, div_yield, vol, time, is_call):
    european = _european_price(spot, strike, rate, div_yield, vol, time, is_call)
    intrinsic = _intrinsic(spot, strike, is_call)
    if vol <= 0.005 or (is_call and div_yield <= 0.0):
        return max(european, intrinsic)

    boundary, exponent = _baw_critical_price(strike, rate, div_yield, vol, time, is_call)
    variance = vol * vol * time
    d1 = (math.log(boundary * math.exp((rate - div_yield) * time) / strike) + 0.5 * variance) / math.sqrt(variance)
    dividend_discount = math.exp(-div_yield * time)
    if is_call:
        coefficient = boundary / exponent * (1.0 - dividend_discount * norm.cdf(d1))
        value = european + coefficient * (spot / boundary) ** exponent if spot < boundary else intrinsic
    else:
        coefficient = -boundary / exponent * (1.0 - dividend_discount * norm.cdf(-d1))
        value = european + coefficient * (spot / boundary) ** exponent if spot > boundary else intrinsic
    return max(value, european, intrinsic)


def _ju_zhong_price(spot, strike, rate, div_yield, vol, time, is_call):
    european = _european_price(spot, strike, rate, div_yield, vol, time, is_call)
    intrinsic = _intrinsic(spot, strike, is_call)
    if vol <= 0.005 or (is_call and div_yield <= 0.0):
        return max(european, intrinsic)
    if abs(rate) < 1e-9:
        return _baw_price(spot, strike, rate, div_yield, vol, time, is_call)

    boundary, _ = _baw_critical_price(strike, rate, div_yield, vol, time, is_call)
    phi = 1.0 if is_call else -1.0
    variance = vol * vol * time
    root_variance = math.sqrt(variance)
    risk_free_discount = math.exp(-rate * time)
    dividend_discount = math.exp(-div_yield * time)
    h = 1.0 - risk_free_discount
    alpha = -2.0 * math.log(risk_free_discount) / variance
    beta = 2.0 * math.log(dividend_discount / risk_free_discount) / variance
    radical = math.sqrt((beta - 1.0) ** 2 + 4.0 * alpha / h)
    exponent = (-(beta - 1.0) + phi * radical) / 2.0
    exponent_prime = -phi * alpha / (h * h * radical)
    european_boundary = _european_price(boundary, strike, rate, div_yield, vol, time, is_call)
    premium_boundary = phi * (boundary - strike) - european_boundary
    denominator = 2.0 * exponent + beta - 1.0
    if abs(premium_boundary) < 1e-12 or abs(denominator) < 1e-12:
        return _baw_price(spot, strike, rate, div_yield, vol, time, is_call)

    forward_boundary = boundary * dividend_discount / risk_free_discount
    d1 = (math.log(forward_boundary / strike) + 0.5 * variance) / root_variance
    d2 = d1 - root_variance
    european_h = (forward_boundary * norm.pdf(d1) / (alpha * root_variance)
                  - phi * forward_boundary * norm.cdf(phi * d1)
                  * math.log(dividend_discount) / math.log(risk_free_discount)
                  + phi * strike * norm.cdf(phi * d2))
    quadratic = (1.0 - h) * alpha * exponent_prime / (2.0 * denominator)
    linear = -(1.0 - h) * alpha / denominator * (european_h / premium_boundary + 1.0 / h + exponent_prime / denominator)
    log_ratio = math.log(spot / boundary)
    chi = log_ratio * (quadratic * log_ratio + linear)
    if not math.isfinite(chi) or abs(1.0 - chi) <= 1e-8:
        return _baw_price(spot, strike, rate, div_yield, vol, time, is_call)

    continuation_region = phi * (boundary - spot) > 0.0
    value = (european + premium_boundary * (spot / boundary) ** exponent / (1.0 - chi)
             if continuation_region else intrinsic)
    return max(value, european, intrinsic)


def price_american_ju_zhong(
    spot,
    strike,
    rate,
    div_yield,
    borrow,
    maturity,
    option_type,
    vol_times,
    vol_values,
    payment_time=None,
    *,
    value_date,
):
    """American option NPV via Ju-Zhong (falls back to BAW/European in the
    degenerate regimes documented in ju_zhong_price).

    `value_date` (required) follows the same three-regime convention as
    every other family; for American exercise, value_date >= maturity means
    the position has already reduced to (or been exercised into) its
    intrinsic value, deferred-discounted to payment_time if that's later.
    `strike == 0` is handled via the same economically negligible epsilon
    substitution as the barrier families (BAW/Ju-Zhong bake strike into
    several log() terms with no clean K=0 special case).
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    eff_div_yield = div_yield + borrow
    if rate < 0.0 or eff_div_yield < 0.0:
        raise ValueError("Ju-Zhong/BAW require rate >= 0 and (div_yield + borrow) >= 0.")
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

    strike = max(strike, 1e-8 * max(spot, 1.0))

    if value_date >= maturity:
        return _intrinsic(spot, strike, is_call) * math.exp(-rate * (payment_time - value_date))

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    vol = effective_vol(vol_times, vol_values, maturity)
    deferral = math.exp(-rate * (payment_time - maturity))

    price = _ju_zhong_price(spot, strike, rate, eff_div_yield, vol, maturity, is_call)
    return price * deferral
