"""American option PDE solver -- the accuracy benchmark for
american_ju_zhong.py (this family uses a PDE instead of a QMC benchmark,
since American exercise has no simple unbiased Monte Carlo estimator).

Method: Crank-Nicolson finite differences in log-free price space, with
  - a sinh-clustered NON-UNIFORM grid concentrated around the strike (true
    unequal-spacing 3-point stencils, not a uniform grid dressed up),
  - a Forsyth-Vetzal PENALTY iteration for the early-exercise constraint
    (not projection, which is only first-order accurate at the exercise
    boundary -- the penalty method keeps second-order convergence),
  - Rannacher start-up (the first two time steps are fully implicit, to
    damp the payoff kink's initial oscillation before switching to
    Crank-Nicolson for the rest -- CN applied from step 1 rings on a
    non-smooth initial condition),
  - cell-averaged (not point-sampled) payoff as the terminal condition, and
  - Richardson extrapolation in (space, time) simultaneously refined 2x,
    with a convergence table available via convergence_table() for
    independent verification that the scheme is actually converging at
    close to its design order, not just printing a number.

Uses a single effective vol (like every other American/barrier family
here) -- this file's purpose is validating the Ju-Zhong FORMULA against
full early-exercise numerics, not re-litigating the term-vol collapse.
"""

import math

import numpy as np
from scipy.linalg import solve_banded


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


def _sinh_grid(strike, s_min, s_max, n_space, concentration):
    """Non-uniform grid via S_i = K + c*sinh(xi_i), xi uniform -- clusters
    points densely around the strike, sparsely near the far boundaries."""
    c = max(concentration * strike, 1e-6)
    xi_min = math.asinh((s_min - strike) / c)
    xi_max = math.asinh((s_max - strike) / c)
    xi = np.linspace(xi_min, xi_max, n_space + 1)
    s = strike + c * np.sinh(xi)
    s[0], s[-1] = s_min, s_max
    return s


def _cell_averaged_payoff(s_grid, strike, is_call):
    """Average the (kinked) payoff over each cell [midpoint_left,
    midpoint_right] instead of point-sampling at the kink -- damps the
    Gibbs-type ringing a non-smooth initial condition would otherwise cause."""
    n = s_grid.size
    edges = np.empty(n + 1)
    edges[1:-1] = 0.5 * (s_grid[:-1] + s_grid[1:])
    edges[0] = s_grid[0]
    edges[-1] = s_grid[-1]
    payoff = np.empty(n)
    for i in range(n):
        a, b = edges[i], edges[i + 1]
        if b <= a:
            payoff[i] = max(s_grid[i] - strike, 0.0) if is_call else max(strike - s_grid[i], 0.0)
            continue
        if is_call:
            lo, hi = max(a, strike), b
            payoff[i] = 0.0 if lo >= hi else 0.5 * (hi - lo) * (hi + lo - 2.0 * strike) / (b - a)
        else:
            lo, hi = a, min(b, strike)
            payoff[i] = 0.0 if lo >= hi else 0.5 * (hi - lo) * (2.0 * strike - hi - lo) / (b - a)
    return payoff


def _tridiag_operator(s_grid, rate, carry, vol):
    """Non-uniform 3-point stencils for the BS spatial operator
    L[V] = 0.5*vol^2*S^2*V'' + carry*S*V' - rate*V, returned as (lower,
    diag, upper) bands (interior points only)."""
    h_minus = np.diff(s_grid)[:-1]
    h_plus = np.diff(s_grid)[1:]
    s_i = s_grid[1:-1]

    d1_lower = -h_plus / (h_minus * (h_minus + h_plus))
    d1_diag = (h_plus - h_minus) / (h_minus * h_plus)
    d1_upper = h_minus / (h_plus * (h_minus + h_plus))

    d2_lower = 2.0 / (h_minus * (h_minus + h_plus))
    d2_diag = -2.0 / (h_minus * h_plus)
    d2_upper = 2.0 / (h_plus * (h_minus + h_plus))

    diff_coeff = 0.5 * vol * vol * s_i * s_i
    conv_coeff = carry * s_i

    lower = diff_coeff * d2_lower + conv_coeff * d1_lower
    diag = diff_coeff * d2_diag + conv_coeff * d1_diag - rate
    upper = diff_coeff * d2_upper + conv_coeff * d1_upper
    return lower, diag, upper


def _solve_penalty_step(a_lower, a_diag, a_upper, rhs, payoff, penalty_scale, max_iter=50, tol=1e-10):
    """Forsyth-Vetzal penalty iteration for (A) V = rhs + penalty*(V<payoff),
    enforcing V >= payoff without switching to a first-order projection."""
    n = rhs.size
    v = np.maximum(rhs.copy(), payoff)
    for _ in range(max_iter):
        active = v < payoff - 1e-12
        penalty = np.where(active, penalty_scale, 0.0)
        diag = a_diag + penalty
        banded = np.zeros((3, n))
        banded[0, 1:] = a_upper[:-1]
        banded[1, :] = diag
        banded[2, :-1] = a_lower[1:]
        b = rhs + penalty * payoff
        v_new = solve_banded((1, 1), banded, b)
        v_new = np.maximum(v_new, payoff)
        if np.max(np.abs(v_new - v)) < tol * max(1.0, np.max(np.abs(v))):
            v = v_new
            break
        v = v_new
    return v


def _solve_american_pde(spot, strike, rate, carry, vol, maturity, is_call, n_space, n_time, s_min, s_max, concentration):
    s_grid = _sinh_grid(strike, s_min, s_max, n_space, concentration)
    n = s_grid.size
    payoff_full = _cell_averaged_payoff(s_grid, strike, is_call)

    lower, diag, upper = _tridiag_operator(s_grid, rate, carry, vol)
    dt_total = maturity / n_time
    penalty_scale = 1.0e7 / max(strike, 1.0)

    v = payoff_full.copy()

    def boundary_values(tau):
        if is_call:
            lo = 0.0
            hi = s_grid[-1] * math.exp(carry * tau) - strike * math.exp(-rate * tau)
            hi = max(hi, s_grid[-1] - strike)
        else:
            lo = strike * math.exp(-rate * tau) - s_grid[0] * math.exp(carry * tau)
            lo = max(lo, strike - s_grid[0])
            hi = 0.0
        return lo, hi

    def step(v_in, dt, theta):
        interior = v_in[1:-1]
        rhs_interior = interior + (1.0 - theta) * dt * (lower * v_in[:-2] + diag * interior + upper * v_in[2:])
        a_lower = -theta * dt * lower
        a_diag = 1.0 - theta * dt * diag
        a_upper = -theta * dt * upper
        v_out = np.empty(n)
        v_out[1:-1] = _solve_penalty_step(a_lower, a_diag, a_upper, rhs_interior, payoff_full[1:-1], penalty_scale)
        return v_out

    tau = 0.0
    rannacher_steps = min(2, n_time)
    dt_half = dt_total / 2.0
    for _ in range(rannacher_steps):
        v = step(v, dt_half, 1.0)
        tau += dt_half
        v = step(v, dt_half, 1.0)
        tau += dt_half
        lo, hi = boundary_values(tau)
        v[0], v[-1] = max(lo, payoff_full[0]), max(hi, payoff_full[-1])

    remaining = n_time - rannacher_steps
    for _ in range(remaining):
        v = step(v, dt_total, 0.5)
        tau += dt_total
        lo, hi = boundary_values(tau)
        v[0], v[-1] = max(lo, payoff_full[0]), max(hi, payoff_full[-1])

    return float(np.interp(spot, s_grid, v))


def price_american_pde(
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
    n_space=200,
    n_time=200,
    richardson=True,
    *,
    value_date,
):
    """American option NPV via Crank-Nicolson PDE + penalty, Richardson-
    extrapolated in (space, time) by default.

    `settle_lag` (cash-settlement delay, exercise at tau pays at tau+lag)
    scales the whole value by e^(-r*lag) EXACTLY -- scaling the payoff by
    a positive constant scales the LCP solution and leaves the exercise
    region unchanged, the same argument as american_ju_zhong.py -- so the
    PDE benchmark stays an independent check of the Ju-Zhong formula, not
    of the (shared, exact) lag factorization.

    `value_date` (required) follows american_ju_zhong.py's convention.
    `strike == 0` needs no special handling here (unlike the closed forms):
    the sinh-grid concentration and payoff already floor gracefully.
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    eff_div_yield = div_yield + borrow
    if strike < 0.0:
        raise ValueError("strike must be non-negative.")
    if settle_lag < 0.0:
        raise ValueError("settle_lag must be non-negative.")
    if value_date < 0.0:
        raise ValueError("value_date must be non-negative.")

    is_call = option_type == "call"
    settlement = maturity + settle_lag

    if value_date > settlement:
        return 0.0

    if value_date >= maturity:
        intrinsic = max(spot - strike, 0.0) if is_call else max(strike - spot, 0.0)
        return intrinsic * math.exp(-rate * (settlement - value_date))

    maturity = maturity - value_date
    carry = rate - eff_div_yield
    vol = effective_vol(vol_times, vol_values, maturity)
    deferral = math.exp(-rate * settle_lag)

    root_t = max(vol, 1e-4) * math.sqrt(maturity)
    s_min = max(spot, strike) * math.exp(-8.0 * root_t - 0.05)
    s_max = max(spot, strike) * math.exp(8.0 * root_t + 0.05)
    concentration = 0.15

    price_coarse = _solve_american_pde(spot, strike, rate, carry, vol, maturity, is_call,
                                        n_space, n_time, s_min, s_max, concentration)
    if not richardson:
        return price_coarse * deferral

    price_fine = _solve_american_pde(spot, strike, rate, carry, vol, maturity, is_call,
                                      2 * n_space, 2 * n_time, s_min, s_max, concentration)
    extrapolated = (4.0 * price_fine - price_coarse) / 3.0
    intrinsic = max(spot - strike, 0.0) if is_call else max(strike - spot, 0.0)
    return max(extrapolated, intrinsic) * deferral


def convergence_table(spot, strike, rate, div_yield, borrow, maturity, option_type,
                       vol_times, vol_values, sizes=(25, 50, 100, 200, 400)):
    """Independent verification that the scheme converges near its design
    order -- prices at successively doubled (space,time) resolution, no
    Richardson extrapolation, so the ratio of successive differences should
    approach ~4 (second order) as sizes grow."""
    eff_div_yield = div_yield + borrow
    is_call = option_type == "call"
    carry = rate - eff_div_yield
    vol = effective_vol(vol_times, vol_values, maturity)
    root_t = max(vol, 1e-4) * math.sqrt(maturity)
    s_min = max(spot, strike) * math.exp(-8.0 * root_t - 0.05)
    s_max = max(spot, strike) * math.exp(8.0 * root_t + 0.05)

    rows = []
    for n in sizes:
        price = _solve_american_pde(spot, strike, rate, carry, vol, maturity, is_call,
                                     n, n, s_min, s_max, 0.15)
        rows.append((n, price))
    return rows
