"""Sobol-QMC benchmark for barrier_double.py.

Unlike the single barrier, a double-barrier's continuous-monitoring bridge
crossing probability has no simple closed form (it's itself an infinite
series), so this benchmark uses plain discrete-indicator monitoring on a
fine grid for every trigger, including "continuous" (proxied by a dense
grid -- 1024 steps/year by default). The resulting discretization bias is
real but small and shrinks with grid density; tests document/print it
rather than asserting blind tight tolerances for "continuous".
"""

import math

import numpy as np
from scipy.stats import norm, qmc

from barrier_double import effective_vol, _OBS_PER_YEAR


def _shifted_sobol_normals(n_points, dims, n_shifts, seed):
    sampler = qmc.Sobol(d=dims, scramble=False)
    base = sampler.random(n_points)
    rng = np.random.default_rng(seed)
    for _ in range(n_shifts):
        shift = rng.random(dims)
        u = np.mod(base + shift, 1.0)
        u = np.clip(u, 1e-12, 1.0 - 1e-12)
        yield norm.ppf(u)


def qmc_price_barrier_double(
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
    n_points=2**14,
    n_shifts=8,
    seed=12345,
    continuous_steps_per_year=4096,
    already_touched=False,
    *,
    value_date,
):
    if payment_time is None:
        payment_time = maturity
    if already_touched:
        # Seasoned state: out -> dead (expiry rebate still owed); in -> vanilla
        # (simulated as an "out" whose corridor can never be exited).
        if style == "out":
            price = rebate * math.exp(-rate * (payment_time - value_date)) if (rebate != 0.0 and rebate_timing == "expiry") else 0.0
            return price, 0.0
        return qmc_price_barrier_double(
            spot, strike, rate, div_yield, borrow, maturity, option_type,
            lower_barrier=1e-12, upper_barrier=1e12, style="out", trigger=trigger,
            vol_times=vol_times, vol_values=vol_values, rebate=0.0,
            payment_time=payment_time, n_points=n_points, n_shifts=n_shifts,
            seed=seed, continuous_steps_per_year=continuous_steps_per_year,
            value_date=value_date,
        )
    if value_date > payment_time:
        return 0.0, 0.0
    if value_date >= maturity:
        touched0 = not (lower_barrier < spot < upper_barrier)
        intrinsic = max(spot - strike, 0.0) if option_type == "call" else max(strike - spot, 0.0)
        price = (0.0 if touched0 else intrinsic) if style == "out" else (intrinsic if touched0 else 0.0)
        return price * math.exp(-rate * (payment_time - value_date)), 0.0

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    carry = rate - div_yield - borrow
    vol = effective_vol(vol_times, vol_values, maturity)
    disc_pay = math.exp(-rate * payment_time)

    if trigger == "european":
        steps = 1
    elif trigger in _OBS_PER_YEAR:
        steps = max(1, round(_OBS_PER_YEAR[trigger] * maturity))
    else:
        steps = max(64, round(continuous_steps_per_year * maturity))

    dt = maturity / steps
    drift = (carry - 0.5 * vol * vol) * dt
    sqrt_dt = vol * math.sqrt(dt)

    estimates = np.empty(n_shifts)
    for shift_index, z in enumerate(_shifted_sobol_normals(n_points, steps, n_shifts, seed)):
        log_increments = drift + sqrt_dt * z
        log_path = math.log(spot) + np.cumsum(log_increments, axis=1)
        full = np.exp(np.concatenate([np.full((n_points, 1), math.log(spot)), log_path], axis=1))

        if trigger == "european":
            terminal = full[:, -1]
            hit = (terminal <= lower_barrier) | (terminal >= upper_barrier)
            hit_idx = np.zeros(n_points, dtype=int)
        else:
            touched = (full <= lower_barrier) | (full >= upper_barrier)
            hit = np.any(touched, axis=1)
            hit_idx = np.argmax(touched, axis=1)

        terminal = full[:, -1]
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
