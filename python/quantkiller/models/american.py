"""American-exercise approximations beyond the CRR tree in binomial.py.

Ported and adapted from the QuantKiller browser lab's Python engine
(merged into this project — see web-lab/), which itself follows the
published papers:

  - Barone-Adesi & Whaley (1987), "Efficient Analytic Approximation of
    American Option Values", Journal of Finance.
  - Ju & Zhong (1999), "An Approximate Formula for Pricing American
    Options", Journal of Derivatives — a second-order correction to BAW.
  - Bjerksund & Stensland (1993 and 2002), two-piece and multi-piece
    exercise-boundary approximations.
  - Carr (1998) randomization: the American option as a Bermudan with an
    Erlang-distributed number of exercise opportunities, solved by a
    PSOR finite-difference scheme and Richardson-extrapolated in the
    phase count. This one is a numerical PDE method dressed as a
    closed-form-style API, not a formula — see _carr_randomization_core.

All four reduce to the exact Black-Scholes European price when early
exercise is never optimal (calls with dividend_yield <= 0), which is the
primary correctness check in tests/test_american.py alongside cross-method
agreement and comparison to the CRR-American tree at high step counts.
"""

import math

from .. import QKError
from ..qkmath import norm_cdf, norm_pdf
from ._common import CALL, get_int, get_num, get_option_type
from .black_scholes import price as bs_price


def _intrinsic(spot, strike, is_call):
    return max((spot - strike) if is_call else (strike - spot), 0.0)


def _european(spot, strike, rate, div_yield, vol, time, option_type):
    return bs_price(spot, strike, rate, div_yield, vol, time, option_type)["price"]


def _validate_american(rate, div_yield):
    if rate < 0.0 or div_yield < 0.0:
        raise QKError("this American approximation requires rate >= 0 and div_yield >= 0")


# ---------------------------------------------------------------------------
# Barone-Adesi-Whaley
# ---------------------------------------------------------------------------

def _baw_critical_price(strike, rate, div_yield, vol, time, is_call):
    variance = vol * vol * time
    root_variance = math.sqrt(variance)
    risk_free_discount = math.exp(-rate * time)
    dividend_discount = math.exp(-div_yield * time)
    n = 2.0 * math.log(dividend_discount / risk_free_discount) / variance
    m = -2.0 * math.log(risk_free_discount) / variance
    carry_time = math.log(dividend_discount / risk_free_discount)

    if is_call:
        upper_exponent = (-(n - 1.0) + math.sqrt((n - 1.0) ** 2 + 4.0 * m)) / 2.0
        upper = strike / (1.0 - 1.0 / upper_exponent)
        h = -(carry_time + 2.0 * root_variance) * strike / (upper - strike)
        boundary = strike + (upper - strike) * (1.0 - math.exp(h))
    else:
        upper_exponent = (-(n - 1.0) - math.sqrt((n - 1.0) ** 2 + 4.0 * m)) / 2.0
        upper = strike / (1.0 - 1.0 / upper_exponent)
        h = (carry_time - 2.0 * root_variance) * strike / (strike - upper)
        boundary = upper + (strike - upper) * math.exp(h)

    coefficient = (
        -2.0 * math.log(risk_free_discount) / (variance * (1.0 - risk_free_discount))
        if abs(1.0 - risk_free_discount) > 1.0e-12 else 2.0 / variance
    )
    exponent = (
        (-(n - 1.0) + math.sqrt((n - 1.0) ** 2 + 4.0 * coefficient)) / 2.0 if is_call
        else (-(n - 1.0) - math.sqrt((n - 1.0) ** 2 + 4.0 * coefficient)) / 2.0
    )

    for _ in range(100):
        forward_boundary = boundary * dividend_discount / risk_free_discount
        d1 = (math.log(forward_boundary / strike) + 0.5 * variance) / root_variance
        european = _european(boundary, strike, rate, div_yield, vol, time, CALL if is_call else "put")
        if is_call:
            lhs = boundary - strike
            rhs = european + (1.0 - dividend_discount * norm_cdf(d1)) * boundary / exponent
            slope = (dividend_discount * norm_cdf(d1) * (1.0 - 1.0 / exponent)
                     + (1.0 - dividend_discount * norm_pdf(d1) / root_variance) / exponent)
            if abs(lhs - rhs) / strike <= 1.0e-8:
                break
            boundary = (strike + rhs - slope * boundary) / (1.0 - slope)
        else:
            lhs = strike - boundary
            rhs = european - (1.0 - dividend_discount * norm_cdf(-d1)) * boundary / exponent
            slope = (-dividend_discount * norm_cdf(-d1) * (1.0 - 1.0 / exponent)
                     - (1.0 + dividend_discount * norm_pdf(-d1) / root_variance) / exponent)
            if abs(lhs - rhs) / strike <= 1.0e-8:
                break
            boundary = (strike - rhs + slope * boundary) / (1.0 + slope)
    return boundary, exponent


def baw_price(spot, strike, rate, div_yield, vol, time, option_type):
    is_call = option_type == CALL
    _validate_american(rate, div_yield)
    european = _european(spot, strike, rate, div_yield, vol, time, option_type)
    intrinsic = _intrinsic(spot, strike, is_call)
    if vol == 0.0 or (is_call and div_yield <= 0.0):
        return {"price": max(european, intrinsic)}

    boundary, exponent = _baw_critical_price(strike, rate, div_yield, vol, time, is_call)
    variance = vol * vol * time
    d1 = (math.log(boundary * math.exp((rate - div_yield) * time) / strike) + 0.5 * variance) / math.sqrt(variance)
    dividend_discount = math.exp(-div_yield * time)
    if is_call:
        coefficient = boundary / exponent * (1.0 - dividend_discount * norm_cdf(d1))
        value = european + coefficient * (spot / boundary) ** exponent if spot < boundary else intrinsic
    else:
        coefficient = -boundary / exponent * (1.0 - dividend_discount * norm_cdf(-d1))
        value = european + coefficient * (spot / boundary) ** exponent if spot > boundary else intrinsic
    return {"price": max(value, european, intrinsic)}


def run_baw(params: dict) -> dict:
    return baw_price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        vol=get_num(params, "vol", minimum=0.0),
        time=get_num(params, "time", minimum=0.0, strict_min=True),
        option_type=get_option_type(params),
    )


# ---------------------------------------------------------------------------
# Ju-Zhong (second-order correction to BAW)
# ---------------------------------------------------------------------------

def ju_zhong_price(spot, strike, rate, div_yield, vol, time, option_type):
    is_call = option_type == CALL
    _validate_american(rate, div_yield)
    european = _european(spot, strike, rate, div_yield, vol, time, option_type)
    intrinsic = _intrinsic(spot, strike, is_call)
    if vol == 0.0 or (is_call and div_yield <= 0.0):
        return {"price": max(european, intrinsic)}
    if abs(rate) < 1e-9:
        return baw_price(spot, strike, rate, div_yield, vol, time, option_type)

    boundary, _ = _baw_critical_price(strike, rate, div_yield, vol, time, is_call)
    phi = 1.0 if is_call else -1.0
    variance = vol * vol * time
    root_variance = math.sqrt(variance)
    risk_free_discount = math.exp(-rate * time)
    dividend_discount = math.exp(-div_yield * time)
    h = 1.0 - risk_free_discount
    alpha = -2.0 * math.log(risk_free_discount) / variance
    beta = 2.0 * math.log(dividend_discount / risk_free_discount) / variance
    radical = math.sqrt((beta - 1.0) ** 2 + 4.0 * alpha / h)
    exponent = (-(beta - 1.0) + phi * radical) / 2.0
    exponent_prime = -phi * alpha / (h * h * radical)
    european_boundary = _european(boundary, strike, rate, div_yield, vol, time, option_type)
    premium_boundary = phi * (boundary - strike) - european_boundary
    denominator = 2.0 * exponent + beta - 1.0
    if abs(premium_boundary) < 1e-12 or abs(denominator) < 1e-12:
        return baw_price(spot, strike, rate, div_yield, vol, time, option_type)

    forward_boundary = boundary * dividend_discount / risk_free_discount
    d1 = (math.log(forward_boundary / strike) + 0.5 * variance) / root_variance
    d2 = d1 - root_variance
    european_h = (forward_boundary * norm_pdf(d1) / (alpha * root_variance)
                  - phi * forward_boundary * norm_cdf(phi * d1)
                  * math.log(dividend_discount) / math.log(risk_free_discount)
                  + phi * strike * norm_cdf(phi * d2))
    quadratic = (1.0 - h) * alpha * exponent_prime / (2.0 * denominator)
    linear = -(1.0 - h) * alpha / denominator * (european_h / premium_boundary + 1.0 / h + exponent_prime / denominator)
    log_ratio = math.log(spot / boundary)
    chi = log_ratio * (quadratic * log_ratio + linear)
    if not math.isfinite(chi) or abs(1.0 - chi) <= 1e-8:
        return baw_price(spot, strike, rate, div_yield, vol, time, option_type)

    continuation_region = phi * (boundary - spot) > 0.0
    value = (european + premium_boundary * (spot / boundary) ** exponent / (1.0 - chi)
             if continuation_region else intrinsic)
    return {"price": max(value, european, intrinsic)}


def run_ju_zhong(params: dict) -> dict:
    return ju_zhong_price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        vol=get_num(params, "vol", minimum=0.0),
        time=get_num(params, "time", minimum=0.0, strict_min=True),
        option_type=get_option_type(params),
    )


# ---------------------------------------------------------------------------
# Bjerksund-Stensland 1993
# ---------------------------------------------------------------------------

def _bjerksund_phi(spot, gamma, boundary, trigger, rate_time, carry_time, variance):
    root_variance = math.sqrt(variance)
    lam = -rate_time + gamma * carry_time + 0.5 * gamma * (gamma - 1.0) * variance
    d = -(math.log(spot / boundary) + carry_time + (gamma - 0.5) * variance) / root_variance
    kappa = 2.0 * carry_time / variance + 2.0 * gamma - 1.0
    return math.exp(lam) * (norm_cdf(d) - (trigger / spot) ** kappa
                             * norm_cdf(d - 2.0 * math.log(trigger / spot) / root_variance))


def _bjerksund_call(spot, strike, risk_free_discount, dividend_discount, variance):
    rate_time = math.log(1.0 / risk_free_discount)
    carry_time = math.log(dividend_discount / risk_free_discount)
    european = _european(spot, strike, rate_time, rate_time - carry_time, math.sqrt(variance), 1.0, CALL)
    intrinsic = max(spot - strike, 0.0)
    if dividend_discount >= 1.0 and dividend_discount >= risk_free_discount:
        return max(european, intrinsic)

    beta = 0.5 - carry_time / variance + math.sqrt((carry_time / variance - 0.5) ** 2 + 2.0 * rate_time / variance)
    if beta <= 1.0:
        return max(european, intrinsic)
    boundary_infinity = beta / (beta - 1.0) * strike
    boundary_zero = (strike if abs(carry_time - rate_time) < 1.0e-14
                      else max(strike, rate_time / (rate_time - carry_time) * strike))
    h = -(carry_time + 2.0 * math.sqrt(variance)) * boundary_zero / (boundary_infinity - boundary_zero)
    boundary = boundary_zero + (boundary_infinity - boundary_zero) * (1.0 - math.exp(h))
    forward = spot * dividend_discount / risk_free_discount
    if spot >= boundary:
        return intrinsic
    if math.log(boundary / forward) / math.sqrt(variance) > 12.5:
        return max(european, intrinsic)

    value = (
        (boundary - strike) * (spot / boundary) ** beta
        * (1.0 - _bjerksund_phi(spot, beta, boundary, boundary, rate_time, carry_time, variance))
        + spot * _bjerksund_phi(spot, 1.0, boundary, boundary, rate_time, carry_time, variance)
        - spot * _bjerksund_phi(spot, 1.0, strike, boundary, rate_time, carry_time, variance)
        - strike * _bjerksund_phi(spot, 0.0, boundary, boundary, rate_time, carry_time, variance)
        + strike * _bjerksund_phi(spot, 0.0, strike, boundary, rate_time, carry_time, variance)
    )
    return max(value, european, intrinsic)


def bjerksund_1993_price(spot, strike, rate, div_yield, vol, time, option_type):
    is_call = option_type == CALL
    _validate_american(rate, div_yield)
    european = _european(spot, strike, rate, div_yield, vol, time, option_type)
    intrinsic = _intrinsic(spot, strike, is_call)
    if vol == 0.0:
        return {"price": max(european, intrinsic)}
    risk_free_discount = math.exp(-rate * time)
    dividend_discount = math.exp(-div_yield * time)
    variance = vol * vol * time
    value = (_bjerksund_call(spot, strike, risk_free_discount, dividend_discount, variance) if is_call
             else _bjerksund_call(strike, spot, dividend_discount, risk_free_discount, variance))
    return {"price": max(value, european, intrinsic)}


def run_bjerksund_1993(params: dict) -> dict:
    return bjerksund_1993_price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        vol=get_num(params, "vol", minimum=0.0),
        time=get_num(params, "time", minimum=0.0, strict_min=True),
        option_type=get_option_type(params),
    )


# ---------------------------------------------------------------------------
# Bjerksund-Stensland 2002 (three-piece boundary)
# ---------------------------------------------------------------------------

def _bivariate_normal_cdf(first, second, correlation):
    if first <= -10.0 or second <= -10.0:
        return 0.0
    if first >= 10.0:
        return norm_cdf(second)
    if second >= 10.0:
        return norm_cdf(first)
    if abs(correlation) < 1.0e-14:
        return norm_cdf(first) * norm_cdf(second)
    upper = min(first, 10.0)
    lower = -10.0
    intervals = 512
    width = (upper - lower) / intervals
    correlation_scale = math.sqrt(1.0 - correlation * correlation)

    def integrand(value):
        return norm_pdf(value) * norm_cdf((second - correlation * value) / correlation_scale)

    total = integrand(lower) + integrand(upper)
    for index in range(1, intervals):
        total += (4.0 if index % 2 else 2.0) * integrand(lower + index * width)
    return min(max(total * width / 3.0, 0.0), 1.0)


def _bjerksund_2002_phi(spot, horizon, gamma, cap, trigger, rate, carry, vol):
    variance = vol * vol
    denominator = vol * math.sqrt(horizon)
    lam = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance
    kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0
    drift = (carry + (gamma - 0.5) * variance) * horizon
    d1 = -(math.log(spot / cap) + drift) / denominator
    d2 = d1 - 2.0 * math.log(trigger / spot) / denominator
    return math.exp(lam * horizon) * spot ** gamma * (norm_cdf(d1) - (trigger / spot) ** kappa * norm_cdf(d2))


def _bjerksund_2002_psi(spot, time, gamma, cap, first_boundary, second_boundary, split_time, rate, carry, vol):
    variance = vol * vol
    lam = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance
    kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0
    gamma_carry = carry + (gamma - 0.5) * variance
    short_scale = vol * math.sqrt(split_time)
    full_scale = vol * math.sqrt(time)
    short_drift = gamma_carry * split_time
    full_drift = gamma_carry * time
    correlation = math.sqrt(split_time / time)

    d1 = -(math.log(spot / second_boundary) + short_drift) / short_scale
    d2 = -(math.log(first_boundary ** 2 / (spot * second_boundary)) + short_drift) / short_scale
    d3 = -(math.log(spot / second_boundary) - short_drift) / short_scale
    d4 = -(math.log(first_boundary ** 2 / (spot * second_boundary)) - short_drift) / short_scale
    e1 = -(math.log(spot / cap) + full_drift) / full_scale
    e2 = -(math.log(first_boundary ** 2 / (spot * cap)) + full_drift) / full_scale
    e3 = -(math.log(second_boundary ** 2 / (spot * cap)) + full_drift) / full_scale
    e4 = -(math.log(spot * second_boundary ** 2 / (cap * first_boundary ** 2)) + full_drift) / full_scale

    value = (
        _bivariate_normal_cdf(d1, e1, correlation)
        - (first_boundary / spot) ** kappa * _bivariate_normal_cdf(d2, e2, correlation)
        - (second_boundary / spot) ** kappa * _bivariate_normal_cdf(d3, e3, -correlation)
        + (second_boundary / first_boundary) ** kappa * _bivariate_normal_cdf(d4, e4, -correlation)
    )
    return math.exp(lam * time) * spot ** gamma * value


def _bjerksund_2002_call(spot, strike, rate, div_yield, vol, time):
    european = _european(spot, strike, rate, div_yield, vol, time, CALL)
    intrinsic = max(spot - strike, 0.0)
    carry = rate - div_yield
    if vol == 0.0 or carry >= rate:
        return max(european, intrinsic)

    variance = vol * vol
    beta = 0.5 - carry / variance + math.sqrt((carry / variance - 0.5) ** 2 + 2.0 * rate / variance)
    if beta <= 1.0:
        return max(european, intrinsic)
    boundary_infinity = beta / (beta - 1.0) * strike
    boundary_zero = max(strike, rate / (rate - carry) * strike)

    def boundary(horizon):
        h = -(carry * horizon + 2.0 * vol * math.sqrt(horizon)) * (
            strike * strike / ((boundary_infinity - boundary_zero) * boundary_zero))
        return boundary_zero + (boundary_infinity - boundary_zero) * (1.0 - math.exp(h))

    split_time = 0.5 * (math.sqrt(5.0) - 1.0) * time
    first_boundary = boundary(time)
    second_boundary = boundary(time - split_time)
    if spot >= first_boundary:
        return intrinsic

    alpha_first = (first_boundary - strike) * first_boundary ** (-beta)
    alpha_second = (second_boundary - strike) * second_boundary ** (-beta)
    phi, psi = _bjerksund_2002_phi, _bjerksund_2002_psi
    value = (
        alpha_first * spot ** beta
        - alpha_first * phi(spot, split_time, beta, first_boundary, first_boundary, rate, carry, vol)
        + phi(spot, split_time, 1.0, first_boundary, first_boundary, rate, carry, vol)
        - phi(spot, split_time, 1.0, second_boundary, first_boundary, rate, carry, vol)
        - strike * phi(spot, split_time, 0.0, first_boundary, first_boundary, rate, carry, vol)
        + strike * phi(spot, split_time, 0.0, second_boundary, first_boundary, rate, carry, vol)
        + alpha_second * phi(spot, split_time, beta, second_boundary, first_boundary, rate, carry, vol)
        - alpha_second * psi(spot, time, beta, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol)
        + psi(spot, time, 1.0, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol)
        - psi(spot, time, 1.0, strike, first_boundary, second_boundary, split_time, rate, carry, vol)
        - strike * psi(spot, time, 0.0, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol)
        + strike * psi(spot, time, 0.0, strike, first_boundary, second_boundary, split_time, rate, carry, vol)
    )
    return max(value, european, intrinsic)


def bjerksund_2002_price(spot, strike, rate, div_yield, vol, time, option_type):
    is_call = option_type == CALL
    _validate_american(rate, div_yield)
    european = _european(spot, strike, rate, div_yield, vol, time, option_type)
    intrinsic = _intrinsic(spot, strike, is_call)
    value = (_bjerksund_2002_call(spot, strike, rate, div_yield, vol, time) if is_call
             else _bjerksund_2002_call(strike, spot, div_yield, rate, vol, time))
    return {"price": max(value, european, intrinsic)}


def run_bjerksund_2002(params: dict) -> dict:
    return bjerksund_2002_price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        vol=get_num(params, "vol", minimum=0.0),
        time=get_num(params, "time", minimum=0.0, strict_min=True),
        option_type=get_option_type(params),
    )


# ---------------------------------------------------------------------------
# Carr randomization (PSOR finite-difference on an Erlang-randomized
# exercise-date count, Richardson-extrapolated in the phase count)
# ---------------------------------------------------------------------------

def _payoff(terminal_spot, strike, is_call):
    return max((terminal_spot - strike) if is_call else (strike - terminal_spot), 0.0)


def _carr_randomization_core(spot, strike, rate, div_yield, vol, time, phases, is_call):
    grid_points = 501
    intrinsic = _payoff(spot, strike, is_call)
    if vol == 0.0:
        fwd = spot * math.exp((rate - div_yield) * time)
        return max(intrinsic, math.exp(-rate * time) * _payoff(fwd, strike, is_call))
    if is_call and div_yield == 0.0:
        return _european(spot, strike, rate, div_yield, vol, time, CALL)

    drift = rate - div_yield - 0.5 * vol * vol
    half_width = max(2.0, abs(math.log(strike / spot)) + 1.5,
                      5.0 * vol * math.sqrt(time) + abs(drift) * time)
    x_min = math.log(spot) - half_width
    dx = 2.0 * half_width / grid_points
    exercise = [_payoff(math.exp(x_min + i * dx), strike, is_call) for i in range(grid_points + 1)]
    previous = list(exercise)
    current = list(exercise)
    intensity = phases / time
    diffusion = 0.5 * vol * vol / (dx * dx)
    lower_generator = diffusion - drift / (2.0 * dx)
    upper_generator = diffusion + drift / (2.0 * dx)
    if lower_generator < 0.0 or upper_generator < 0.0:
        lower_generator = diffusion + max(-drift, 0.0) / dx
        upper_generator = diffusion + max(drift, 0.0) / dx
    lower = -lower_generator
    upper = -upper_generator
    diagonal = rate + intensity + lower_generator + upper_generator
    omega = 1.2

    for _ in range(phases):
        current = list(previous)
        current[0] = 0.0 if is_call else exercise[0]
        current[grid_points] = exercise[grid_points] if is_call else 0.0
        for _iteration in range(10000):
            max_change = 0.0
            for i in range(1, grid_points):
                continuation = (intensity * previous[i] - lower * current[i - 1] - upper * current[i + 1]) / diagonal
                relaxed = current[i] + omega * (continuation - current[i])
                updated = max(exercise[i], relaxed)
                max_change = max(max_change, abs(updated - current[i]))
                current[i] = updated
            if max_change < 1.0e-10:
                break
        previous, current = current, previous

    grid_position = (math.log(spot) - x_min) / dx
    left = min(max(int(math.floor(grid_position)), 0), grid_points - 1)
    weight = grid_position - left
    return previous[left] * (1.0 - weight) + previous[left + 1] * weight


def carr_randomization_price(spot, strike, rate, div_yield, vol, time, phases, option_type):
    is_call = option_type == CALL
    _validate_american(rate, div_yield)
    if not 4 <= phases <= 256:
        raise QKError("carr_randomization requires 4 <= phases <= 256")
    coarse = _carr_randomization_core(spot, strike, rate, div_yield, vol, time, phases, is_call)
    fine = _carr_randomization_core(spot, strike, rate, div_yield, vol, time, 2 * phases, is_call)
    extrapolated = 2.0 * fine - coarse
    lower = _payoff(spot, strike, is_call)
    upper = spot if is_call else strike
    return {"price": min(max(extrapolated, lower), upper)}


def run_carr_randomization(params: dict) -> dict:
    return carr_randomization_price(
        spot=get_num(params, "spot", minimum=0.0, strict_min=True),
        strike=get_num(params, "strike", minimum=0.0, strict_min=True),
        rate=get_num(params, "rate"),
        div_yield=get_num(params, "div_yield", default=0.0),
        vol=get_num(params, "vol", minimum=0.0),
        time=get_num(params, "time", minimum=0.0, strict_min=True),
        phases=get_int(params, "phases", default=32, minimum=4),
        option_type=get_option_type(params),
    )
