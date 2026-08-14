"""Single barrier options: Reiner-Rubinstein closed form, 5 monitoring
triggers, optional rebate (paid at hit or at expiry). NPV only.

Self-contained (numpy/scipy only).

APPROXIMATE under a term-vol curve (unlike European/Digital/Asian-Curran,
which are exact): the curve is collapsed to a single effective vol
sigma_eff = sqrt(W(T)/T) before applying the closed form. This is the
documented barrier-family exception in the project plan.

Monitoring triggers
--------------------
- "continuous": textbook Reiner-Rubinstein, barrier watched at every instant.
- "daily"/"weekly"/"monthly": discrete monitoring via the Broadie-Glasserman-
  Kou (BGK) continuity correction -- the barrier is shifted away from spot by
  exp(+-beta*sigma*sqrt(1/m)), beta = -zeta(1/2)/sqrt(2*pi) ~= 0.5825971579,
  m = observations/year (252/52/12), then the continuous formula is applied
  to the shifted barrier. Error grows as monitoring sparsens.
- "european": the barrier is tested only once, at maturity -- equivalent to
  a truncated vanilla (no continuous-monitoring risk at all).

Rebate
------
`rebate` (currency, default 0) is paid either:
  - "hit": at the moment the barrier is touched (Haug's F term, closed form
    for continuous monitoring; used as-is, on the BGK-shifted barrier, for
    the discrete triggers -- an approximation on top of an approximation).
    Undefined/unsupported for style="in" (there is no "hit" event distinct
    from activation) and for trigger="european" (no continuous hitting-time
    concept when the barrier is only checked at maturity) -- both raise.
  - "expiry": discounted from T regardless of when the barrier was hit,
    contingent on knock-out having occurred (or, for knock-in, on it never
    having occurred) by maturity (Haug's E term / its knock-in complement).
    Supported for every trigger and style, including "european".

Low-volatility overflow guard: (H/S)^(2*mu) can overflow for sigma close to
zero; carried over from the web-lab double-barrier fix -- fall back to the
sigma->0 deterministic-drift limit (barrier is hit with probability 0 or 1
depending on which side of H the deterministic forward path stays on).
"""

import math

import numpy as np
from scipy.stats import norm

BGK_BETA = 0.5825971579390107


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


def _bgk_shift(barrier, vol, obs_per_year, direction):
    factor = math.exp(BGK_BETA * vol * math.sqrt(1.0 / obs_per_year))
    return barrier * factor if direction == "up" else barrier / factor


_OBS_PER_YEAR = {"daily": 252.0, "weekly": 52.0, "monthly": 12.0}


def _truncated_vanilla(spot, strike, rate, carry, maturity, option_type, vol, lower, upper):
    """PV of (phi*(S_T-K))^+ * 1{lower < S_T < upper} under GBM."""
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
    """Continuous single-barrier closed form (no rebate). Returns the price."""
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

    hs_ratio = barrier / spot
    log_hs = math.log(hs_ratio)
    power1 = 2.0 * (mu + 1.0)
    power2 = 2.0 * mu
    # Guard against overflow of (H/S)^power at very low vol / large |mu|.
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
    # Haug's standard case split (in-strike-vs-barrier ordering matters).
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
    """Risk-neutral probability the barrier is hit by T (continuous)."""
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
    # No-touch survival probability (Reiner-Rubinstein); touch prob is its complement.
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


def price_barrier_single(
    spot,
    strike,
    rate,
    div_yield,
    borrow,
    maturity,
    option_type,
    barrier,
    direction,
    style,
    trigger,
    vol_times,
    vol_values,
    rebate=0.0,
    rebate_timing="hit",
    payment_time=None,
    *,
    value_date,
):
    """Single barrier option NPV.

    direction: "up" or "down". style: "in" or "out".
    trigger: "european", "monthly", "weekly", "daily", "continuous".
    rebate_timing: "hit" or "expiry" (ignored if rebate == 0).

    `value_date` (required) follows european.price_european's three-regime
    convention. For value_date >= maturity, `spot` is treated as the
    realized S(maturity) and the barrier condition is checked against it
    directly -- this is the same simplification the old maturity<=0 branch
    already made (no separate "was it touched along the way" state is
    tracked; a genuine limitation, not new to value_date).

    `strike == 0` is handled by substituting an economically negligible
    positive epsilon (this family's closed form has strike baked into
    several log() terms with no clean K=0 special case, unlike european.py).
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

    strike = max(strike, 1e-8 * max(spot, 1.0))

    if value_date >= maturity:
        touched0 = (spot >= barrier) if direction == "up" else (spot <= barrier)
        intrinsic = max(spot - strike, 0.0) if option_type == "call" else max(strike - spot, 0.0)
        price = (0.0 if touched0 else intrinsic) if style == "out" else (intrinsic if touched0 else 0.0)
        return price * math.exp(-rate * (payment_time - value_date))

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    carry = rate - div_yield - borrow
    vol = effective_vol(vol_times, vol_values, maturity)
    deferral = math.exp(-rate * (payment_time - maturity))

    if trigger == "european":
        # "out" survives where the terminal price never crosses the barrier
        # (checked only at maturity here); "in" is its complement.
        if direction == "up":
            lower, upper = (barrier, math.inf) if style == "in" else (0.0, barrier)
        else:
            lower, upper = (0.0, barrier) if style == "in" else (barrier, math.inf)
        vanilla_out_region = _truncated_vanilla(spot, strike, rate, carry, maturity, option_type, vol, lower, upper)
        price = vanilla_out_region
        if rebate != 0.0:
            price += _rebate_at_expiry(spot, rate, carry, maturity, vol, barrier, direction, style, rebate)
        return price * deferral

    if trigger in _OBS_PER_YEAR:
        shifted_barrier = _bgk_shift(barrier, vol, _OBS_PER_YEAR[trigger], direction)
    else:
        shifted_barrier = barrier

    price = _reiner_rubinstein(spot, strike, rate, carry, maturity, vol, shifted_barrier, option_type, direction, style)
    if rebate != 0.0 and rebate_timing == "expiry":
        price += _rebate_at_expiry(spot, rate, carry, maturity, vol, shifted_barrier, direction, style, rebate)
    price *= deferral
    if rebate != 0.0 and rebate_timing == "hit":
        # Paid (and fully discounted) at the hit time itself -- not deferred
        # further to payment_time, unlike the option's own payoff.
        price += _rebate_at_hit(spot, rate, carry, maturity, vol, shifted_barrier, direction, rebate)
    return price
