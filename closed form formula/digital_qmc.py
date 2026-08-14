"""Sobol-QMC benchmark for digital.py (single asset and basket)."""

import math

import numpy as np
from scipy.stats import norm, qmc


def total_variance(vol_times, vol_values, t):
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
    sampler = qmc.Sobol(d=dims, scramble=False)
    base = sampler.random(n_points)
    rng = np.random.default_rng(seed)
    for _ in range(n_shifts):
        shift = rng.random(dims)
        u = np.mod(base + shift, 1.0)
        u = np.clip(u, 1e-12, 1.0 - 1e-12)
        yield norm.ppf(u)


def qmc_price_digital(
    spot, strike, rate, div_yield, borrow, maturity, option_type, payout_type,
    vol_times, vol_values, cash=1.0, payment_time=None,
    n_points=2**16, n_shifts=8, seed=12345,
    *, value_date,
):
    if payment_time is None:
        payment_time = maturity
    if value_date > payment_time:
        return 0.0, 0.0
    if value_date >= maturity:
        hit = (spot > strike) if option_type == "call" else (spot <= strike)
        payoff = (cash if payout_type == "cash" else spot) if hit else 0.0
        return payoff * math.exp(-rate * (payment_time - value_date)), 0.0

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    carry = rate - div_yield - borrow
    disc_pay = math.exp(-rate * payment_time)
    forward = spot * math.exp(carry * maturity)
    w = total_variance(vol_times, vol_values, maturity)
    root_w = math.sqrt(max(w, 0.0))

    estimates = np.empty(n_shifts)
    for shift_index, z in enumerate(_shifted_sobol_normals(n_points, 1, n_shifts, seed)):
        z = z[:, 0]
        s_t = forward * np.exp(-0.5 * w + root_w * z)
        hit = (s_t > strike) if option_type == "call" else (s_t <= strike)
        payoff = np.where(hit, (cash if payout_type == "cash" else s_t), 0.0)
        estimates[shift_index] = disc_pay * payoff.mean()

    price = float(estimates.mean())
    se = float(estimates.std(ddof=1) / math.sqrt(n_shifts)) if n_shifts > 1 else 0.0
    return price, se


def _cholesky_equicorrelated(n, correlation):
    if np.ndim(correlation) == 0:
        corr = np.full((n, n), float(correlation))
        np.fill_diagonal(corr, 1.0)
    else:
        corr = np.asarray(correlation, dtype=float)
    # Guard against a non-PSD equicorrelation input just past +/-1 due to
    # float roundoff; clip the eigenvalues rather than let Cholesky raise.
    eigvals, eigvecs = np.linalg.eigh(corr)
    eigvals = np.clip(eigvals, 1e-12, None)
    corr_psd = (eigvecs * eigvals) @ eigvecs.T
    d = np.sqrt(np.diag(corr_psd))
    corr_psd = corr_psd / np.outer(d, d)
    return np.linalg.cholesky(corr_psd)


def qmc_price_digital_basket(
    spots, weights, strike, rate, div_yields, borrows, maturity, option_type, payout_type,
    vol_times_list, vol_values_list, correlation, cash=1.0, payment_time=None,
    n_points=2**16, n_shifts=8, seed=12345,
    *, value_date,
):
    if payment_time is None:
        payment_time = maturity
    if value_date > payment_time:
        return 0.0, 0.0
    if value_date >= maturity:
        basket_realized = float(np.sum(np.asarray(weights, dtype=float) * np.asarray(spots, dtype=float)))
        hit = (basket_realized > strike) if option_type == "call" else (basket_realized <= strike)
        payoff = (cash if payout_type == "cash" else basket_realized) if hit else 0.0
        return payoff * math.exp(-rate * (payment_time - value_date)), 0.0

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    spots = np.asarray(spots, dtype=float)
    weights = np.asarray(weights, dtype=float)
    n = spots.size
    div_yields = np.broadcast_to(np.asarray(div_yields, dtype=float), (n,))
    borrows = np.broadcast_to(np.asarray(borrows, dtype=float), (n,))
    carries = rate - div_yields - borrows
    forwards = spots * np.exp(carries * maturity)
    total_vars = np.array(
        [total_variance(vol_times_list[i], vol_values_list[i], maturity) for i in range(n)]
    )
    root_vars = np.sqrt(np.maximum(total_vars, 0.0))
    disc_pay = math.exp(-rate * payment_time)
    chol = _cholesky_equicorrelated(n, correlation)

    estimates = np.empty(n_shifts)
    for shift_index, z_indep in enumerate(_shifted_sobol_normals(n_points, n, n_shifts, seed)):
        z_corr = z_indep @ chol.T
        terminal = forwards[np.newaxis, :] * np.exp(-0.5 * total_vars[np.newaxis, :] + root_vars[np.newaxis, :] * z_corr)
        basket = terminal @ weights
        hit = (basket > strike) if option_type == "call" else (basket <= strike)
        payoff = np.where(hit, (cash if payout_type == "cash" else basket), 0.0)
        estimates[shift_index] = disc_pay * payoff.mean()

    price = float(estimates.mean())
    se = float(estimates.std(ddof=1) / math.sqrt(n_shifts)) if n_shifts > 1 else 0.0
    return price, se
