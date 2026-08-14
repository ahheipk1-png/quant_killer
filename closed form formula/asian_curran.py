"""Discrete arithmetic Asian options via Curran geometric conditioning.

Self-contained (numpy/scipy only). NPV only.

Single underlying is the n=1 case of a weighted basket of Asian averages:

    BasketAverage = sum_i weights[i] * A_i,   A_i = average of asset i's fixings

Fixings may be partly SEASONED: `observed_sum[i]` / `observed_count[i]` are
the sum and count of asset i's fixings already set (deterministic, no
diffusion); `fixing_times` is the shared schedule of REMAINING fixings
(unevenly spaced by design -- there is no evenly-spaced assumption anywhere
in this file). N_i = observed_count[i] + len(fixing_times).

Curran conditioning
--------------------
Condition on Y = sum_i weights[i]/m * sum_k X_{i,k}, the weighted sum of
each asset's own average LOG-price over the m remaining fixings (X = ln S).
Given Y, every X_{i,k} is exactly normal (jointly-normal conditioning), so
each S_i(t_k) = exp(X_{i,k}) is exactly conditionally lognormal. The two
variants differ only in what they do with that fact:

  - "one_moment": collapse each conditional S_i(t_k) to its conditional
    MEAN, so the conditional average is a deterministic number. Cheap,
    exact for a single fixing (the "average" degenerates to S_T -- see
    test_asian_curran.py), and this is where per-underlying capping is
    exact: clip A_i's conditional mean once per asset (a single number),
    then combine into the basket. No truncated-moment machinery needed.
  - "two_moment": keep the conditional SPREAD by fitting a lognormal to
    the conditional first AND second moment of the whole basket average.
    More accurate when the components genuinely retain uncertainty given
    Y (i.e. correlation is not close to 1); NOT exact under capping,
    since capping breaks the joint lognormality this variant relies on.

Time covariance Cov(X_i(s), X_i(t)) = W_i(min(s,t)) is EXACT under term
vol -- it is precisely the definition of total variance to the earlier
time. Cross-asset covariance Cov(X_i(s), X_j(t)) is approximated as
rho_ij * sqrt(W_i(min(s,t)) * W_j(min(s,t))); this is exact when both
assets' term-vol curves have the same shape (in particular, always exact
under constant per-asset vol, where it reduces to the familiar
rho_ij*sigma_i*sigma_j*min(s,t)) and approximate otherwise. The measured
size of that approximation is reported by the paired tests, not asserted
blind.
"""

import math

import numpy as np
from scipy.integrate import quad
from scipy.stats import norm


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


_Z_LOWER, _Z_UPPER = -10.0, 10.0
_SQRT_2PI = math.sqrt(2.0 * math.pi)


def _norm_pdf(z):
    return math.exp(-0.5 * z * z) / _SQRT_2PI


def _integrate_over_z(scalar_integrand):
    """Adaptive quadrature of scalar_integrand(z)*phi(z) dz over the real
    line (truncated to +-10 std). The payoff has a kink in z (from max(.,0)
    and/or cap/floor clipping) that a fixed-node rule resolves only to
    ~1e-3 -- QUADPACK's adaptive QAGS (via scipy.integrate.quad) subdivides
    around it automatically and reaches ~1e-10, confirmed against the
    Black-Scholes closed form in the single-fixing degenerate case.
    """
    value, _ = quad(
        lambda z: scalar_integrand(z) * _norm_pdf(z),
        _Z_LOWER, _Z_UPPER, limit=200, epsabs=1e-12, epsrel=1e-11,
    )
    return value


def price_asian_curran(
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
    variant="one_moment",
    *,
    value_date,
):
    """Weighted basket-of-averages Asian option. n=1, weights=[1.0] is the
    single-underlying case.

    `value_date` (required) is the "as of" time, same axis as `maturity`/
    `payment_time`/`fixing_times` -- see european.price_european's docstring
    for the general three-regime convention. For Asian specifically: once
    `value_date >= maturity`, every fixing must already be reflected in
    `observed_sum`/`observed_count` (pass an empty `fixing_times`) --
    Asian's payoff depends on the realized average, which isn't
    reconstructible from `spots` alone the way a terminal-spot payoff is.
    """
    if option_type not in ("call", "put"):
        raise ValueError('option_type must be "call" or "put".')
    if variant not in ("one_moment", "two_moment"):
        raise ValueError('variant must be "one_moment" or "two_moment".')
    if (cap is not None or floor is not None) and variant != "one_moment":
        raise ValueError("Cap/floor is only exact under the one-moment variant.")
    if cap is not None and floor is not None and cap <= floor:
        raise ValueError("cap must be strictly above floor.")
    if payment_time is None:
        payment_time = maturity
    if payment_time < maturity - 1e-12:
        raise ValueError("payment_time cannot precede maturity.")
    if value_date < 0.0:
        raise ValueError("value_date must be non-negative.")

    spots = np.asarray(spots, dtype=float)
    weights = np.asarray(weights, dtype=float)
    n = spots.size
    if weights.size != n:
        raise ValueError("weights must match spots in length.")
    if variant == "two_moment" and np.any(weights < 0.0):
        raise ValueError(
            "two_moment requires non-negative weights: it fits a lognormal to the "
            "stochastic average, which is only meaningful when that average is "
            "guaranteed non-negative (e.g. a spread with mixed-sign weights can go "
            "negative). Use variant=\"one_moment\" for spread-style baskets."
        )
    div_yields = np.broadcast_to(np.asarray(div_yields, dtype=float), (n,))
    borrows = np.broadcast_to(np.asarray(borrows, dtype=float), (n,))
    carries = rate - div_yields - borrows

    if value_date > payment_time:
        return 0.0

    fixing_times = np.asarray(fixing_times, dtype=float)
    m = fixing_times.size
    if value_date >= maturity and m > 0:
        raise ValueError(
            "When value_date >= maturity, every fixing must already be reflected in "
            "observed_sum/observed_count (pass an empty fixing_times)."
        )
    remaining_maturity = maturity - value_date
    if m > 0:
        fixing_times = fixing_times - value_date
        if np.any(np.diff(fixing_times) <= 0.0):
            raise ValueError("fixing_times must be strictly increasing.")
        if fixing_times[0] <= 0.0 or fixing_times[-1] > remaining_maturity + 1e-9:
            raise ValueError("fixing_times must lie in (0, maturity] relative to value_date.")

    observed_sum = np.zeros(n) if observed_sum is None else np.broadcast_to(
        np.asarray(observed_sum, dtype=float), (n,)
    ).copy()
    observed_count = np.zeros(n, dtype=int) if observed_count is None else np.broadcast_to(
        np.asarray(observed_count, dtype=int), (n,)
    ).copy()
    fixing_counts = observed_count + m
    if np.any(fixing_counts <= 0):
        raise ValueError("Every asset needs at least one fixing (observed or remaining).")

    disc_pay = math.exp(-rate * (payment_time - value_date))
    is_call = option_type == "call"
    phi = 1.0 if is_call else -1.0

    if m == 0:
        # Fully seasoned: the average is deterministic.
        a_i = observed_sum / fixing_counts
        if cap is not None or floor is not None:
            perf = a_i / spots
            if floor is not None:
                perf = np.maximum(perf, floor)
            if cap is not None:
                perf = np.minimum(perf, cap)
            a_i = perf * spots
        basket_average = float(np.sum(weights * a_i))
        payoff = max(phi * (basket_average - strike), 0.0)
        return disc_pay * payoff

    if np.ndim(correlation) == 0:
        corr = np.full((n, n), float(correlation))
        np.fill_diagonal(corr, 1.0)
    else:
        corr = np.asarray(correlation, dtype=float)
        if corr.shape != (n, n):
            raise ValueError("correlation matrix must be (n, n).")

    # Unconditional moments of each remaining fixing.
    means = np.empty((n, m))
    total_vars = np.empty((n, m))
    for i in range(n):
        w_i = total_variance(vol_times_list[i], vol_values_list[i], fixing_times)
        total_vars[i, :] = w_i
        means[i, :] = math.log(spots[i]) + carries[i] * fixing_times - 0.5 * w_i

    # Cross-covariance blocks Cov(X_i(t_k), X_j(t_l)) for every asset pair,
    # built once (m x m per pair, n x n pairs -> an (n*m, n*m) block matrix).
    min_mat = np.minimum(fixing_times[:, None], fixing_times[None, :])
    flat_min = min_mat.ravel()
    w_at_min = [total_variance(vol_times_list[i], vol_values_list[i], flat_min).reshape(m, m) for i in range(n)]

    blocks = [[corr[i, j] * np.sqrt(w_at_min[i] * w_at_min[j]) for j in range(n)] for i in range(n)]
    big_cov = np.block(blocks)  # (N, N), N = n*m, component order c = i*m + k

    # Conditioning variable Y and each component's covariance with it.
    y_weight = np.repeat(weights, m) / m  # weights[i]/m per (i,k) component
    cov_iy = big_cov @ y_weight  # (N,)
    var_y = float(y_weight @ big_cov @ y_weight)

    comp_mean = means.reshape(-1)
    comp_var = total_vars.reshape(-1)
    comp_a = np.repeat(weights / fixing_counts, m)  # payoff weight a_{i,k} = weights[i]/N_i
    deterministic_offset = float(np.sum(weights * observed_sum / fixing_counts))

    if var_y <= 1e-16:
        # Degenerate conditioning (e.g. a single component overall): the
        # "conditional" law is exact, so this collapses to the one-moment
        # path automatically via beta below (division guarded).
        beta = np.zeros_like(comp_mean)
        cond_var = comp_var.copy()
    else:
        beta = cov_iy / math.sqrt(var_y)
        cond_var = np.maximum(comp_var - cov_iy * cov_iy / var_y, 0.0)

    level0 = np.exp(comp_mean + 0.5 * cond_var)  # E[S_i(t_k) | Y = mean_y]

    def _level(z):
        return level0 * np.exp(z * beta)  # (N,)

    if variant == "one_moment" and (cap is not None or floor is not None):
        def _basket_avg(z):
            level = _level(z).reshape(n, m)
            stochastic_avg = level.sum(axis=1) / fixing_counts
            total_avg = stochastic_avg + observed_sum / fixing_counts
            perf = total_avg / spots
            if floor is not None:
                perf = np.maximum(perf, floor)
            if cap is not None:
                perf = np.minimum(perf, cap)
            return float(np.dot(perf * spots, weights))

        undiscounted = _integrate_over_z(lambda z: max(phi * (_basket_avg(z) - strike), 0.0))
        return disc_pay * undiscounted

    if variant == "one_moment":
        def _payoff(z):
            basket_avg = float(np.dot(comp_a, _level(z))) + deterministic_offset
            return max(phi * (basket_avg - strike), 0.0)

        undiscounted = _integrate_over_z(_payoff)
        return disc_pay * undiscounted

    # two_moment: fit a lognormal to the conditional first and second moment
    # of the STOCHASTIC part of the basket average, at each z.
    adjusted_strike = strike - deterministic_offset
    unconditional_mean_total = deterministic_offset + float(
        np.sum(comp_a * np.exp(comp_mean + 0.5 * comp_var))
    )
    # Shortcut valid ONLY when every component's stochastic contribution is
    # a.s. non-negative (comp_a = weights/fixing_counts >= 0, i.e. every
    # weight >= 0): then adjusted_strike <= 0 means the average is >= strike
    # with certainty (not just in expectation), so the call degenerates to
    # a forward -- no lognormal fit needed. With any negative weight (e.g.
    # a spread-style basket) that guarantee doesn't hold and this shortcut
    # is wrong; verified against QMC, which caught a real bug here.
    if adjusted_strike <= 0.0 and np.all(comp_a >= 0.0):
        call = disc_pay * max(unconditional_mean_total - strike, 0.0)
        return call if is_call else 0.0

    if var_y <= 1e-16:
        cond_cov = big_cov.copy()
    else:
        cond_cov = big_cov - np.outer(cov_iy, cov_iy) / var_y
    exp_cond_cov = np.exp(cond_cov)

    def _call_undisc(z):
        level = _level(z)
        m1 = float(np.dot(comp_a, level))
        if m1 <= 1e-300:
            return 0.0
        weighted_level = level * comp_a
        m2 = float(weighted_level @ exp_cond_cov @ weighted_level)
        log_var = max(math.log(max(m2, 1e-300) / max(m1, 1e-300) ** 2), 0.0)
        if log_var <= 1e-14:
            return max(m1 - adjusted_strike, 0.0)
        root = math.sqrt(log_var)
        d1 = (math.log(m1 / adjusted_strike) + 0.5 * log_var) / root
        d2 = d1 - root
        return m1 * norm.cdf(d1) - adjusted_strike * norm.cdf(d2)

    call_price = disc_pay * _integrate_over_z(_call_undisc)
    if is_call:
        return call_price
    return call_price - disc_pay * (unconditional_mean_total - strike)
