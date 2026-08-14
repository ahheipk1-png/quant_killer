"""Sobol-QMC benchmark for european.py.

Self-contained (numpy/scipy only, no import of european.py). Draws a
single-step terminal S_T ~ lognormal with total variance W(maturity) from
the same term-vol curve convention, martingale-corrected so E[S_T] equals
the forward exactly regardless of vol level.

Randomised QMC: one base (unscrambled) Sobol sequence, walked through
`n_shifts` independent digital shifts (mod-1 addition of a uniform draw per
shift). Each shift gives one Monte-Carlo-consistent estimate; the mean of
the `n_shifts` estimates is the price, and their sample standard deviation
divided by sqrt(n_shifts) is an honest standard error -- this is what makes
"how many SE away" a meaningful test assertion rather than a guess.
"""

import math

import numpy as np
from scipy.stats import norm, qmc


def total_variance(vol_times, vol_values, t):
    """Verbatim copy of european.total_variance -- see that module for the
    derivation. Duplicated deliberately: this file must stand alone.
    """
    vt = np.atleast_1d(np.asarray(vol_times, dtype=float))
    vv = np.atleast_1d(np.asarray(vol_values, dtype=float))
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


def _shifted_sobol_normals(n_points, dims, n_shifts, seed):
    """Yield `n_shifts` arrays of shape (n_points, dims) of standard normal
    draws, each a digitally-shifted copy of one base Sobol point set.
    """
    sampler = qmc.Sobol(d=dims, scramble=False)
    base = sampler.random(n_points)
    rng = np.random.default_rng(seed)
    for _ in range(n_shifts):
        shift = rng.random(dims)
        u = np.mod(base + shift, 1.0)
        u = np.clip(u, 1e-12, 1.0 - 1e-12)
        yield norm.ppf(u)


def qmc_price_european(
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
    n_points=2**16,
    n_shifts=8,
    seed=12345,
    *,
    value_date,
):
    """Returns (price, standard_error). `spot` must be a scalar (this
    benchmark prices one scenario at a time by design -- it is a validation
    tool, never the PFE inner loop; see the family README).
    """
    if payment_time is None:
        payment_time = maturity
    if value_date > payment_time:
        return 0.0, 0.0
    if value_date >= maturity:
        intrinsic = max(spot - strike, 0.0) if option_type == "call" else max(strike - spot, 0.0)
        return intrinsic * math.exp(-rate * (payment_time - value_date)), 0.0

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    carry = rate - div_yield - borrow
    disc_pay = math.exp(-rate * payment_time)
    forward = spot * math.exp(carry * maturity)

    if strike == 0.0:
        price = disc_pay * forward if option_type == "call" else 0.0
        return price, 0.0

    w = total_variance(vol_times, vol_values, maturity)
    root_w = math.sqrt(max(w, 0.0))

    estimates = np.empty(n_shifts)
    for shift_index, z in enumerate(_shifted_sobol_normals(n_points, 1, n_shifts, seed)):
        z = z[:, 0]
        s_t = forward * np.exp(-0.5 * w + root_w * z)
        payoff = np.maximum(s_t - strike, 0.0) if option_type == "call" else np.maximum(strike - s_t, 0.0)
        estimates[shift_index] = disc_pay * payoff.mean()

    price = float(estimates.mean())
    se = float(estimates.std(ddof=1) / math.sqrt(n_shifts)) if n_shifts > 1 else 0.0
    return price, se
