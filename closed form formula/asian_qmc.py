"""Sobol-QMC benchmark for asian_curran.py.

Simulates on a FINE sub-grid (not just the fixing dates), with each asset's
own per-step variance increment taken from its term-vol curve and a FIXED
correlation matrix applied at every fine step via Cholesky. This realises
the standard "constant instantaneous correlation, per-asset term vol"
model exactly (in the fine-grid limit), which is deliberately NOT the same
object as asian_curran's rho_ij*sqrt(W_i*W_j) cross-covariance shortcut --
the gap between the two, when the per-asset curves are not parallel, is
precisely the approximation error the paired tests exist to measure.
"""

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


def qmc_price_asian(
    spots,
    weights,
    strike,
    rate,
    div_yields,
    borrows,
    fixing_times,
    maturity,
    option_type,
    vol_times_list,
    vol_values_list,
    correlation,
    cap=None,
    floor=None,
    observed_sum=None,
    observed_count=None,
    payment_time=None,
    n_substeps=60,
    n_points=2**13,
    n_shifts=8,
    seed=12345,
    *,
    value_date,
):
    if payment_time is None:
        payment_time = maturity
    if value_date > payment_time:
        return 0.0, 0.0

    spots = np.asarray(spots, dtype=float)
    weights = np.asarray(weights, dtype=float)
    n = spots.size
    div_yields = np.broadcast_to(np.asarray(div_yields, dtype=float), (n,))
    borrows = np.broadcast_to(np.asarray(borrows, dtype=float), (n,))
    carries = rate - div_yields - borrows

    fixing_times = np.asarray(fixing_times, dtype=float)
    m = fixing_times.size
    if value_date >= maturity and m > 0:
        raise ValueError(
            "When value_date >= maturity, every fixing must already be reflected in "
            "observed_sum/observed_count (pass an empty fixing_times)."
        )
    maturity = maturity - value_date
    if m > 0:
        fixing_times = fixing_times - value_date

    observed_sum = np.zeros(n) if observed_sum is None else np.broadcast_to(
        np.asarray(observed_sum, dtype=float), (n,)
    ).copy()
    observed_count = np.zeros(n, dtype=int) if observed_count is None else np.broadcast_to(
        np.asarray(observed_count, dtype=int), (n,)
    ).copy()
    fixing_counts = observed_count + m
    disc_pay = math.exp(-rate * (payment_time - value_date))

    if m == 0:
        a_i = observed_sum / fixing_counts
        if cap is not None or floor is not None:
            perf = a_i / spots
            if floor is not None:
                perf = np.maximum(perf, floor)
            if cap is not None:
                perf = np.minimum(perf, cap)
            a_i = perf * spots
        basket_average = float(np.sum(weights * a_i))
        payoff = max(basket_average - strike, 0.0) if option_type == "call" else max(strike - basket_average, 0.0)
        return disc_pay * payoff, 0.0

    fine = np.linspace(0.0, maturity, n_substeps + 1)
    grid = np.union1d(fine, fixing_times)
    grid = grid[grid >= 0.0]
    fixing_idx = np.searchsorted(grid, fixing_times)
    n_steps = grid.size - 1
    dt = np.diff(grid)

    w_cum = np.array([total_variance(vol_times_list[i], vol_values_list[i], grid) for i in range(n)])
    dW = np.maximum(np.diff(w_cum, axis=1), 0.0)  # (n, n_steps)
    sqrt_dW = np.sqrt(dW)
    drift = carries[:, None] * dt[None, :] - 0.5 * dW  # (n, n_steps)

    chol = _cholesky_equicorrelated(n, correlation)
    dims = n * n_steps

    estimates = np.empty(n_shifts)
    for shift_index, z in enumerate(_shifted_sobol_normals(n_points, dims, n_shifts, seed)):
        z = z.reshape(n_points, n_steps, n)  # independent-asset axis last, for the Cholesky matmul
        z_corr = z @ chol.T  # (n_points, n_steps, n), correlated across assets at every step
        z_corr = np.moveaxis(z_corr, 2, 1)  # -> (n_points, n, n_steps)
        log_increments = drift[None, :, :] + sqrt_dW[None, :, :] * z_corr  # (n_points, n, n_steps)
        log_paths = np.log(spots)[None, :, None] + np.cumsum(log_increments, axis=2)  # (n_points, n, n_steps)
        log_at_grid = np.concatenate(
            [np.full((n_points, n, 1), 0.0) + np.log(spots)[None, :, None], log_paths], axis=2
        )  # (n_points, n, n_steps+1) == grid points
        paths_at_fixings = np.exp(log_at_grid[:, :, fixing_idx])  # (n_points, n, m)

        stochastic_sum = paths_at_fixings.sum(axis=2)  # (n_points, n)
        a_i = (stochastic_sum + observed_sum[None, :]) / fixing_counts[None, :]  # (n_points, n)
        if cap is not None or floor is not None:
            perf = a_i / spots[None, :]
            if floor is not None:
                perf = np.maximum(perf, floor)
            if cap is not None:
                perf = np.minimum(perf, cap)
            a_i = perf * spots[None, :]
        basket_avg = a_i @ weights  # (n_points,)
        payoff = np.maximum(basket_avg - strike, 0.0) if option_type == "call" else np.maximum(strike - basket_avg, 0.0)
        estimates[shift_index] = disc_pay * payoff.mean()

    price = float(estimates.mean())
    se = float(estimates.std(ddof=1) / math.sqrt(n_shifts)) if n_shifts > 1 else 0.0
    return price, se
