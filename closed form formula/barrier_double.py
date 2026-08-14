"""Double barrier options: absorbing-boundary spectral closed form, 5
monitoring triggers, optional rebate (paid at hit or at expiry). NPV only.

Self-contained (numpy/scipy only).

APPROXIMATE under a term-vol curve (like every barrier family): the curve is
collapsed to a single effective vol before pricing.

Spectral density
-----------------
Let X = ln(S) live on the strip [L, U] = [ln(lower), ln(upper)], absorbed at
both ends (knocked out the instant X leaves the strip). With drift
theta = (carry - sigma^2/2)/sigma^2 (Girsanov-tilted to a driftless killed
Brownian motion) the transition density has the classic sine-series
eigenfunction expansion on a strip of width w = U - L, x0 = ln(S0) - L:

    p(t, x0, y) = (2/w) * exp(theta*(y-x0) - theta^2*sigma^2*t/2)
                  * sum_n sin(wave_n*x0) * sin(wave_n*y) * exp(-lam_n*t)

    wave_n = n*pi/w,  lam_n = sigma^2*wave_n^2/2 + theta^2*sigma^2/2

Survival probability S(t) = integral_0^w p(t,x0,y) dy = sum_n c_n*exp(-lam_n*t)
with c_n = (2/w)*sin(wave_n*x0)*I_n, I_n = wave_n/(theta^2+wave_n^2) *
(1 - (-1)^n*exp(theta*w)) (elementary antiderivative of exp(theta*y)sin(wave_n*y)).
S(0) = sum_n c_n = 1 EXACTLY (the density integrates to 1 at t=0).

Rebate at hit -- derived here, not from a textbook
----------------------------------------------------
The first-passage (hitting-time) density is -S'(t) = sum_n c_n*lam_n*exp(-lam_n*t).
Expected discounted rebate paid at the hit time, truncated to [0, T]:

    rebate * sum_n c_n * lam_n/(r+lam_n) * (1 - exp(-(r+lam_n)*T))

As n -> infinity, lam_n -> infinity, so lam_n/(r+lam_n) -> 1 and the exp term
-> 0, i.e. each tail mode's contribution -> c_n. Truncating at M modes and
adding the EXACT tail correction (1 - sum_{n<=M} c_n) -- using S(0)=1 exactly,
the same trick used for web-lab's double-barrier rebate-at-hit fix -- avoids
the O(1/n) truncation error that plagues this specific kernel (it does not
decay to 0 like the pricing/density kernels do; carried over from that bug).
This construction was verified against a from-scratch fine-step hitting-time
Monte Carlo in test_barrier_double.py, not merely asserted.
"""

import math

import numpy as np
from scipy.stats import norm

BGK_BETA = 0.5825971579390107
NUM_MODES = 256
_Y_INTERVALS = 640


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


def _bgk_shift_double(lower, upper, vol, obs_per_year):
    factor = math.exp(BGK_BETA * vol * math.sqrt(1.0 / obs_per_year))
    return lower / factor, upper * factor


_OBS_PER_YEAR = {"daily": 252.0, "weekly": 52.0, "monthly": 12.0}


def _strip_modes(spot, carry, vol, lower, upper):
    log_l, log_u = math.log(lower), math.log(upper)
    width = log_u - log_l
    x0 = math.log(spot) - log_l
    theta = (carry - 0.5 * vol * vol) / (vol * vol)
    n = np.arange(1, NUM_MODES + 1)
    wave = n * math.pi / width
    lam = 0.5 * vol * vol * wave * wave + 0.5 * theta * theta * vol * vol
    sign = np.where(n % 2 == 0, 1.0, -1.0)  # (-1)^n
    i_n = wave / (theta * theta + wave * wave) * (1.0 - sign * math.exp(theta * width))
    c_n = (2.0 / width) * np.sin(wave * x0) * i_n
    return {"log_l": log_l, "width": width, "x0": x0, "theta": theta, "wave": wave, "lam": lam, "c": c_n}


_SIGMA_UNREACHABLE = 8.0


def _barrier_negligible(spot, vol, maturity, lower, upper):
    """True when both barriers are so many standard deviations away (in log
    space) that no finite mode truncation would meaningfully see them --
    the coefficients c_n decay like O(1/n), so Sum_{n<=M} c_n undershoots 1
    by an amount that does NOT vanish as maturity -> 0 (the density needs
    infinitely many modes to resolve a near-delta initial condition), unlike
    the rebate-at-hit kernel's tail (which genuinely -> 1, justifying that
    trick's tail correction). Bypassing the truncated sum entirely here --
    same spirit as the existing vol<=0 / maturity<=0 deterministic
    fallbacks -- sidesteps the bias rather than papering over it."""
    root_t = vol * math.sqrt(maturity)
    if root_t <= 1e-12:
        return True
    dist_lower = math.log(spot / lower)
    dist_upper = math.log(upper / spot)
    return min(dist_lower, dist_upper) > _SIGMA_UNREACHABLE * root_t


def _survival_probability(spot, carry, vol, maturity, lower, upper):
    if not (lower < spot < upper):
        return 0.0
    if _barrier_negligible(spot, vol, maturity, lower, upper):
        return 1.0
    st = _strip_modes(spot, carry, vol, lower, upper)
    return float(np.clip(np.sum(st["c"] * np.exp(-st["lam"] * maturity)), 0.0, 1.0))


def _spectral_out_price(spot, strike, rate, carry, maturity, vol, lower, upper, option_type):
    if not (lower < spot < upper):
        return 0.0
    if _barrier_negligible(spot, vol, maturity, lower, upper):
        return _vanilla_price(spot, strike, rate, carry, maturity, vol, option_type)
    st = _strip_modes(spot, carry, vol, lower, upper)
    width, x0, theta = st["width"], st["x0"], st["theta"]
    mode_decay = np.exp(-st["lam"] * maturity)
    mode_vec = np.sin(st["wave"] * x0) * mode_decay  # (modes,)

    y_grid = np.linspace(0.0, width, _Y_INTERVALS + 1)
    dy = width / _Y_INTERVALS
    simp_w = np.ones(_Y_INTERVALS + 1)
    simp_w[1:-1:2] = 4.0
    simp_w[2:-1:2] = 2.0

    sin_y = np.sin(np.outer(st["wave"], y_grid))  # (modes, gridpts)
    series = mode_vec @ sin_y  # (gridpts,)
    density = (2.0 / width) * np.exp(theta * (y_grid - x0)) * series
    density = np.maximum(density, 0.0)

    prices_y = np.exp(y_grid + st["log_l"])
    payoff = np.maximum(prices_y - strike, 0.0) if option_type == "call" else np.maximum(strike - prices_y, 0.0)
    undiscounted = float(np.sum(simp_w * density * payoff)) * dy / 3.0
    disc_pay = math.exp(-rate * maturity)
    return disc_pay * undiscounted


def _european_touch_probability(spot, rate, carry, maturity, vol, lower, upper):
    """P(S_T outside [lower,upper]) under lognormal S_T -- no path/continuity
    concept at all, since the barrier is checked only once, at maturity."""
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


def _rebate_at_expiry_double(spot, rate, carry, maturity, vol, lower, upper, style, rebate, trigger):
    if trigger == "european":
        touch_prob = _european_touch_probability(spot, rate, carry, maturity, vol, lower, upper)
    else:
        touch_prob = 1.0 - _survival_probability(spot, carry, vol, maturity, lower, upper)
    disc = math.exp(-rate * maturity)
    return rebate * disc * (touch_prob if style == "out" else (1.0 - touch_prob))


def _rebate_at_hit_double(spot, rate, carry, maturity, vol, lower, upper, rebate):
    if not (lower < spot < upper):
        return rebate * math.exp(-rate * maturity)
    st = _strip_modes(spot, carry, vol, lower, upper)
    c, lam = st["c"], st["lam"]
    kernel = lam / (rate + lam) * (1.0 - np.exp(-(rate + lam) * maturity))
    truncated = float(np.sum(c * kernel))
    tail_correction = 1.0 - float(np.sum(c))  # exact: sum_all c_n = S(0) = 1
    return rebate * (truncated + tail_correction)


def price_barrier_double(
    spot,
    strike,
    rate,
    div_yield,
    borrow,
    maturity,
    option_type,
    lower_barrier,
    upper_barrier,
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
    """Double barrier option NPV.

    style: "in" or "out". trigger: "european","monthly","weekly","daily","continuous".
    rebate_timing: "hit" or "expiry" (ignored if rebate == 0).

    `value_date` (required) and `strike == 0` (epsilon substitution) follow
    the same conventions as barrier_single.py -- see that file's docstring.
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

    if value_date > payment_time:
        return 0.0

    strike = max(strike, 1e-8 * max(spot, 1.0))

    if value_date >= maturity:
        touched0 = not (lower_barrier < spot < upper_barrier)
        intrinsic = max(spot - strike, 0.0) if option_type == "call" else max(strike - spot, 0.0)
        price = (0.0 if touched0 else intrinsic) if style == "out" else (intrinsic if touched0 else 0.0)
        return price * math.exp(-rate * (payment_time - value_date))

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    carry = rate - div_yield - borrow
    vol = effective_vol(vol_times, vol_values, maturity)
    deferral = math.exp(-rate * (payment_time - maturity))

    if not (lower_barrier < spot < upper_barrier):
        # Already breached at inception.
        vanilla = _vanilla_price(spot, strike, rate, carry, maturity, vol, option_type)
        price = 0.0 if style == "out" else vanilla
        if rebate != 0.0 and rebate_timing == "expiry":
            price += rebate * math.exp(-rate * maturity) * (1.0 if style == "out" else 0.0)
        price *= deferral
        if rebate != 0.0 and rebate_timing == "hit":
            price += rebate * math.exp(-rate * maturity)
        return price

    if trigger == "european":
        out_price = _truncated_vanilla_region(spot, strike, rate, carry, maturity, option_type, vol,
                                               lower_barrier, upper_barrier)
        eff_lower, eff_upper = lower_barrier, upper_barrier
    else:
        if trigger in _OBS_PER_YEAR:
            eff_lower, eff_upper = _bgk_shift_double(lower_barrier, upper_barrier, vol, _OBS_PER_YEAR[trigger])
        else:
            eff_lower, eff_upper = lower_barrier, upper_barrier
        out_price = _spectral_out_price(spot, strike, rate, carry, maturity, vol, eff_lower, eff_upper, option_type)

    vanilla = _vanilla_price(spot, strike, rate, carry, maturity, vol, option_type)
    price = out_price if style == "out" else (vanilla - out_price)

    if rebate != 0.0 and rebate_timing == "expiry":
        price += _rebate_at_expiry_double(spot, rate, carry, maturity, vol, eff_lower, eff_upper, style, rebate, trigger)
    price *= deferral
    if rebate != 0.0 and rebate_timing == "hit":
        price += _rebate_at_hit_double(spot, rate, carry, maturity, vol, eff_lower, eff_upper, rebate)
    return price
