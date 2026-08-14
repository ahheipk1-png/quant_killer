"""Sobol-QMC benchmark for barrier_single.py.

- "european": barrier tested only at maturity -- check S_T alone.
- "continuous": Brownian-bridge continuity correction (the same technique
  documented in web-lab's `bridgeSurvival`). Given two discrete path points
  X_i, X_j (log-price) that haven't themselves crossed the barrier, the
  probability the *continuous* bridge between them stayed on the surviving
  side is available in closed form (reflection principle):
      P(no touch) = 1 - exp(-2*gap_i*gap_j / (sigma^2*dt))
  where gap_* is the (non-negative) log-distance from the barrier. The
  product of these per-step probabilities is a per-path SURVIVAL WEIGHT
  (not a boolean), averaged against the terminal payoff -- this reproduces
  the true continuous-monitoring price from a coarse discrete grid, without
  needing thousands of steps. Rebate-at-expiry reuses the same weight
  (it only needs the terminal touch probability). Rebate-at-hit genuinely
  needs a hit *time*, which the bridge weight doesn't give directly, so
  that path uses a much finer hard-indicator grid instead and is checked
  against a looser, explicitly documented tolerance.
- "monthly"/"weekly"/"daily": plain discrete indicator on the actual
  monitoring grid (that IS the definition of discrete monitoring; no
  correction needed -- the closed form's own BGK shift is what's being
  benchmarked against this ground truth).
"""

import math

import numpy as np
from scipy.stats import norm, qmc

from barrier_single import effective_vol, _OBS_PER_YEAR


def _shifted_sobol_normals(n_points, dims, n_shifts, seed):
    sampler = qmc.Sobol(d=dims, scramble=False)
    base = sampler.random(n_points)
    rng = np.random.default_rng(seed)
    for _ in range(n_shifts):
        shift = rng.random(dims)
        u = np.mod(base + shift, 1.0)
        u = np.clip(u, 1e-12, 1.0 - 1e-12)
        yield norm.ppf(u)


def _bridge_survival(full_log, log_barrier, direction, vol, dt):
    x_i = full_log[:, :-1]
    x_j = full_log[:, 1:]
    if direction == "up":
        gap_i = log_barrier - x_i
        gap_j = log_barrier - x_j
    else:
        gap_i = x_i - log_barrier
        gap_j = x_j - log_barrier
    already = (gap_i <= 0.0) | (gap_j <= 0.0)
    gap_i_safe = np.maximum(gap_i, 1e-12)
    gap_j_safe = np.maximum(gap_j, 1e-12)
    exponent = -2.0 * gap_i_safe * gap_j_safe / (vol * vol * dt)
    no_touch_step = np.where(already, 0.0, 1.0 - np.exp(exponent))
    return np.prod(no_touch_step, axis=1)


def qmc_price_barrier_single(
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
    n_points=2**14,
    n_shifts=8,
    seed=12345,
    already_touched=False,
    *,
    value_date,
):
    if payment_time is None:
        payment_time = maturity
    if already_touched:
        # Seasoned state: out -> dead (expiry rebate still owed); in -> vanilla.
        if style == "out":
            price = rebate * math.exp(-rate * (payment_time - value_date)) if (rebate != 0.0 and rebate_timing == "expiry") else 0.0
            return price, 0.0
        return qmc_price_barrier_single(
            spot, strike, rate, div_yield, borrow, maturity, option_type,
            barrier=1e-12 if direction == "down" else 1e12, direction=direction,
            style="out", trigger=trigger, vol_times=vol_times, vol_values=vol_values,
            rebate=0.0, payment_time=payment_time, n_points=n_points,
            n_shifts=n_shifts, seed=seed, value_date=value_date,
        )
    if value_date > payment_time:
        return 0.0, 0.0
    if value_date >= maturity:
        touched0 = (spot >= barrier) if direction == "up" else (spot <= barrier)
        intrinsic = max(spot - strike, 0.0) if option_type == "call" else max(strike - spot, 0.0)
        price = (0.0 if touched0 else intrinsic) if style == "out" else (intrinsic if touched0 else 0.0)
        return price * math.exp(-rate * (payment_time - value_date)), 0.0

    maturity = maturity - value_date
    payment_time = payment_time - value_date
    carry = rate - div_yield - borrow
    vol = effective_vol(vol_times, vol_values, maturity)
    disc_pay = math.exp(-rate * payment_time)
    log_barrier = math.log(barrier)
    log_spot = math.log(spot)

    needs_hit_time = rebate != 0.0 and rebate_timing == "hit"
    if trigger == "european":
        steps = 1
    elif trigger in _OBS_PER_YEAR:
        steps = max(1, round(_OBS_PER_YEAR[trigger] * maturity))
    elif needs_hit_time:
        steps = max(1024, round(1024 * maturity))  # fine grid; hit-time is approximate
    else:
        steps = max(64, round(252 * maturity))  # coarse grid is fine: bridge-weighted

    dt = maturity / steps
    drift = (carry - 0.5 * vol * vol) * dt
    sqrt_dt = vol * math.sqrt(dt)

    estimates = np.empty(n_shifts)
    for shift_index, z in enumerate(_shifted_sobol_normals(n_points, steps, n_shifts, seed)):
        log_increments = drift + sqrt_dt * z
        log_path = log_spot + np.cumsum(log_increments, axis=1)
        full_log = np.concatenate([np.full((n_points, 1), log_spot), log_path], axis=1)
        terminal = np.exp(full_log[:, -1])
        vanilla_payoff = np.maximum(terminal - strike, 0.0) if option_type == "call" else np.maximum(strike - terminal, 0.0)

        hard_touch = (full_log >= log_barrier) if direction == "up" else (full_log <= log_barrier)
        hard_hit = np.any(hard_touch, axis=1)
        hit_idx = np.argmax(hard_touch, axis=1)

        if trigger == "european":
            touched_terminal = (terminal >= barrier) if direction == "up" else (terminal <= barrier)
            survival = np.where(touched_terminal, 0.0, 1.0)
        elif trigger == "continuous":
            survival = _bridge_survival(full_log, log_barrier, direction, vol, dt)
        else:
            survival = np.where(hard_hit, 0.0, 1.0)

        option_alive = survival if style == "out" else (1.0 - survival)
        option_payoff = option_alive * vanilla_payoff

        if rebate != 0.0 and rebate_timing == "expiry":
            touch_prob = 1.0 - survival
            rebate_prob = touch_prob if style == "out" else (1.0 - touch_prob)
            estimates[shift_index] = disc_pay * (option_payoff + rebate_prob * rebate).mean()
        elif needs_hit_time:
            # Option leg deferred to payment_time as usual; rebate leg is
            # paid (and fully discounted) at its own hit time, not deferred.
            hit_time = hit_idx * dt
            rebate_disc = np.where(hard_hit, rebate * np.exp(-rate * hit_time), 0.0)
            option_leg = disc_pay * option_payoff.mean()
            estimates[shift_index] = option_leg + rebate_disc.mean()
        else:
            estimates[shift_index] = disc_pay * option_payoff.mean()

    price = float(estimates.mean())
    se = float(estimates.std(ddof=1) / math.sqrt(n_shifts)) if n_shifts > 1 else 0.0
    return price, se
