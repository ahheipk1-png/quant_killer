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
asset", the web-lab convention), a cash-settlement lag (see
price_american_ju_zhong for the exact e^(-rL) factorization -- NOT the
European-style payment_time, which is ill-defined for American exercise),
and spot-vectorisation for the PFE inner loop.

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
    """Vectorised in spot (scalar in, scalar-like out)."""
    return np.maximum((spot - strike) if is_call else (strike - spot), 0.0)


def _european_price(spot, strike, rate, div_yield, vol, time, is_call):
    """Vectorised in spot; also called with the scalar BAW boundary."""
    spot = np.asarray(spot, dtype=float)
    if time <= 0.0:
        return _intrinsic(spot, strike, is_call)
    if vol <= 0.0:
        forward = spot * math.exp((rate - div_yield) * time)
        payoff = np.maximum(forward - strike, 0.0) if is_call else np.maximum(strike - forward, 0.0)
        return math.exp(-rate * time) * payoff
    root_t = vol * math.sqrt(time)
    disc_pay = math.exp(-rate * time)
    disc_carry = math.exp(-div_yield * time)
    d1 = (np.log(spot / strike) + (rate - div_yield + 0.5 * vol * vol) * time) / root_t
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
        european = float(_european_price(boundary, strike, rate, div_yield, vol, time, is_call))
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
    """Vectorised in spot: the critical boundary is spot-INDEPENDENT (it
    solves a fixed-point in (strike, rate, q, vol, T) only), so it is
    computed once and the closed-form pieces broadcast over the spot array
    -- this is what makes the PFE inner loop cheap."""
    spot = np.asarray(spot, dtype=float)
    european = _european_price(spot, strike, rate, div_yield, vol, time, is_call)
    intrinsic = _intrinsic(spot, strike, is_call)
    if vol <= 0.005 or (is_call and div_yield <= 0.0):
        return np.maximum(european, intrinsic)

    boundary, exponent = _baw_critical_price(strike, rate, div_yield, vol, time, is_call)
    variance = vol * vol * time
    d1 = (math.log(boundary * math.exp((rate - div_yield) * time) / strike) + 0.5 * variance) / math.sqrt(variance)
    dividend_discount = math.exp(-div_yield * time)
    if is_call:
        coefficient = boundary / exponent * (1.0 - dividend_discount * norm.cdf(d1))
        in_region = spot < boundary
    else:
        coefficient = -boundary / exponent * (1.0 - dividend_discount * norm.cdf(-d1))
        in_region = spot > boundary
    value = np.where(in_region, european + coefficient * (spot / boundary) ** exponent, intrinsic)
    return np.maximum(np.maximum(value, european), intrinsic)


def _ju_zhong_price(spot, strike, rate, div_yield, vol, time, is_call):
    """Vectorised in spot (see _baw_price: the boundary solve is spot-free).
    Per-element fallback to BAW where the chi correction is numerically
    invalid, instead of the scalar version's all-or-nothing fallback."""
    spot = np.asarray(spot, dtype=float)
    european = _european_price(spot, strike, rate, div_yield, vol, time, is_call)
    intrinsic = _intrinsic(spot, strike, is_call)
    if vol <= 0.005 or (is_call and div_yield <= 0.0):
        return np.maximum(european, intrinsic)
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
    european_boundary = float(_european_price(boundary, strike, rate, div_yield, vol, time, is_call))
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
    log_ratio = np.log(spot / boundary)
    chi = log_ratio * (quadratic * log_ratio + linear)

    continuation_region = phi * (boundary - spot) > 0.0
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        core = european + premium_boundary * (spot / boundary) ** exponent / (1.0 - chi)
    value = np.where(continuation_region, core, intrinsic)
    bad = ~np.isfinite(chi) | (np.abs(1.0 - chi) <= 1e-8) | ~np.isfinite(value)
    if np.any(bad):
        value = np.where(bad, _baw_price(spot, strike, rate, div_yield, vol, time, is_call), value)
    return np.maximum(np.maximum(value, european), intrinsic)


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
    settle_lag=0.0,
    *,
    value_date,
):
    """American option NPV via Ju-Zhong (falls back to BAW/European in the
    degenerate regimes documented in ju_zhong_price). `spot` may be a scalar
    or numpy array (PFE scenario vector); the return matches its shape.

    Settlement lag (replaces the European-style payment_time, which was a
    conceptual bug for American exercise: a fixed payment date detached
    from the exercise date has no consistent meaning when exercise can
    happen at any time). `settle_lag` >= 0 is the CASH-SETTLEMENT delay:
    exercising at time tau locks the cash amount (intrinsic at tau) which
    is then PAID at tau + settle_lag. This admits an EXACT closed form:

        V_lag = sup_tau E[e^(-r(tau+L)) * payoff(S_tau)]
              = e^(-rL) * sup_tau E[e^(-r tau) * payoff(S_tau)]
              = e^(-rL) * V_no_lag

    The constant e^(-rL) factors out of the optimal-stopping problem, so
    the exercise boundary is UNCHANGED and no approximation is introduced
    beyond Ju-Zhong itself. (The physical-settlement variant -- where the
    exchange itself happens at tau+L -- instead maps to Ju-Zhong with
    adjusted strike K*e^(-rL) and spot S*e^(-qL), shifting the boundary;
    not implemented, documented in american_ju_zhong.md.)

    `value_date` regimes: > maturity+settle_lag -> 0 (settled);
    in [maturity, maturity+settle_lag] -> intrinsic of the realized spot,
    discounted from maturity+settle_lag (assumes the option was NOT
    exercised early -- early-exercised trades carry their own known cash
    flow and should be valued as such by the caller); < maturity ->
    e^(-r*settle_lag) * JuZhong on the remaining horizon.

    Returns a PAIR `(price, exercise_now)`, both matching `spot`'s shape:
    `exercise_now` is the per-scenario optimal-exercise indicator (spot
    beyond the BAW critical boundary -- the same boundary the price is
    built on, and unchanged by settle_lag). A PFE engine uses it to flip
    scenarios into the exercised state as it steps through dates: an
    EXERCISED American is no longer an option (just a known cash amount
    paid at exercise_time + settle_lag, booked by the engine directly), so
    unlike the barrier families' already_touched there is no exercised-
    state INPUT here -- the pricer owes the engine the decision, not the
    bookkeeping. Past maturity the indicator degenerates to "in the money"
    (the terminal exercise rule); past settlement it is False.

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
    if settle_lag < 0.0:
        raise ValueError("settle_lag must be non-negative.")
    if value_date < 0.0:
        raise ValueError("value_date must be non-negative.")

    is_call = option_type == "call"
    spot = np.asarray(spot, dtype=float)
    settlement = maturity + settle_lag

    if value_date > settlement:
        return 0.0 * spot, np.zeros_like(spot, dtype=bool)

    strike = max(strike, 1e-8 * max(float(np.max(spot)), 1.0))

    if value_date >= maturity:
        intrinsic = _intrinsic(spot, strike, is_call)
        price = intrinsic * math.exp(-rate * (settlement - value_date))
        return price, intrinsic > 0.0

    remaining_maturity = maturity - value_date
    vol = effective_vol(vol_times, vol_values, remaining_maturity)
    lag_discount = math.exp(-rate * settle_lag)

    price = _ju_zhong_price(spot, strike, rate, eff_div_yield, vol, remaining_maturity, is_call)

    if is_call and eff_div_yield <= 0.0:
        exercise_now = np.zeros_like(spot, dtype=bool)
    else:
        boundary, _ = _baw_critical_price(strike, rate, eff_div_yield, max(vol, 0.005),
                                           remaining_maturity, is_call)
        exercise_now = (spot >= boundary) if is_call else (spot <= boundary)
    return price * lag_discount, exercise_now


def american_exercise_boundary(
    strike,
    rate,
    div_yield,
    borrow,
    maturity,
    option_type,
    vol_times,
    vol_values,
    *,
    value_date,
):
    """The critical spot S* for the REMAINING horizon (maturity -
    value_date): immediate exercise is optimal for a call when
    spot >= S*, for a put when spot <= S*.

    This is the (approximate) BAW boundary -- the same object Ju-Zhong's
    pricing formula is built on, so the indicator is exactly consistent
    with where price_american_ju_zhong returns intrinsic. It is UNCHANGED
    by a cash-settlement lag (the e^(-rL) factorization scales the
    objective by a positive constant, which cannot move the argmax) -- so
    there is deliberately no settle_lag argument here.

    A PFE engine uses this to maintain the per-scenario "exercised" state
    itself: unlike a touched barrier (which stays an option -- see
    already_touched in the barrier families), an EXERCISED American is no
    longer an option at all, just a known cash amount paid at
    exercise_time + settle_lag, which the engine books directly; a boolean
    input to the pricer could not describe it. What the pricer owes the
    engine is therefore the exercise DECISION, not an exercised-state
    input -- this function and should_exercise_now below.

    Degenerate regimes: value_date >= maturity -> strike (at expiry the
    exercise rule is simply "in the money"); a call with
    div_yield + borrow <= 0 -> +inf (never exercised early); near-zero vol
    is floored at 0.5% for the boundary solve (the fixed-point iteration
    degrades below that, matching the pricer's own low-vol fallback).
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    eff_div_yield = div_yield + borrow
    if rate < 0.0 or eff_div_yield < 0.0:
        raise ValueError("Ju-Zhong/BAW require rate >= 0 and (div_yield + borrow) >= 0.")
    if strike <= 0.0:
        raise ValueError("strike must be positive for a meaningful boundary.")
    if value_date < 0.0:
        raise ValueError("value_date must be non-negative.")

    is_call = option_type == "call"
    if value_date >= maturity:
        return strike
    if is_call and eff_div_yield <= 0.0:
        return math.inf

    remaining_maturity = maturity - value_date
    vol = max(effective_vol(vol_times, vol_values, remaining_maturity), 0.005)
    boundary, _ = _baw_critical_price(strike, rate, eff_div_yield, vol, remaining_maturity, is_call)
    return float(boundary)


def should_exercise_now(
    spot,
    strike,
    rate,
    div_yield,
    borrow,
    maturity,
    option_type,
    vol_times,
    vol_values,
    *,
    value_date,
):
    """Per-scenario boolean: is immediate exercise optimal at value_date?
    `spot` may be a scalar or numpy array; the return matches its shape.
    Past maturity the rule degenerates to "in the money" (boundary=strike).
    See american_exercise_boundary for why this is an OUTPUT of the pricer
    rather than an exercised-state input.
    """
    boundary = american_exercise_boundary(
        strike, rate, div_yield, borrow, maturity, option_type,
        vol_times, vol_values, value_date=value_date,
    )
    spot = np.asarray(spot, dtype=float)
    if option_type == "call":
        return spot >= boundary if math.isfinite(boundary) else np.zeros_like(spot, dtype=bool)
    return spot <= boundary
