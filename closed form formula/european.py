"""European vanilla option, Black-Scholes-Merton closed form.

Self-contained: only numpy/scipy. NPV only (no Greeks). Vectorised in `spot`
for use as a PFE revaluation kernel (array of scenario spots in, array of
NPVs out).

Model
-----
Given a forward F = S * exp((r - q - b) * T) and total variance W(T) of
ln(S_T / F) (see `total_variance` below), the standard result is

    call = disc_pay * (F * N(d1) - K * N(d2))
    put  = call - disc_pay * (F - K)                     (put-call parity)
    d1   = (ln(F/K) + W/2) / sqrt(W)
    d2   = d1 - sqrt(W)

`disc_pay = exp(-r * payment_time)` — see "Deferred settlement" below. This
is exact: nothing here is approximate.

Term volatility
----------------
Volatility is supplied as a term structure of TERMINAL (Black) vols at
pillar maturities `(vol_times, vol_values)` — i.e. `vol_values[i]` is the
flat vol that reprices a European expiring at `vol_times[i]`. This is what a
market vol curve actually quotes; it is not an instantaneous or
piecewise-constant vol.

Everything is driven by total variance W(t) = sigma_term(t)^2 * t, linearly
interpolated between pillars (linear-in-variance, not linear-in-vol, so
that the implied forward variance between pillars is constant and
non-negative). A single pillar reproduces the constant-vol case exactly.
Flat extrapolation of sigma_term outside the pillar range, so W(t) grows
linearly through the origin below the first pillar and linearly at the
last pillar's slope beyond the last one.

The curve is checked for a static-arbitrage violation (forward variance
must be >= 0, i.e. W must be non-decreasing); a violating curve raises
ValueError immediately rather than propagating a NaN out of a downstream
sqrt().

Deferred settlement
--------------------
`payment_time` may exceed `maturity`: the payoff is DETERMINED at
`maturity` (diffusion runs to `maturity`) but PAID at `payment_time`
(discounting runs to `payment_time`). Defaults to `maturity` (no deferral).

Borrow
------
`div_yield` and `borrow` are both continuously-compounded and enter only
through the carry `r - q - b`; they are kept as separate arguments so a
caller never has to pre-combine them.
"""

import math

import numpy as np
from scipy.stats import norm


def total_variance(vol_times, vol_values, t):
    """W(t): total variance to time(s) `t` under a linear-in-variance
    interpolation of the terminal-vol curve `(vol_times, vol_values)`.

    `vol_times`/`vol_values` may be scalars or array-likes of the same
    length (>= 1). `t` may be a scalar or array; the return matches its
    shape (scalar in, scalar out).
    """
    vt = np.atleast_1d(np.asarray(vol_times, dtype=float))
    vv = np.atleast_1d(np.asarray(vol_values, dtype=float))
    if vt.shape != vv.shape:
        raise ValueError("vol_times and vol_values must have the same length.")
    if np.any(vt <= 0.0):
        raise ValueError("Vol pillar times must be strictly positive.")
    if np.any(vv < 0.0):
        raise ValueError("Vol pillar values must be non-negative.")

    order = np.argsort(vt)
    vt, vv = vt[order], vv[order]
    # Prepend the origin: total variance is 0 at t=0 by definition, and this
    # anchor makes the segment below the first pillar the flat-vol segment
    # sigma_term(t) = sigma_term(T0) for t in [0, T0], per the module docstring.
    pillar_t = np.concatenate(([0.0], vt))
    pillar_w = np.concatenate(([0.0], vv * vv * vt))

    if np.any(np.diff(pillar_w) < -1e-10):
        raise ValueError(
            "Term-vol curve implies negative forward variance between pillars "
            "(static-arbitrage violation)."
        )

    t_arr = np.atleast_1d(np.asarray(t, dtype=float))
    if np.any(t_arr < 0.0):
        raise ValueError("t must be non-negative.")
    w = np.interp(t_arr, pillar_t, pillar_w)

    last_t = pillar_t[-1]
    if last_t > 0.0:
        last_sigma2 = pillar_w[-1] / last_t
        beyond = t_arr > last_t
        if np.any(beyond):
            w = np.where(beyond, pillar_w[-1] + last_sigma2 * (t_arr - last_t), w)

    return float(w[0]) if np.ndim(t) == 0 else w


def effective_vol(vol_times, vol_values, maturity):
    """sigma_eff = sqrt(W(maturity)/maturity): the single flat vol that
    reproduces the same total variance to `maturity`. Used by every family
    whose closed form assumes constant vol (see the term-vol split in the
    package README) -- for European/Digital/Asian it is not needed, since
    those use W(t) directly and are exact under term vol.
    """
    if maturity <= 0.0:
        vv = np.atleast_1d(np.asarray(vol_values, dtype=float))
        return float(vv[-1])
    return math.sqrt(total_variance(vol_times, vol_values, maturity) / maturity)


def price_european(
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
    """European call/put NPV. `spot` may be a scalar or numpy array (PFE
    scenario vector); the return has the same shape.

    option_type: "call" or "put".

    `value_date` is the "as of" time (same axis as `maturity`/`payment_time`,
    required -- there is no implicit "value today" default). Three regimes:
      - value_date >= payment_time: already settled, value is 0.
      - maturity <= value_date < payment_time: the payoff is already fixed
        (`spot` IS S(maturity), there is no remaining uncertainty) -- just a
        deferred, discounted cash amount.
      - value_date < maturity: standard forward-looking pricing, using
        (maturity - value_date) as the remaining diffusion horizon and
        (payment_time - value_date) as the remaining discount horizon.

    `strike == 0` is handled directly rather than through the log-based
    formula (which would divide by zero): a put's payoff is identically 0,
    and a call's payoff is S(maturity) always.
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    if strike < 0.0:
        raise ValueError("strike must be non-negative.")
    if maturity < 0.0:
        raise ValueError("maturity must be non-negative.")
    if payment_time is None:
        payment_time = maturity
    if payment_time < maturity - 1e-12:
        raise ValueError("payment_time cannot precede maturity.")
    if value_date < 0.0:
        raise ValueError("value_date must be non-negative.")

    spot = np.asarray(spot, dtype=float)
    if np.any(spot < 0.0):
        raise ValueError("spot must be non-negative.")
    is_call = option_type == "call"

    if value_date > payment_time:
        return 0.0 * spot

    if value_date >= maturity:
        intrinsic = np.maximum(spot - strike, 0.0) if is_call else np.maximum(strike - spot, 0.0)
        return intrinsic * math.exp(-rate * (payment_time - value_date))

    remaining_maturity = maturity - value_date
    remaining_payment = payment_time - value_date

    carry = rate - div_yield - borrow
    disc_pay = math.exp(-rate * remaining_payment)
    forward = spot * np.exp(carry * remaining_maturity)

    if strike == 0.0:
        return disc_pay * forward if is_call else 0.0 * forward

    w = total_variance(vol_times, vol_values, remaining_maturity)
    if w <= 1e-14:
        intrinsic = np.maximum(forward - strike, 0.0) if is_call else np.maximum(strike - forward, 0.0)
        return disc_pay * intrinsic

    root_w = math.sqrt(w)
    d1 = (np.log(forward / strike) + 0.5 * w) / root_w
    d2 = d1 - root_w
    call = disc_pay * (forward * norm.cdf(d1) - strike * norm.cdf(d2))
    if is_call:
        return call
    return call - disc_pay * (forward - strike)
