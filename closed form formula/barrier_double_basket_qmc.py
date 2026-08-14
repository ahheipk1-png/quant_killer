"""Sobol-QMC benchmark for barrier_double_basket.py. Same true-multi-asset
simulation approach as barrier_single_basket_qmc.py (see that file's
docstring), with two barrier levels instead of one.
"""

import math

import numpy as np
from scipy.stats import norm, qmc

from barrier_double_basket import total_variance, _OBS_PER_YEAR


def _cholesky_equicorrelated(n, correlation):
    if np.ndim(correlation) == 0:
        corr = np.full((n, n), float(correlation))
        np.fill_diagonal(corr, 1.0)
    else:
        corr = np.asarray(correlation, dtype=float)
    eigvals, eigvecs = np.linalg.eigh(corr)
    eigvals = np.clip(eigvals, 1e-12, None)
    corr_psd = (eigvecs * eigvals) @ eigvecs.T
    d = np.sqrt(np.diag(corr_psd))
    corr_psd = corr_psd / np.outer(d, d)
    return np.linalg.cholesky(corr_psd)


def _shifted_sobol_normals(n_points, dims, n_shifts, seed):
    sampler = qmc.Sobol(d=dims, scramble=False)
    base = sampler.random(n_points)
    rng = np.random.default_rng(seed)
    for _ in range(n_shifts):
        shift = rng.random(dims)
        u = np.mod(base + shift, 1.0)
        u = np.clip(u, 1e-12, 1.0 - 1e-12)
        yield norm.ppf(u)


def qmc_price_barrier_double_basket(
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
    n_points=2**13,
    n_shifts=8,
    seed=12345,
    n_substeps=64,
    *,
    value_date,
):
    if payment_time is None:
        payment_time = maturity
    if value_date > payment_time:
        return 0.0, 0.0
    if value_date >= maturity:
        realized = float(np.sum(np.asarray(weights, dtype=float) * np.asarray(spots, dtype=float)))
        touched0 = not (lower_barrier < realized < upper_barrier)
        intrinsic = max(realized - strike, 0.0) if option_type == "call" else max(strike - realized, 0.0)
        price = (0.0 if touched0 else intrinsic) if style == "out" else (intrinsic if touched0 else 0.0)
        return price * math.exp(-rate * (payment_time - value_date)), 0.0

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    spots = np.asarray(spots, dtype=float)
    weights = np.asarray(weights, dtype=float)
    n = spots.size
    div_yields = np.broadcast_to(np.asarray(div_yields, dtype=float), (n,))
    borrows = np.broadcast_to(np.asarray(borrows, dtype=float), (n,))
    carries = rate - div_yields - borrows
    disc_pay = math.exp(-rate * payment_time)

    if trigger == "european":
        steps = 1
    elif trigger in _OBS_PER_YEAR:
        steps = max(1, round(_OBS_PER_YEAR[trigger] * maturity))
    else:
        steps = max(n_substeps, round(252 * maturity))

    dt = maturity / steps
    chol = _cholesky_equicorrelated(n, correlation)
    w_grid = np.array([total_variance(vol_times_list[i], vol_values_list[i],
                                       np.linspace(dt, maturity, steps)) for i in range(n)])
    dW = np.diff(np.concatenate([np.zeros((n, 1)), w_grid], axis=1), axis=1)
    dW = np.maximum(dW, 0.0)
    sqrt_dW = np.sqrt(dW)
    drift = carries[:, None] * dt - 0.5 * dW

    estimates = np.empty(n_shifts)
    for shift_index, z in enumerate(_shifted_sobol_normals(n_points, n * steps, n_shifts, seed)):
        z = z.reshape(n_points, steps, n)
        z_corr = np.moveaxis(z @ chol.T, 2, 1)
        log_increments = drift[None, :, :] + sqrt_dW[None, :, :] * z_corr
        log_paths = np.log(spots)[None, :, None] + np.cumsum(log_increments, axis=2)
        full = np.exp(np.concatenate([np.full((n_points, n, 1), 0.0) + np.log(spots)[None, :, None], log_paths], axis=2))
        basket_path = np.tensordot(full, weights, axes=([1], [0]))

        if trigger == "european":
            terminal = basket_path[:, -1]
            hit = (terminal <= lower_barrier) | (terminal >= upper_barrier)
            hit_idx = np.zeros(n_points, dtype=int)
        else:
            touched = (basket_path <= lower_barrier) | (basket_path >= upper_barrier)
            hit = np.any(touched, axis=1)
            hit_idx = np.argmax(touched, axis=1)

        terminal = basket_path[:, -1]
        vanilla_payoff = np.maximum(terminal - strike, 0.0) if option_type == "call" else np.maximum(strike - terminal, 0.0)
        option_alive = ~hit if style == "out" else hit
        option_payoff = np.where(option_alive, vanilla_payoff, 0.0)

        if rebate != 0.0 and rebate_timing == "expiry":
            rebate_trigger = hit if style == "out" else ~hit
            rebate_payoff = np.where(rebate_trigger, rebate, 0.0)
            estimates[shift_index] = disc_pay * (option_payoff + rebate_payoff).mean()
        elif rebate != 0.0 and rebate_timing == "hit":
            hit_time = hit_idx * dt
            rebate_disc = np.where(hit, rebate * np.exp(-rate * hit_time), 0.0)
            option_leg = disc_pay * option_payoff.mean()
            estimates[shift_index] = option_leg + rebate_disc.mean()
        else:
            estimates[shift_index] = disc_pay * option_payoff.mean()

    price = float(estimates.mean())
    se = float(estimates.std(ddof=1) / math.sqrt(n_shifts)) if n_shifts > 1 else 0.0
    return price, se
