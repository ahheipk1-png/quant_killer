import math


MASK64 = (1 << 64) - 1
MULTIPLIER = 6364136223846793005
SQRT_TWO_PI = 2.5066282746310005
RQMC_REPLICATIONS = 8
A = (-39.69683028665376, 220.9460984245205, -275.9285104469687,
     138.3577518672690, -30.66479806614716, 2.506628277459239)
B = (-54.47609879822406, 161.5858368580409, -155.6989798598866,
     66.80131188771972, -13.28068155288572)
C = (-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
     -2.549732539343734, 4.374664141464968, 2.938163982698783)
D = (0.007784695709041462, 0.3224671290700398,
     2.445134137142996, 3.754408661907416)


class Pcg32:
    def __init__(self, seed: int, sequence: int = 1):
        self.state = 0
        self.increment = ((sequence << 1) | 1) & MASK64
        self.next_u32()
        self.state = (self.state + seed) & MASK64
        self.next_u32()

    def next_u32(self) -> int:
        old_state = self.state
        self.state = (old_state * MULTIPLIER + self.increment) & MASK64
        xorshifted = (((old_state >> 18) ^ old_state) >> 27) & 0xFFFFFFFF
        rotation = (old_state >> 59) & 31
        return ((xorshifted >> rotation) |
                (xorshifted << ((32 - rotation) & 31))) & 0xFFFFFFFF

    def next_uniform(self) -> float:
        return (self.next_u32() + 0.5) / 4294967296.0


def sobol_uint(index: int) -> int:
    gray = index ^ (index >> 1)
    value = 0
    for bit in range(32):
        if gray & (1 << bit):
            value ^= 1 << (31 - bit)
    return value & 0xFFFFFFFF


def sobol_uniform(index: int, digital_shift: int = 0) -> float:
    return ((sobol_uint(index) ^ digital_shift) + 0.5) / 4294967296.0


def normal_cdf(x: float) -> float:
    absolute_x = abs(x)
    if absolute_x > 37.0:
        tail = 0.0
    else:
        exponential = math.exp(-0.5 * absolute_x * absolute_x)
        if absolute_x < 7.07106781186547:
            numerator = 3.52624965998911e-02
            numerator = numerator * absolute_x + 0.700383064443688
            numerator = numerator * absolute_x + 6.37396220353165
            numerator = numerator * absolute_x + 33.912866078383
            numerator = numerator * absolute_x + 112.079291497871
            numerator = numerator * absolute_x + 221.213596169931
            numerator = numerator * absolute_x + 220.206867912376
            denominator = 8.83883476483184e-02
            denominator = denominator * absolute_x + 1.75566716318264
            denominator = denominator * absolute_x + 16.064177579207
            denominator = denominator * absolute_x + 86.7807322029461
            denominator = denominator * absolute_x + 296.564248779674
            denominator = denominator * absolute_x + 637.333633378831
            denominator = denominator * absolute_x + 793.826512519948
            denominator = denominator * absolute_x + 440.413735824752
            tail = exponential * numerator / denominator
        else:
            continued_fraction = absolute_x + 0.65
            continued_fraction = absolute_x + 4.0 / continued_fraction
            continued_fraction = absolute_x + 3.0 / continued_fraction
            continued_fraction = absolute_x + 2.0 / continued_fraction
            continued_fraction = absolute_x + 1.0 / continued_fraction
            tail = exponential / (continued_fraction * 2.506628274631)
    return 1.0 - tail if x > 0.0 else tail


def normal_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / SQRT_TWO_PI


def inverse_normal_cdf(probability: float) -> float:
    if probability < 0.02425:
        q = math.sqrt(-2.0 * math.log(probability))
        x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / (
            (((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    elif probability <= 0.97575:
        q = probability - 0.5
        r = q * q
        x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (
            ((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    else:
        q = math.sqrt(-2.0 * math.log(1.0 - probability))
        x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / (
            (((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    error = normal_cdf(x) - probability
    correction = error * SQRT_TWO_PI * math.exp(0.5 * x * x)
    return x - correction / (1.0 + 0.5 * x * correction)


def _validate_common(spot, strike, volatility, maturity):
    if spot <= 0.0 or strike <= 0.0 or volatility < 0.0 or maturity <= 0.0:
        raise ValueError("Invalid option inputs")


def _payoff(terminal_spot, strike, option_type):
    return (max(terminal_spot - strike, 0.0)
            if option_type == "call"
            else max(strike - terminal_spot, 0.0))


def price_option(
    spot,
    strike,
    rate,
    dividend_yield,
    volatility,
    maturity,
    paths,
    seed,
    option_type,
    sampling,
    variance_reduction,
):
    paths = int(paths)
    seed = int(seed)
    _validate_common(spot, strike, volatility, maturity)
    if paths < 2 or (sampling == "rqmc" and paths < RQMC_REPLICATIONS):
        raise ValueError("Invalid Monte Carlo inputs")

    use_antithetic = variance_reduction in ("antithetic", "antithetic-control")
    use_control = variance_reduction in ("control", "antithetic-control")
    replications = RQMC_REPLICATIONS if sampling == "rqmc" else 1
    discount = math.exp(-rate * maturity)
    drift = (rate - dividend_yield - 0.5 * volatility * volatility) * maturity
    diffusion = volatility * math.sqrt(maturity)
    expected_control = spot * math.exp(-dividend_yield * maturity)
    rng = Pcg32(seed)

    sum_x = sum_y = sum_x_squared = sum_y_squared = sum_xy = 0.0
    replication_x = [0.0] * replications
    replication_y = [0.0] * replications
    replication_counts = [0] * replications

    for replication in range(replications):
        local_paths = paths // replications + (1 if replication < paths % replications else 0)
        digital_shift = rng.next_u32() if sampling == "rqmc" else 0
        replication_counts[replication] = local_paths
        for path in range(local_paths):
            uniform = (rng.next_uniform() if sampling == "pcg"
                       else sobol_uniform(path + 1, digital_shift))
            z = inverse_normal_cdf(uniform)
            first_terminal = spot * math.exp(drift + diffusion * z)
            sample_x = discount * _payoff(first_terminal, strike, option_type)
            sample_y = discount * first_terminal
            if use_antithetic:
                second_terminal = spot * math.exp(drift - diffusion * z)
                sample_x = 0.5 * (sample_x + discount * _payoff(
                    second_terminal, strike, option_type))
                sample_y = 0.5 * (sample_y + discount * second_terminal)

            sum_x += sample_x
            sum_y += sample_y
            sum_x_squared += sample_x * sample_x
            sum_y_squared += sample_y * sample_y
            sum_xy += sample_x * sample_y
            replication_x[replication] += sample_x
            replication_y[replication] += sample_y

    path_count = float(paths)
    beta = 0.0
    if use_control:
        control_variation = sum_y_squared - sum_y * sum_y / path_count
        if control_variation > 1.0e-18:
            beta = (sum_xy - sum_x * sum_y / path_count) / control_variation

    sum_z = sum_x - beta * (sum_y - path_count * expected_control)
    sum_z_squared = (
        sum_x_squared
        + beta * beta * (sum_y_squared - 2.0 * expected_control * sum_y
                         + path_count * expected_control * expected_control)
        - 2.0 * beta * (sum_xy - expected_control * sum_x)
    )
    mean = sum_z / path_count
    variance = max((sum_z_squared - path_count * mean * mean) / (path_count - 1.0), 0.0)
    standard_deviation = math.sqrt(variance)

    if sampling == "rqmc":
        estimates = [
            replication_x[index] / replication_counts[index]
            - beta * (replication_y[index] / replication_counts[index] - expected_control)
            for index in range(replications)
        ]
        replication_mean = sum(estimates) / replications
        replication_variance = sum(
            (estimate - replication_mean) ** 2 for estimate in estimates
        ) / (replications - 1)
        standard_error = math.sqrt(replication_variance / replications)
    else:
        standard_error = standard_deviation / math.sqrt(path_count)
    return mean, standard_error, standard_deviation


def generate_distribution(
    spot,
    strike,
    rate,
    dividend_yield,
    volatility,
    maturity,
    sample_count,
    seed,
    option_type,
    sampling,
):
    _validate_common(spot, strike, volatility, maturity)
    sample_count = min(max(int(sample_count), 1), 5000)
    rng = Pcg32(int(seed))
    digital_shift = rng.next_u32() if sampling == "rqmc" else 0
    drift = (rate - dividend_yield - 0.5 * volatility * volatility) * maturity
    diffusion = volatility * math.sqrt(maturity)
    terminal_prices = [0.0] * sample_count
    payoffs = [0.0] * sample_count
    for index in range(sample_count):
        uniform = (rng.next_uniform() if sampling == "pcg"
                   else sobol_uniform(index + 1, digital_shift))
        terminal = spot * math.exp(drift + diffusion * inverse_normal_cdf(uniform))
        terminal_prices[index] = terminal
        payoffs[index] = _payoff(terminal, strike, option_type)
    return terminal_prices, payoffs


def _deterministic_price(spot, strike, rate, dividend_yield, maturity, option_type):
    terminal_spot = spot * math.exp((rate - dividend_yield) * maturity)
    return math.exp(-rate * maturity) * _payoff(terminal_spot, strike, option_type)


def black_scholes_price(
    spot, strike, rate, dividend_yield, volatility, maturity, option_type
):
    _validate_common(spot, strike, volatility, maturity)
    if volatility == 0.0:
        return _deterministic_price(spot, strike, rate, dividend_yield, maturity, option_type)
    root_t = math.sqrt(maturity)
    d1 = (math.log(spot / strike)
          + (rate - dividend_yield + 0.5 * volatility * volatility) * maturity) / (
              volatility * root_t)
    d2 = d1 - volatility * root_t
    discounted_spot = spot * math.exp(-dividend_yield * maturity)
    discounted_strike = strike * math.exp(-rate * maturity)
    if option_type == "call":
        return discounted_spot * normal_cdf(d1) - discounted_strike * normal_cdf(d2)
    return discounted_strike * normal_cdf(-d2) - discounted_spot * normal_cdf(-d1)


def binomial_price(
    spot, strike, rate, dividend_yield, volatility, maturity, steps, option_type
):
    _validate_common(spot, strike, volatility, maturity)
    steps = int(steps)
    if steps < 1 or steps > 2000:
        raise ValueError("Binomial steps must be between 1 and 2,000")
    if volatility == 0.0:
        return _deterministic_price(spot, strike, rate, dividend_yield, maturity, option_type)
    dt = maturity / steps
    up = math.exp(volatility * math.sqrt(dt))
    down = 1.0 / up
    probability = (math.exp((rate - dividend_yield) * dt) - down) / (up - down)
    if not 0.0 <= probability <= 1.0:
        raise ValueError("CRR probability is invalid; use more binomial steps")
    discount = math.exp(-rate * dt)
    up_over_down = up / down
    terminal_spot = spot * down**steps
    values = [0.0] * (steps + 1)
    for node in range(steps + 1):
        values[node] = _payoff(terminal_spot, strike, option_type)
        terminal_spot *= up_over_down
    for level in range(steps - 1, -1, -1):
        for node in range(level + 1):
            values[node] = discount * (
                probability * values[node + 1] + (1.0 - probability) * values[node])
    return values[0]


def american_binomial_price(
    spot, strike, rate, dividend_yield, volatility, maturity, steps, option_type
):
    _validate_common(spot, strike, volatility, maturity)
    steps = int(steps)
    if steps < 1 or steps > 2000:
        raise ValueError("Binomial steps must be between 1 and 2,000")
    if volatility == 0.0:
        european = _deterministic_price(
            spot, strike, rate, dividend_yield, maturity, option_type
        )
        return max(european, _payoff(spot, strike, option_type))

    dt = maturity / steps
    up = math.exp(volatility * math.sqrt(dt))
    down = 1.0 / up
    probability = (math.exp((rate - dividend_yield) * dt) - down) / (up - down)
    if not 0.0 <= probability <= 1.0:
        raise ValueError("CRR probability is invalid; use more binomial steps")
    discount = math.exp(-rate * dt)
    up_over_down = up / down
    terminal_spot = spot * down**steps
    values = [0.0] * (steps + 1)
    for node in range(steps + 1):
        values[node] = _payoff(terminal_spot, strike, option_type)
        terminal_spot *= up_over_down
    for level in range(steps - 1, -1, -1):
        node_spot = spot * down**level
        for node in range(level + 1):
            continuation = discount * (
                probability * values[node + 1] + (1.0 - probability) * values[node]
            )
            values[node] = max(
                continuation, _payoff(node_spot, strike, option_type)
            )
            node_spot *= up_over_down
    return values[0]


def _baw_critical_price(
    strike, rate, dividend_yield, volatility, maturity, option_type
):
    variance = volatility * volatility * maturity
    root_variance = math.sqrt(variance)
    risk_free_discount = math.exp(-rate * maturity)
    dividend_discount = math.exp(-dividend_yield * maturity)
    n = 2.0 * math.log(dividend_discount / risk_free_discount) / variance
    m = -2.0 * math.log(risk_free_discount) / variance
    carry_time = math.log(dividend_discount / risk_free_discount)

    if option_type == "call":
        q_upper = (-(n - 1.0) + math.sqrt((n - 1.0) ** 2 + 4.0 * m)) / 2.0
        upper = strike / (1.0 - 1.0 / q_upper)
        h = -(carry_time + 2.0 * root_variance) * strike / (upper - strike)
        boundary = strike + (upper - strike) * (1.0 - math.exp(h))
    else:
        q_upper = (-(n - 1.0) - math.sqrt((n - 1.0) ** 2 + 4.0 * m)) / 2.0
        upper = strike / (1.0 - 1.0 / q_upper)
        h = (carry_time - 2.0 * root_variance) * strike / (strike - upper)
        boundary = upper + (strike - upper) * math.exp(h)

    coefficient = (
        -2.0 * math.log(risk_free_discount)
        / (variance * (1.0 - risk_free_discount))
        if abs(1.0 - risk_free_discount) > 1.0e-12
        else 2.0 / variance
    )
    q_exponent = (
        (-(n - 1.0) + math.sqrt((n - 1.0) ** 2 + 4.0 * coefficient)) / 2.0
        if option_type == "call"
        else (-(n - 1.0) - math.sqrt((n - 1.0) ** 2 + 4.0 * coefficient)) / 2.0
    )

    for _ in range(100):
        forward_boundary = boundary * dividend_discount / risk_free_discount
        d1 = (
            math.log(forward_boundary / strike) + 0.5 * variance
        ) / root_variance
        european = black_scholes_price(
            boundary, strike, rate, dividend_yield, volatility, maturity, option_type
        )
        if option_type == "call":
            lhs = boundary - strike
            rhs = european + (
                1.0 - dividend_discount * normal_cdf(d1)
            ) * boundary / q_exponent
            slope = (
                dividend_discount * normal_cdf(d1) * (1.0 - 1.0 / q_exponent)
                + (1.0 - dividend_discount * normal_pdf(d1) / root_variance)
                / q_exponent
            )
            if abs(lhs - rhs) / strike <= 1.0e-8:
                break
            boundary = (strike + rhs - slope * boundary) / (1.0 - slope)
        else:
            lhs = strike - boundary
            rhs = european - (
                1.0 - dividend_discount * normal_cdf(-d1)
            ) * boundary / q_exponent
            slope = (
                -dividend_discount * normal_cdf(-d1) * (1.0 - 1.0 / q_exponent)
                - (1.0 + dividend_discount * normal_pdf(-d1) / root_variance)
                / q_exponent
            )
            if abs(lhs - rhs) / strike <= 1.0e-8:
                break
            boundary = (strike - rhs + slope * boundary) / (1.0 + slope)
    return boundary, q_exponent


def barone_adesi_whaley_price(
    spot, strike, rate, dividend_yield, volatility, maturity, option_type
):
    _validate_common(spot, strike, volatility, maturity)
    if rate < 0.0 or dividend_yield < 0.0:
        raise ValueError("BAW requires non-negative rates and dividend yield")
    european = black_scholes_price(
        spot, strike, rate, dividend_yield, volatility, maturity, option_type
    )
    intrinsic = _payoff(spot, strike, option_type)
    if volatility == 0.0:
        return max(european, intrinsic)
    if option_type == "call" and dividend_yield <= 0.0:
        return max(european, intrinsic)

    boundary, exponent = _baw_critical_price(
        strike, rate, dividend_yield, volatility, maturity, option_type
    )
    variance = volatility * volatility * maturity
    d1 = (
        math.log(
            boundary * math.exp((rate - dividend_yield) * maturity) / strike
        )
        + 0.5 * variance
    ) / math.sqrt(variance)
    dividend_discount = math.exp(-dividend_yield * maturity)
    if option_type == "call":
        coefficient = boundary / exponent * (
            1.0 - dividend_discount * normal_cdf(d1)
        )
        value = (
            european + coefficient * (spot / boundary) ** exponent
            if spot < boundary
            else intrinsic
        )
    else:
        coefficient = -boundary / exponent * (
            1.0 - dividend_discount * normal_cdf(-d1)
        )
        value = (
            european + coefficient * (spot / boundary) ** exponent
            if spot > boundary
            else intrinsic
        )
    return max(value, european, intrinsic)


def ju_zhong_price(
    spot, strike, rate, dividend_yield, volatility, maturity, option_type
):
    """Ju-Zhong (1999) quadratic early-exercise-premium approximation."""
    _validate_common(spot, strike, volatility, maturity)
    if rate < 0.0 or dividend_yield < 0.0:
        raise ValueError("Ju-Zhong requires non-negative rates and dividend yield")
    european = black_scholes_price(
        spot, strike, rate, dividend_yield, volatility, maturity, option_type
    )
    intrinsic = _payoff(spot, strike, option_type)
    if volatility == 0.0 or (option_type == "call" and dividend_yield <= 0.0):
        return max(european, intrinsic)
    if abs(rate) < 1.0e-9:
        return barone_adesi_whaley_price(
            spot, strike, rate, dividend_yield, volatility, maturity, option_type
        )
    boundary, _ = _baw_critical_price(
        strike, rate, dividend_yield, volatility, maturity, option_type
    )
    phi = 1.0 if option_type == "call" else -1.0
    variance_rate = volatility * volatility
    h = 1.0 - math.exp(-rate * maturity)
    alpha = 2.0 * rate / variance_rate
    beta = 2.0 * (rate - dividend_yield) / variance_rate
    radical = math.sqrt((beta - 1.0) ** 2 + 4.0 * alpha / h)
    exponent = (-(beta - 1.0) + phi * radical) / 2.0
    exponent_prime = -phi * alpha / (h * h * radical)
    european_boundary = black_scholes_price(
        boundary, strike, rate, dividend_yield, volatility, maturity, option_type
    )
    premium_boundary = phi * (boundary - strike) - european_boundary
    denominator = 2.0 * exponent + beta - 1.0
    if abs(premium_boundary) < 1.0e-12 or abs(denominator) < 1.0e-12:
        return barone_adesi_whaley_price(
            spot, strike, rate, dividend_yield, volatility, maturity, option_type
        )
    variance = variance_rate * maturity
    root_variance = math.sqrt(variance)
    risk_free_discount = math.exp(-rate * maturity)
    dividend_discount = math.exp(-dividend_yield * maturity)
    forward_boundary = boundary * dividend_discount / risk_free_discount
    d1 = (math.log(forward_boundary / strike) + 0.5 * variance) / root_variance
    d2 = d1 - root_variance
    derivative = forward_boundary * normal_pdf(d1) / (alpha * root_variance)
    derivative -= phi * forward_boundary * normal_cdf(phi * d1) * \
        math.log(dividend_discount) / math.log(risk_free_discount)
    derivative += phi * strike * normal_cdf(phi * d2)
    quadratic = (1.0 - h) * alpha * exponent_prime / (2.0 * denominator)
    linear = -(1.0 - h) * alpha / denominator * (
        derivative / premium_boundary + 1.0 / h + exponent_prime / denominator
    )
    log_ratio = math.log(spot / boundary)
    correction = quadratic * log_ratio * log_ratio + linear * log_ratio
    if not math.isfinite(correction) or abs(1.0 - correction) <= 1.0e-8:
        return barone_adesi_whaley_price(
            spot, strike, rate, dividend_yield, volatility, maturity, option_type
        )
    continuation = european + premium_boundary * (spot / boundary) ** exponent / (
        1.0 - correction
    )
    exercise = spot >= boundary if option_type == "call" else spot <= boundary
    value = intrinsic if exercise else continuation
    return max(value, european, intrinsic)


def _bjerksund_phi(spot, gamma, boundary, trigger, rate_time, carry_time, variance):
    root_variance = math.sqrt(variance)
    lambda_value = (
        -rate_time + gamma * carry_time
        + 0.5 * gamma * (gamma - 1.0) * variance
    )
    d = -(
        math.log(spot / boundary) + carry_time + (gamma - 0.5) * variance
    ) / root_variance
    kappa = 2.0 * carry_time / variance + 2.0 * gamma - 1.0
    return math.exp(lambda_value) * (
        normal_cdf(d)
        - (trigger / spot) ** kappa
        * normal_cdf(d - 2.0 * math.log(trigger / spot) / root_variance)
    )


def _bjerksund_call(spot, strike, risk_free_discount, dividend_discount, variance):
    rate_time = math.log(1.0 / risk_free_discount)
    carry_time = math.log(dividend_discount / risk_free_discount)
    volatility = math.sqrt(variance)
    maturity = 1.0
    rate = rate_time
    dividend_yield = rate_time - carry_time
    european = black_scholes_price(
        spot, strike, rate, dividend_yield, volatility, maturity, "call"
    )
    intrinsic = max(spot - strike, 0.0)
    if dividend_discount >= 1.0 and dividend_discount >= risk_free_discount:
        return max(european, intrinsic)

    beta = 0.5 - carry_time / variance + math.sqrt(
        (carry_time / variance - 0.5) ** 2 + 2.0 * rate_time / variance
    )
    if beta <= 1.0:
        return max(european, intrinsic)
    boundary_infinity = beta / (beta - 1.0) * strike
    boundary_zero = (
        strike
        if abs(carry_time - rate_time) < 1.0e-14
        else max(strike, rate_time / (rate_time - carry_time) * strike)
    )
    h = -(carry_time + 2.0 * math.sqrt(variance)) * boundary_zero / (
        boundary_infinity - boundary_zero
    )
    boundary = boundary_zero + (boundary_infinity - boundary_zero) * (
        1.0 - math.exp(h)
    )
    forward = spot * dividend_discount / risk_free_discount
    boundary_distance = math.log(boundary / forward) / math.sqrt(variance)
    if spot >= boundary:
        return intrinsic
    if boundary_distance > 12.5:
        return max(european, intrinsic)

    value = (
        (boundary - strike) * (spot / boundary) ** beta
        * (1.0 - _bjerksund_phi(
            spot, beta, boundary, boundary, rate_time, carry_time, variance
        ))
        + spot * _bjerksund_phi(
            spot, 1.0, boundary, boundary, rate_time, carry_time, variance
        )
        - spot * _bjerksund_phi(
            spot, 1.0, strike, boundary, rate_time, carry_time, variance
        )
        - strike * _bjerksund_phi(
            spot, 0.0, boundary, boundary, rate_time, carry_time, variance
        )
        + strike * _bjerksund_phi(
            spot, 0.0, strike, boundary, rate_time, carry_time, variance
        )
    )
    return max(value, european, intrinsic)


def bjerksund_stensland_price(
    spot, strike, rate, dividend_yield, volatility, maturity, option_type
):
    _validate_common(spot, strike, volatility, maturity)
    if rate < 0.0 or dividend_yield < 0.0:
        raise ValueError("Bjerksund-Stensland requires non-negative rates and yield")
    european = black_scholes_price(
        spot, strike, rate, dividend_yield, volatility, maturity, option_type
    )
    intrinsic = _payoff(spot, strike, option_type)
    if volatility == 0.0:
        return max(european, intrinsic)

    risk_free_discount = math.exp(-rate * maturity)
    dividend_discount = math.exp(-dividend_yield * maturity)
    variance = volatility * volatility * maturity
    if option_type == "call":
        value = _bjerksund_call(
            spot, strike, risk_free_discount, dividend_discount, variance
        )
    else:
        value = _bjerksund_call(
            strike, spot, dividend_discount, risk_free_discount, variance
        )
    return max(value, european, intrinsic)


def _bivariate_normal_cdf(first, second, correlation):
    """Standard bivariate normal CDF evaluated by fixed Simpson quadrature."""
    if first <= -10.0 or second <= -10.0:
        return 0.0
    if first >= 10.0:
        return normal_cdf(second)
    if second >= 10.0:
        return normal_cdf(first)
    if abs(correlation) < 1.0e-14:
        return normal_cdf(first) * normal_cdf(second)

    upper = min(first, 10.0)
    lower = -10.0
    intervals = 512
    width = (upper - lower) / intervals
    correlation_scale = math.sqrt(1.0 - correlation * correlation)

    def integrand(value):
        return normal_pdf(value) * normal_cdf(
            (second - correlation * value) / correlation_scale
        )

    total = integrand(lower) + integrand(upper)
    for index in range(1, intervals):
        total += (4.0 if index % 2 else 2.0) * integrand(lower + index * width)
    return min(max(total * width / 3.0, 0.0), 1.0)


def _bjerksund_2002_phi(spot, horizon, gamma, cap, trigger, rate, carry, volatility):
    variance = volatility * volatility
    root_time = math.sqrt(horizon)
    lambda_value = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance
    kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0
    denominator = volatility * root_time
    drift = (carry + (gamma - 0.5) * variance) * horizon
    d1 = -(math.log(spot / cap) + drift) / denominator
    d2 = d1 - 2.0 * math.log(trigger / spot) / denominator
    return math.exp(lambda_value * horizon) * spot**gamma * (
        normal_cdf(d1) - (trigger / spot) ** kappa * normal_cdf(d2)
    )


def _bjerksund_2002_psi(
    spot, maturity, gamma, cap, first_boundary, second_boundary,
    split_time, rate, carry, volatility
):
    variance = volatility * volatility
    lambda_value = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance
    kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0
    gamma_carry = carry + (gamma - 0.5) * variance
    short_scale = volatility * math.sqrt(split_time)
    full_scale = volatility * math.sqrt(maturity)
    short_drift = gamma_carry * split_time
    full_drift = gamma_carry * maturity
    correlation = math.sqrt(split_time / maturity)

    d1 = -(math.log(spot / second_boundary) + short_drift) / short_scale
    d2 = -(math.log(first_boundary * first_boundary / (spot * second_boundary))
           + short_drift) / short_scale
    d3 = -(math.log(spot / second_boundary) - short_drift) / short_scale
    d4 = -(math.log(first_boundary * first_boundary / (spot * second_boundary))
           - short_drift) / short_scale
    e1 = -(math.log(spot / cap) + full_drift) / full_scale
    e2 = -(math.log(first_boundary * first_boundary / (spot * cap))
           + full_drift) / full_scale
    e3 = -(math.log(second_boundary * second_boundary / (spot * cap))
           + full_drift) / full_scale
    e4 = -(math.log(spot * second_boundary * second_boundary /
                    (cap * first_boundary * first_boundary))
           + full_drift) / full_scale

    value = (
        _bivariate_normal_cdf(d1, e1, correlation)
        - (first_boundary / spot) ** kappa
        * _bivariate_normal_cdf(d2, e2, correlation)
        - (second_boundary / spot) ** kappa
        * _bivariate_normal_cdf(d3, e3, -correlation)
        + (second_boundary / first_boundary) ** kappa
        * _bivariate_normal_cdf(d4, e4, -correlation)
    )
    return math.exp(lambda_value * maturity) * spot**gamma * value


def _bjerksund_2002_call(
    spot, strike, rate, dividend_yield, volatility, maturity
):
    european = black_scholes_price(
        spot, strike, rate, dividend_yield, volatility, maturity, "call"
    )
    intrinsic = max(spot - strike, 0.0)
    carry = rate - dividend_yield
    if volatility == 0.0 or carry >= rate:
        return max(european, intrinsic)

    variance = volatility * volatility
    beta = 0.5 - carry / variance + math.sqrt(
        (carry / variance - 0.5) ** 2 + 2.0 * rate / variance
    )
    if beta <= 1.0:
        return max(european, intrinsic)
    boundary_infinity = beta / (beta - 1.0) * strike
    boundary_zero = max(strike, rate / (rate - carry) * strike)

    def boundary(horizon):
        h = -(carry * horizon + 2.0 * volatility * math.sqrt(horizon)) * (
            strike * strike / ((boundary_infinity - boundary_zero) * boundary_zero)
        )
        return boundary_zero + (boundary_infinity - boundary_zero) * (
            1.0 - math.exp(h)
        )

    split_time = 0.5 * (math.sqrt(5.0) - 1.0) * maturity
    first_boundary = boundary(maturity)
    second_boundary = boundary(maturity - split_time)
    if spot >= first_boundary:
        return intrinsic

    alpha_first = (first_boundary - strike) * first_boundary ** (-beta)
    alpha_second = (second_boundary - strike) * second_boundary ** (-beta)
    phi = _bjerksund_2002_phi
    psi = _bjerksund_2002_psi
    value = (
        alpha_first * spot**beta
        - alpha_first * phi(spot, split_time, beta, first_boundary,
                            first_boundary, rate, carry, volatility)
        + phi(spot, split_time, 1.0, first_boundary,
              first_boundary, rate, carry, volatility)
        - phi(spot, split_time, 1.0, second_boundary,
              first_boundary, rate, carry, volatility)
        - strike * phi(spot, split_time, 0.0, first_boundary,
                       first_boundary, rate, carry, volatility)
        + strike * phi(spot, split_time, 0.0, second_boundary,
                       first_boundary, rate, carry, volatility)
        + alpha_second * phi(spot, split_time, beta, second_boundary,
                             first_boundary, rate, carry, volatility)
        - alpha_second * psi(spot, maturity, beta, second_boundary,
                             first_boundary, second_boundary, split_time,
                             rate, carry, volatility)
        + psi(spot, maturity, 1.0, second_boundary, first_boundary,
              second_boundary, split_time, rate, carry, volatility)
        - psi(spot, maturity, 1.0, strike, first_boundary,
              second_boundary, split_time, rate, carry, volatility)
        - strike * psi(spot, maturity, 0.0, second_boundary,
                       first_boundary, second_boundary, split_time,
                       rate, carry, volatility)
        + strike * psi(spot, maturity, 0.0, strike, first_boundary,
                       second_boundary, split_time, rate, carry, volatility)
    )
    return max(value, european, intrinsic)


def bjerksund_stensland_2002_price(
    spot, strike, rate, dividend_yield, volatility, maturity, option_type
):
    _validate_common(spot, strike, volatility, maturity)
    if rate < 0.0 or dividend_yield < 0.0:
        raise ValueError("Bjerksund-Stensland requires non-negative rates and yield")
    european = black_scholes_price(
        spot, strike, rate, dividend_yield, volatility, maturity, option_type
    )
    intrinsic = _payoff(spot, strike, option_type)
    if option_type == "call":
        value = _bjerksund_2002_call(
            spot, strike, rate, dividend_yield, volatility, maturity
        )
    else:
        value = _bjerksund_2002_call(
            strike, spot, dividend_yield, rate, volatility, maturity
        )
    return max(value, european, intrinsic)


def _carr_randomization_core(
    spot, strike, rate, dividend_yield, volatility, maturity,
    phases, option_type, grid_points=501
):
    """Erlang-maturity resolvent recursion from Carr (1998)."""
    is_call = option_type == "call"
    intrinsic = _payoff(spot, strike, option_type)
    if volatility == 0.0:
        return max(intrinsic, _deterministic_price(
            spot, strike, rate, dividend_yield, maturity, option_type
        ))
    if is_call and dividend_yield == 0.0:
        return black_scholes_price(
            spot, strike, rate, dividend_yield, volatility, maturity, option_type
        )

    drift = rate - dividend_yield - 0.5 * volatility * volatility
    half_width = max(
        2.0,
        abs(math.log(strike / spot)) + 1.5,
        5.0 * volatility * math.sqrt(maturity) + abs(drift) * maturity,
    )
    x_center = math.log(spot)
    x_min = x_center - half_width
    dx = 2.0 * half_width / grid_points
    stock = [math.exp(x_min + index * dx) for index in range(grid_points + 1)]
    exercise = [_payoff(value, strike, option_type) for value in stock]
    previous = exercise.copy()
    intensity = phases / maturity
    diffusion = 0.5 * volatility * volatility / (dx * dx)
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
        current = previous.copy()
        current[0] = exercise[0] if not is_call else 0.0
        current[-1] = exercise[-1] if is_call else 0.0
        for _iteration in range(10000):
            maximum_change = 0.0
            for index in range(1, grid_points):
                continuation = (
                    intensity * previous[index]
                    - lower * current[index - 1]
                    - upper * current[index + 1]
                ) / diagonal
                relaxed = current[index] + omega * (continuation - current[index])
                updated = max(exercise[index], relaxed)
                maximum_change = max(maximum_change, abs(updated - current[index]))
                current[index] = updated
            if maximum_change < 1.0e-10:
                break
        previous = current

    position = (math.log(spot) - x_min) / dx
    left = min(max(int(math.floor(position)), 0), grid_points - 1)
    weight = position - left
    return previous[left] * (1.0 - weight) + previous[left + 1] * weight


def carr_randomization_price(
    spot, strike, rate, dividend_yield, volatility, maturity,
    phases, option_type
):
    """Carr maturity randomization with two-level Richardson extrapolation."""
    _validate_common(spot, strike, volatility, maturity)
    if rate < 0.0 or dividend_yield < 0.0:
        raise ValueError("Carr randomization requires non-negative rates and yield")
    phases = int(phases)
    if phases < 4 or phases > 256:
        raise ValueError("Carr randomization phases must be between 4 and 256")
    coarse = _carr_randomization_core(
        spot, strike, rate, dividend_yield, volatility, maturity,
        phases, option_type
    )
    fine = _carr_randomization_core(
        spot, strike, rate, dividend_yield, volatility, maturity,
        2 * phases, option_type
    )
    intrinsic = _payoff(spot, strike, option_type)
    upper_bound = spot if option_type == "call" else strike
    return min(max(2.0 * fine - coarse, intrinsic), upper_bound)
