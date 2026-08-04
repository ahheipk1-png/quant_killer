mod advanced;

const PCG_MULTIPLIER: u64 = 6_364_136_223_846_793_005;
const SQRT_TWO_PI: f64 = 2.506_628_274_631_000_5;
const MAX_BINOMIAL_STEPS: usize = 2000;
const MAX_DISTRIBUTION_SAMPLES: usize = 5000;
const RQMC_REPLICATIONS: usize = 8;

static mut LAST_STANDARD_ERROR: f64 = f64::NAN;
static mut LAST_STANDARD_DEVIATION: f64 = f64::NAN;
static mut DISTRIBUTION_TERMINAL: [f64; MAX_DISTRIBUTION_SAMPLES] =
    [0.0; MAX_DISTRIBUTION_SAMPLES];
static mut DISTRIBUTION_PAYOFF: [f64; MAX_DISTRIBUTION_SAMPLES] =
    [0.0; MAX_DISTRIBUTION_SAMPLES];
static mut DISTRIBUTION_COUNT: usize = 0;

struct Pcg32 {
    state: u64,
    increment: u64,
}

impl Pcg32 {
    fn new(seed: u64) -> Self {
        let mut rng = Self { state: 0, increment: 3 };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    fn next_u32(&mut self) -> u32 {
        let old_state = self.state;
        self.state = old_state
            .wrapping_mul(PCG_MULTIPLIER)
            .wrapping_add(self.increment);
        let xorshifted = (((old_state >> 18) ^ old_state) >> 27) as u32;
        let rotation = (old_state >> 59) as u32;
        xorshifted.rotate_right(rotation)
    }

    fn next_uniform(&mut self) -> f64 {
        (self.next_u32() as f64 + 0.5) / 4_294_967_296.0
    }
}

fn sobol_uint(index: u32) -> u32 {
    let gray = index ^ (index >> 1);
    let mut value = 0_u32;
    for bit in 0..32_u32 {
        if gray & (1_u32 << bit) != 0 {
            value ^= 1_u32 << (31 - bit);
        }
    }
    value
}

fn sobol_uniform(index: u32, digital_shift: u32) -> f64 {
    ((sobol_uint(index) ^ digital_shift) as f64 + 0.5) / 4_294_967_296.0
}

fn normal_cdf(x: f64) -> f64 {
    let absolute_x = x.abs();
    let tail = if absolute_x > 37.0 {
        0.0
    } else {
        let exponential = libm::exp(-0.5 * absolute_x * absolute_x);
        if absolute_x < 7.071_067_811_865_47 {
            let mut numerator = 3.526_249_659_989_11e-2;
            numerator = numerator * absolute_x + 0.700_383_064_443_688;
            numerator = numerator * absolute_x + 6.373_962_203_531_65;
            numerator = numerator * absolute_x + 33.912_866_078_383;
            numerator = numerator * absolute_x + 112.079_291_497_871;
            numerator = numerator * absolute_x + 221.213_596_169_931;
            numerator = numerator * absolute_x + 220.206_867_912_376;
            let mut denominator = 8.838_834_764_831_84e-2;
            denominator = denominator * absolute_x + 1.755_667_163_182_64;
            denominator = denominator * absolute_x + 16.064_177_579_207;
            denominator = denominator * absolute_x + 86.780_732_202_946_1;
            denominator = denominator * absolute_x + 296.564_248_779_674;
            denominator = denominator * absolute_x + 637.333_633_378_831;
            denominator = denominator * absolute_x + 793.826_512_519_948;
            denominator = denominator * absolute_x + 440.413_735_824_752;
            exponential * numerator / denominator
        } else {
            let mut continued_fraction = absolute_x + 0.65;
            continued_fraction = absolute_x + 4.0 / continued_fraction;
            continued_fraction = absolute_x + 3.0 / continued_fraction;
            continued_fraction = absolute_x + 2.0 / continued_fraction;
            continued_fraction = absolute_x + 1.0 / continued_fraction;
            exponential / (continued_fraction * 2.506_628_274_631)
        }
    };
    if x > 0.0 { 1.0 - tail } else { tail }
}

fn normal_pdf(x: f64) -> f64 {
    libm::exp(-0.5 * x * x) / SQRT_TWO_PI
}

fn inverse_normal_cdf(probability: f64) -> f64 {
    const A: [f64; 6] = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
        138.3577518672690, -30.66479806614716, 2.506628277459239];
    const B: [f64; 5] = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
        66.80131188771972, -13.28068155288572];
    const C: [f64; 6] = [-0.007784894002430293, -0.3223964580411365,
        -2.400758277161838, -2.549732539343734, 4.374664141464968,
        2.938163982698783];
    const D: [f64; 4] = [0.007784695709041462, 0.3224671290700398,
        2.445134137142996, 3.754408661907416];
    let x = if probability < 0.02425 {
        let q = libm::sqrt(-2.0 * libm::log(probability));
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if probability <= 0.97575 {
        let q = probability - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        let q = libm::sqrt(-2.0 * libm::log(1.0 - probability));
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    };
    let error = normal_cdf(x) - probability;
    let correction = error * SQRT_TWO_PI * libm::exp(0.5 * x * x);
    x - correction / (1.0 + 0.5 * x * correction)
}

fn valid_common_inputs(spot: f64, strike: f64, volatility: f64, maturity: f64) -> bool {
    spot > 0.0 && strike > 0.0 && volatility >= 0.0 && maturity > 0.0
}

fn payoff(terminal_spot: f64, strike: f64, is_call: bool) -> f64 {
    if is_call {
        (terminal_spot - strike).max(0.0)
    } else {
        (strike - terminal_spot).max(0.0)
    }
}

fn deterministic_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    maturity: f64,
    is_call: bool,
) -> f64 {
    let terminal_spot = spot * libm::exp((rate - dividend_yield) * maturity);
    libm::exp(-rate * maturity) * payoff(terminal_spot, strike, is_call)
}

fn max_three(first: f64, second: f64, third: f64) -> f64 {
    first.max(second).max(third)
}

fn black_scholes_internal(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: bool,
) -> f64 {
    if volatility == 0.0 {
        return deterministic_price(spot, strike, rate, dividend_yield, maturity, is_call);
    }
    let root_t = libm::sqrt(maturity);
    let d1 = (libm::log(spot / strike)
        + (rate - dividend_yield + 0.5 * volatility * volatility) * maturity)
        / (volatility * root_t);
    let d2 = d1 - volatility * root_t;
    let discounted_spot = spot * libm::exp(-dividend_yield * maturity);
    let discounted_strike = strike * libm::exp(-rate * maturity);
    if is_call {
        discounted_spot * normal_cdf(d1) - discounted_strike * normal_cdf(d2)
    } else {
        discounted_strike * normal_cdf(-d2) - discounted_spot * normal_cdf(-d1)
    }
}

fn baw_critical_price(
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: bool,
) -> (f64, f64) {
    let variance = volatility * volatility * maturity;
    let root_variance = libm::sqrt(variance);
    let risk_free_discount = libm::exp(-rate * maturity);
    let dividend_discount = libm::exp(-dividend_yield * maturity);
    let n = 2.0 * libm::log(dividend_discount / risk_free_discount) / variance;
    let m = -2.0 * libm::log(risk_free_discount) / variance;
    let carry_time = libm::log(dividend_discount / risk_free_discount);
    let upper_exponent;
    let upper;
    let mut boundary;
    if is_call {
        upper_exponent = (-(n - 1.0)
            + libm::sqrt((n - 1.0) * (n - 1.0) + 4.0 * m))
            / 2.0;
        upper = strike / (1.0 - 1.0 / upper_exponent);
        let h = -(carry_time + 2.0 * root_variance) * strike / (upper - strike);
        boundary = strike + (upper - strike) * (1.0 - libm::exp(h));
    } else {
        upper_exponent = (-(n - 1.0)
            - libm::sqrt((n - 1.0) * (n - 1.0) + 4.0 * m))
            / 2.0;
        upper = strike / (1.0 - 1.0 / upper_exponent);
        let h = (carry_time - 2.0 * root_variance) * strike / (strike - upper);
        boundary = upper + (strike - upper) * libm::exp(h);
    }
    let coefficient = if (1.0 - risk_free_discount).abs() > 1.0e-12 {
        -2.0 * libm::log(risk_free_discount)
            / (variance * (1.0 - risk_free_discount))
    } else {
        2.0 / variance
    };
    let exponent = if is_call {
        (-(n - 1.0) + libm::sqrt((n - 1.0) * (n - 1.0) + 4.0 * coefficient))
            / 2.0
    } else {
        (-(n - 1.0) - libm::sqrt((n - 1.0) * (n - 1.0) + 4.0 * coefficient))
            / 2.0
    };
    for _ in 0..100 {
        let forward_boundary = boundary * dividend_discount / risk_free_discount;
        let d1 = (libm::log(forward_boundary / strike) + 0.5 * variance) / root_variance;
        let european = black_scholes_internal(
            boundary,
            strike,
            rate,
            dividend_yield,
            volatility,
            maturity,
            is_call,
        );
        if is_call {
            let lhs = boundary - strike;
            let rhs = european
                + (1.0 - dividend_discount * normal_cdf(d1)) * boundary / exponent;
            let slope = dividend_discount * normal_cdf(d1) * (1.0 - 1.0 / exponent)
                + (1.0 - dividend_discount * normal_pdf(d1) / root_variance) / exponent;
            if (lhs - rhs).abs() / strike <= 1.0e-8 {
                break;
            }
            boundary = (strike + rhs - slope * boundary) / (1.0 - slope);
        } else {
            let lhs = strike - boundary;
            let rhs = european
                - (1.0 - dividend_discount * normal_cdf(-d1)) * boundary / exponent;
            let slope = -dividend_discount * normal_cdf(-d1) * (1.0 - 1.0 / exponent)
                - (1.0 + dividend_discount * normal_pdf(-d1) / root_variance) / exponent;
            if (lhs - rhs).abs() / strike <= 1.0e-8 {
                break;
            }
            boundary = (strike - rhs + slope * boundary) / (1.0 + slope);
        }
    }
    (boundary, exponent)
}

fn barone_adesi_whaley_internal(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: bool,
) -> f64 {
    let european = black_scholes_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call,
    );
    let intrinsic = payoff(spot, strike, is_call);
    if volatility == 0.0 || (is_call && dividend_yield <= 0.0) {
        return european.max(intrinsic);
    }
    let (boundary, exponent) = baw_critical_price(
        strike,
        rate,
        dividend_yield,
        volatility,
        maturity,
        is_call,
    );
    let variance = volatility * volatility * maturity;
    let d1 = (libm::log(
        boundary * libm::exp((rate - dividend_yield) * maturity) / strike,
    ) + 0.5 * variance)
        / libm::sqrt(variance);
    let dividend_discount = libm::exp(-dividend_yield * maturity);
    let value = if is_call {
        let coefficient = boundary / exponent * (1.0 - dividend_discount * normal_cdf(d1));
        if spot < boundary {
            european + coefficient * libm::pow(spot / boundary, exponent)
        } else {
            intrinsic
        }
    } else {
        let coefficient = -boundary / exponent * (1.0 - dividend_discount * normal_cdf(-d1));
        if spot > boundary {
            european + coefficient * libm::pow(spot / boundary, exponent)
        } else {
            intrinsic
        }
    };
    max_three(value, european, intrinsic)
}

fn ju_zhong_internal(
    spot: f64, strike: f64, rate: f64, dividend_yield: f64,
    volatility: f64, maturity: f64, is_call: bool,
) -> f64 {
    let european = black_scholes_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call,
    );
    let intrinsic = payoff(spot, strike, is_call);
    if volatility == 0.0 || (is_call && dividend_yield <= 0.0) {
        return european.max(intrinsic);
    }
    if rate.abs() < 1e-9 {
        return barone_adesi_whaley_internal(
            spot, strike, rate, dividend_yield, volatility, maturity, is_call,
        );
    }
    let (boundary, _) = baw_critical_price(
        strike, rate, dividend_yield, volatility, maturity, is_call,
    );
    let phi = if is_call { 1.0 } else { -1.0 };
    let variance = volatility * volatility * maturity;
    let root_variance = libm::sqrt(variance);
    let risk_free_discount = libm::exp(-rate * maturity);
    let dividend_discount = libm::exp(-dividend_yield * maturity);
    let h = 1.0 - risk_free_discount;
    let alpha = -2.0 * libm::log(risk_free_discount) / variance;
    let beta = 2.0 * libm::log(dividend_discount / risk_free_discount) / variance;
    let radical = libm::sqrt((beta - 1.0) * (beta - 1.0) + 4.0 * alpha / h);
    let exponent = (-(beta - 1.0) + phi * radical) / 2.0;
    let exponent_prime = -phi * alpha / (h * h * radical);
    let european_boundary = black_scholes_internal(
        boundary, strike, rate, dividend_yield, volatility, maturity, is_call,
    );
    let premium_boundary = phi * (boundary - strike) - european_boundary;
    let denominator = 2.0 * exponent + beta - 1.0;
    if premium_boundary.abs() < 1e-12 || denominator.abs() < 1e-12 {
        return barone_adesi_whaley_internal(
            spot, strike, rate, dividend_yield, volatility, maturity, is_call,
        );
    }
    let forward_boundary = boundary * dividend_discount / risk_free_discount;
    let d1 = (libm::log(forward_boundary / strike) + 0.5 * variance) / root_variance;
    let d2 = d1 - root_variance;
    let european_h = forward_boundary * normal_pdf(d1) / (alpha * root_variance)
        - phi * forward_boundary * normal_cdf(phi * d1)
            * libm::log(dividend_discount) / libm::log(risk_free_discount)
        + phi * strike * normal_cdf(phi * d2);
    let quadratic = (1.0 - h) * alpha * exponent_prime / (2.0 * denominator);
    let linear = -(1.0 - h) * alpha / denominator
        * (european_h / premium_boundary + 1.0 / h + exponent_prime / denominator);
    let log_ratio = libm::log(spot / boundary);
    let chi = log_ratio * (quadratic * log_ratio + linear);
    if !chi.is_finite() || (1.0 - chi).abs() <= 1e-8 {
        return barone_adesi_whaley_internal(
            spot, strike, rate, dividend_yield, volatility, maturity, is_call,
        );
    }
    let value = if phi * (boundary - spot) > 0.0 {
        european + premium_boundary * libm::pow(spot / boundary, exponent) / (1.0 - chi)
    } else {
        intrinsic
    };
    max_three(value, european, intrinsic)
}

fn bjerksund_phi(
    spot: f64,
    gamma: f64,
    boundary: f64,
    trigger: f64,
    rate_time: f64,
    carry_time: f64,
    variance: f64,
) -> f64 {
    let root_variance = libm::sqrt(variance);
    let lambda = -rate_time + gamma * carry_time
        + 0.5 * gamma * (gamma - 1.0) * variance;
    let d = -(libm::log(spot / boundary) + carry_time + (gamma - 0.5) * variance)
        / root_variance;
    let kappa = 2.0 * carry_time / variance + 2.0 * gamma - 1.0;
    libm::exp(lambda)
        * (normal_cdf(d)
            - libm::pow(trigger / spot, kappa)
                * normal_cdf(d - 2.0 * libm::log(trigger / spot) / root_variance))
}

fn bjerksund_call(
    spot: f64,
    strike: f64,
    risk_free_discount: f64,
    dividend_discount: f64,
    variance: f64,
) -> f64 {
    let rate_time = libm::log(1.0 / risk_free_discount);
    let carry_time = libm::log(dividend_discount / risk_free_discount);
    let european = black_scholes_internal(
        spot,
        strike,
        rate_time,
        rate_time - carry_time,
        libm::sqrt(variance),
        1.0,
        true,
    );
    let intrinsic = payoff(spot, strike, true);
    if dividend_discount >= 1.0 && dividend_discount >= risk_free_discount {
        return european.max(intrinsic);
    }
    let beta = 0.5 - carry_time / variance
        + libm::sqrt(
            (carry_time / variance - 0.5) * (carry_time / variance - 0.5)
                + 2.0 * rate_time / variance,
        );
    if beta <= 1.0 {
        return european.max(intrinsic);
    }
    let boundary_infinity = beta / (beta - 1.0) * strike;
    let boundary_zero = if (carry_time - rate_time).abs() < 1.0e-14 {
        strike
    } else {
        strike.max(rate_time / (rate_time - carry_time) * strike)
    };
    let h = -(carry_time + 2.0 * libm::sqrt(variance)) * boundary_zero
        / (boundary_infinity - boundary_zero);
    let boundary = boundary_zero
        + (boundary_infinity - boundary_zero) * (1.0 - libm::exp(h));
    let forward = spot * dividend_discount / risk_free_discount;
    if spot >= boundary {
        return intrinsic;
    }
    if libm::log(boundary / forward) / libm::sqrt(variance) > 12.5 {
        return european.max(intrinsic);
    }
    let value = (boundary - strike)
        * libm::pow(spot / boundary, beta)
        * (1.0 - bjerksund_phi(spot, beta, boundary, boundary, rate_time, carry_time, variance))
        + spot * bjerksund_phi(spot, 1.0, boundary, boundary, rate_time, carry_time, variance)
        - spot * bjerksund_phi(spot, 1.0, strike, boundary, rate_time, carry_time, variance)
        - strike * bjerksund_phi(spot, 0.0, boundary, boundary, rate_time, carry_time, variance)
        + strike * bjerksund_phi(spot, 0.0, strike, boundary, rate_time, carry_time, variance);
    max_three(value, european, intrinsic)
}

fn bjerksund_stensland_internal(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: bool,
) -> f64 {
    let european = black_scholes_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call,
    );
    let intrinsic = payoff(spot, strike, is_call);
    if volatility == 0.0 {
        return european.max(intrinsic);
    }
    let risk_free_discount = libm::exp(-rate * maturity);
    let dividend_discount = libm::exp(-dividend_yield * maturity);
    let variance = volatility * volatility * maturity;
    let value = if is_call {
        bjerksund_call(
            spot,
            strike,
            risk_free_discount,
            dividend_discount,
            variance,
        )
    } else {
        bjerksund_call(
            strike,
            spot,
            dividend_discount,
            risk_free_discount,
            variance,
        )
    };
    max_three(value, european, intrinsic)
}

fn bivariate_normal_cdf(first: f64, second: f64, correlation: f64) -> f64 {
    if first <= -10.0 || second <= -10.0 {
        return 0.0;
    }
    if first >= 10.0 {
        return normal_cdf(second);
    }
    if second >= 10.0 {
        return normal_cdf(first);
    }
    if correlation.abs() < 1.0e-14 {
        return normal_cdf(first) * normal_cdf(second);
    }
    let intervals = 512;
    let lower = -10.0;
    let upper = first.min(10.0);
    let width = (upper - lower) / intervals as f64;
    let correlation_scale = libm::sqrt(1.0 - correlation * correlation);
    let integrand = |value: f64| {
        normal_pdf(value)
            * normal_cdf((second - correlation * value) / correlation_scale)
    };
    let mut total = integrand(lower) + integrand(upper);
    for index in 1..intervals {
        total += (if index % 2 == 0 { 2.0 } else { 4.0 })
            * integrand(lower + index as f64 * width);
    }
    (total * width / 3.0).max(0.0).min(1.0)
}

fn bjerksund_2002_phi(
    spot: f64,
    horizon: f64,
    gamma: f64,
    cap: f64,
    trigger: f64,
    rate: f64,
    carry: f64,
    volatility: f64,
) -> f64 {
    let variance = volatility * volatility;
    let denominator = volatility * libm::sqrt(horizon);
    let lambda = -rate + gamma * carry +
        0.5 * gamma * (gamma - 1.0) * variance;
    let kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
    let drift = (carry + (gamma - 0.5) * variance) * horizon;
    let d1 = -(libm::log(spot / cap) + drift) / denominator;
    let d2 = d1 - 2.0 * libm::log(trigger / spot) / denominator;
    libm::exp(lambda * horizon) * libm::pow(spot, gamma)
        * (normal_cdf(d1) - libm::pow(trigger / spot, kappa) * normal_cdf(d2))
}

fn bjerksund_2002_psi(
    spot: f64,
    maturity: f64,
    gamma: f64,
    cap: f64,
    first_boundary: f64,
    second_boundary: f64,
    split_time: f64,
    rate: f64,
    carry: f64,
    volatility: f64,
) -> f64 {
    let variance = volatility * volatility;
    let lambda = -rate + gamma * carry +
        0.5 * gamma * (gamma - 1.0) * variance;
    let kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
    let gamma_carry = carry + (gamma - 0.5) * variance;
    let short_scale = volatility * libm::sqrt(split_time);
    let full_scale = volatility * libm::sqrt(maturity);
    let short_drift = gamma_carry * split_time;
    let full_drift = gamma_carry * maturity;
    let correlation = libm::sqrt(split_time / maturity);
    let d1 = -(libm::log(spot / second_boundary) + short_drift) / short_scale;
    let d2 = -(libm::log(
        first_boundary * first_boundary / (spot * second_boundary),
    ) + short_drift) / short_scale;
    let d3 = -(libm::log(spot / second_boundary) - short_drift) / short_scale;
    let d4 = -(libm::log(
        first_boundary * first_boundary / (spot * second_boundary),
    ) - short_drift) / short_scale;
    let e1 = -(libm::log(spot / cap) + full_drift) / full_scale;
    let e2 = -(libm::log(first_boundary * first_boundary / (spot * cap))
        + full_drift) / full_scale;
    let e3 = -(libm::log(second_boundary * second_boundary / (spot * cap))
        + full_drift) / full_scale;
    let e4 = -(libm::log(
        spot * second_boundary * second_boundary /
            (cap * first_boundary * first_boundary),
    ) + full_drift) / full_scale;
    let value = bivariate_normal_cdf(d1, e1, correlation)
        - libm::pow(first_boundary / spot, kappa)
            * bivariate_normal_cdf(d2, e2, correlation)
        - libm::pow(second_boundary / spot, kappa)
            * bivariate_normal_cdf(d3, e3, -correlation)
        + libm::pow(second_boundary / first_boundary, kappa)
            * bivariate_normal_cdf(d4, e4, -correlation);
    libm::exp(lambda * maturity) * libm::pow(spot, gamma) * value
}

fn bjerksund_2002_call(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
) -> f64 {
    let european = black_scholes_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, true,
    );
    let intrinsic = payoff(spot, strike, true);
    let carry = rate - dividend_yield;
    if volatility == 0.0 || carry >= rate {
        return european.max(intrinsic);
    }
    let variance = volatility * volatility;
    let beta = 0.5 - carry / variance
        + libm::sqrt(
            (carry / variance - 0.5) * (carry / variance - 0.5)
                + 2.0 * rate / variance,
        );
    if beta <= 1.0 {
        return european.max(intrinsic);
    }
    let boundary_infinity = beta / (beta - 1.0) * strike;
    let boundary_zero = strike.max(rate / (rate - carry) * strike);
    let boundary = |horizon: f64| {
        let h = -(carry * horizon + 2.0 * volatility * libm::sqrt(horizon))
            * strike * strike
            / ((boundary_infinity - boundary_zero) * boundary_zero);
        boundary_zero + (boundary_infinity - boundary_zero) * (1.0 - libm::exp(h))
    };
    let split_time = 0.5 * (libm::sqrt(5.0) - 1.0) * maturity;
    let first_boundary = boundary(maturity);
    let second_boundary = boundary(maturity - split_time);
    if spot >= first_boundary {
        return intrinsic;
    }
    let alpha_first = (first_boundary - strike) * libm::pow(first_boundary, -beta);
    let alpha_second = (second_boundary - strike) * libm::pow(second_boundary, -beta);
    let value = alpha_first * libm::pow(spot, beta)
        - alpha_first * bjerksund_2002_phi(
            spot, split_time, beta, first_boundary, first_boundary,
            rate, carry, volatility,
        )
        + bjerksund_2002_phi(
            spot, split_time, 1.0, first_boundary, first_boundary,
            rate, carry, volatility,
        )
        - bjerksund_2002_phi(
            spot, split_time, 1.0, second_boundary, first_boundary,
            rate, carry, volatility,
        )
        - strike * bjerksund_2002_phi(
            spot, split_time, 0.0, first_boundary, first_boundary,
            rate, carry, volatility,
        )
        + strike * bjerksund_2002_phi(
            spot, split_time, 0.0, second_boundary, first_boundary,
            rate, carry, volatility,
        )
        + alpha_second * bjerksund_2002_phi(
            spot, split_time, beta, second_boundary, first_boundary,
            rate, carry, volatility,
        )
        - alpha_second * bjerksund_2002_psi(
            spot, maturity, beta, second_boundary, first_boundary,
            second_boundary, split_time, rate, carry, volatility,
        )
        + bjerksund_2002_psi(
            spot, maturity, 1.0, second_boundary, first_boundary,
            second_boundary, split_time, rate, carry, volatility,
        )
        - bjerksund_2002_psi(
            spot, maturity, 1.0, strike, first_boundary,
            second_boundary, split_time, rate, carry, volatility,
        )
        - strike * bjerksund_2002_psi(
            spot, maturity, 0.0, second_boundary, first_boundary,
            second_boundary, split_time, rate, carry, volatility,
        )
        + strike * bjerksund_2002_psi(
            spot, maturity, 0.0, strike, first_boundary,
            second_boundary, split_time, rate, carry, volatility,
        );
    max_three(value, european, intrinsic)
}

fn bjerksund_stensland_2002_internal(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: bool,
) -> f64 {
    let european = black_scholes_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call,
    );
    let intrinsic = payoff(spot, strike, is_call);
    let value = if is_call {
        bjerksund_2002_call(
            spot, strike, rate, dividend_yield, volatility, maturity,
        )
    } else {
        bjerksund_2002_call(
            strike, spot, dividend_yield, rate, volatility, maturity,
        )
    };
    max_three(value, european, intrinsic)
}

#[no_mangle]
pub extern "C" fn qk_mc_european_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    paths: i32,
    seed: u32,
    is_call: i32,
    sampling_mode: i32,
    variance_mode: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || paths < 2
        || !(0..=2).contains(&sampling_mode)
        || !(0..=3).contains(&variance_mode)
        || (sampling_mode == 2 && paths < RQMC_REPLICATIONS as i32)
    {
        unsafe {
            LAST_STANDARD_ERROR = f64::NAN;
            LAST_STANDARD_DEVIATION = f64::NAN;
        }
        return f64::NAN;
    }

    let use_antithetic = variance_mode == 1 || variance_mode == 3;
    let use_control = variance_mode == 2 || variance_mode == 3;
    let replications = if sampling_mode == 2 { RQMC_REPLICATIONS } else { 1 };
    let discount = libm::exp(-rate * maturity);
    let drift = (rate - dividend_yield - 0.5 * volatility * volatility) * maturity;
    let diffusion = volatility * libm::sqrt(maturity);
    let expected_control = spot * libm::exp(-dividend_yield * maturity);
    let mut rng = Pcg32::new(seed as u64);

    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let mut sum_x_squared = 0.0;
    let mut sum_y_squared = 0.0;
    let mut sum_xy = 0.0;
    let mut replication_x = [0.0_f64; RQMC_REPLICATIONS];
    let mut replication_y = [0.0_f64; RQMC_REPLICATIONS];
    let mut replication_counts = [0_i32; RQMC_REPLICATIONS];

    for replication in 0..replications {
        let local_paths = paths / replications as i32
            + if replication < paths as usize % replications { 1 } else { 0 };
        let digital_shift = if sampling_mode == 2 { rng.next_u32() } else { 0 };
        replication_counts[replication] = local_paths;
        for path in 0..local_paths {
            let uniform = if sampling_mode == 0 {
                rng.next_uniform()
            } else {
                sobol_uniform(path as u32 + 1, digital_shift)
            };
            let z = inverse_normal_cdf(uniform);
            let first_terminal = spot * libm::exp(drift + diffusion * z);
            let mut sample_x = discount * payoff(first_terminal, strike, is_call != 0);
            let mut sample_y = discount * first_terminal;
            if use_antithetic {
                let second_terminal = spot * libm::exp(drift - diffusion * z);
                sample_x = 0.5
                    * (sample_x + discount * payoff(second_terminal, strike, is_call != 0));
                sample_y = 0.5 * (sample_y + discount * second_terminal);
            }
            sum_x += sample_x;
            sum_y += sample_y;
            sum_x_squared += sample_x * sample_x;
            sum_y_squared += sample_y * sample_y;
            sum_xy += sample_x * sample_y;
            replication_x[replication] += sample_x;
            replication_y[replication] += sample_y;
        }
    }

    let path_count = paths as f64;
    let mut beta = 0.0;
    if use_control {
        let control_variation = sum_y_squared - sum_y * sum_y / path_count;
        if control_variation > 1.0e-18 {
            beta = (sum_xy - sum_x * sum_y / path_count) / control_variation;
        }
    }
    let sum_z = sum_x - beta * (sum_y - path_count * expected_control);
    let sum_z_squared = sum_x_squared
        + beta * beta
            * (sum_y_squared - 2.0 * expected_control * sum_y
                + path_count * expected_control * expected_control)
        - 2.0 * beta * (sum_xy - expected_control * sum_x);
    let mean = sum_z / path_count;
    let variance = ((sum_z_squared - path_count * mean * mean) / (path_count - 1.0)).max(0.0);
    let standard_deviation = libm::sqrt(variance);

    let standard_error = if sampling_mode == 2 {
        let mut estimates = [0.0_f64; RQMC_REPLICATIONS];
        let mut replication_mean = 0.0;
        for replication in 0..replications {
            let count = replication_counts[replication] as f64;
            estimates[replication] = replication_x[replication] / count
                - beta * (replication_y[replication] / count - expected_control);
            replication_mean += estimates[replication];
        }
        replication_mean /= replications as f64;
        let mut replication_variance = 0.0;
        for estimate in estimates.iter().take(replications) {
            let difference = *estimate - replication_mean;
            replication_variance += difference * difference;
        }
        replication_variance /= (replications - 1) as f64;
        libm::sqrt(replication_variance / replications as f64)
    } else {
        standard_deviation / libm::sqrt(path_count)
    };
    unsafe {
        LAST_STANDARD_ERROR = standard_error;
        LAST_STANDARD_DEVIATION = standard_deviation;
    }
    mean
}

#[no_mangle]
pub extern "C" fn qk_mc_last_std_error() -> f64 {
    unsafe { LAST_STANDARD_ERROR }
}

#[no_mangle]
pub extern "C" fn qk_mc_last_std_dev() -> f64 {
    unsafe { LAST_STANDARD_DEVIATION }
}

#[no_mangle]
pub extern "C" fn qk_mc_generate_distribution(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    sample_count: i32,
    seed: u32,
    is_call: i32,
    sampling_mode: i32,
) -> i32 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || sample_count < 1
        || !(0..=2).contains(&sampling_mode)
    {
        unsafe { DISTRIBUTION_COUNT = 0 };
        return 0;
    }
    let count = (sample_count as usize).min(MAX_DISTRIBUTION_SAMPLES);
    let mut rng = Pcg32::new(seed as u64);
    let digital_shift = if sampling_mode == 2 { rng.next_u32() } else { 0 };
    let drift = (rate - dividend_yield - 0.5 * volatility * volatility) * maturity;
    let diffusion = volatility * libm::sqrt(maturity);
    for index in 0..count {
        let uniform = if sampling_mode == 0 {
            rng.next_uniform()
        } else {
            sobol_uniform(index as u32 + 1, digital_shift)
        };
        let terminal = spot * libm::exp(drift + diffusion * inverse_normal_cdf(uniform));
        unsafe {
            DISTRIBUTION_TERMINAL[index] = terminal;
            DISTRIBUTION_PAYOFF[index] = payoff(terminal, strike, is_call != 0);
        }
    }
    unsafe { DISTRIBUTION_COUNT = count };
    count as i32
}

#[no_mangle]
pub extern "C" fn qk_mc_distribution_terminal(index: i32) -> f64 {
    if index < 0 || index as usize >= unsafe { DISTRIBUTION_COUNT } {
        return f64::NAN;
    }
    unsafe { DISTRIBUTION_TERMINAL[index as usize] }
}

#[no_mangle]
pub extern "C" fn qk_mc_distribution_payoff(index: i32) -> f64 {
    if index < 0 || index as usize >= unsafe { DISTRIBUTION_COUNT } {
        return f64::NAN;
    }
    unsafe { DISTRIBUTION_PAYOFF[index as usize] }
}

#[no_mangle]
pub extern "C" fn qk_bs_european_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity) {
        return f64::NAN;
    }
    if volatility == 0.0 {
        return deterministic_price(spot, strike, rate, dividend_yield, maturity, is_call != 0);
    }
    let root_t = libm::sqrt(maturity);
    let d1 = (libm::log(spot / strike)
        + (rate - dividend_yield + 0.5 * volatility * volatility) * maturity)
        / (volatility * root_t);
    let d2 = d1 - volatility * root_t;
    let discounted_spot = spot * libm::exp(-dividend_yield * maturity);
    let discounted_strike = strike * libm::exp(-rate * maturity);
    if is_call != 0 {
        discounted_spot * normal_cdf(d1) - discounted_strike * normal_cdf(d2)
    } else {
        discounted_strike * normal_cdf(-d2) - discounted_spot * normal_cdf(-d1)
    }
}

#[no_mangle]
pub extern "C" fn qk_baw_american_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || rate < 0.0
        || dividend_yield < 0.0
    {
        return f64::NAN;
    }
    barone_adesi_whaley_internal(
        spot,
        strike,
        rate,
        dividend_yield,
        volatility,
        maturity,
        is_call != 0,
    )
}

#[no_mangle]
pub extern "C" fn qk_ju_american_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || rate < 0.0
        || dividend_yield < 0.0
    {
        return f64::NAN;
    }
    ju_zhong_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call != 0,
    )
}

fn carr_randomization_core(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    phases: usize,
    is_call: bool,
) -> f64 {
    const GRID_POINTS: usize = 501;
    let intrinsic = payoff(spot, strike, is_call);
    if volatility == 0.0 {
        return intrinsic.max(deterministic_price(
            spot, strike, rate, dividend_yield, maturity, is_call,
        ));
    }
    if is_call && dividend_yield == 0.0 {
        return black_scholes_internal(
            spot, strike, rate, dividend_yield, volatility, maturity, true,
        );
    }
    let drift = rate - dividend_yield - 0.5 * volatility * volatility;
    let half_width = 2.0_f64
        .max(libm::fabs(libm::log(strike / spot)) + 1.5)
        .max(5.0 * volatility * libm::sqrt(maturity) + libm::fabs(drift) * maturity);
    let x_min = libm::log(spot) - half_width;
    let dx = 2.0 * half_width / GRID_POINTS as f64;
    let mut exercise = vec![0.0_f64; GRID_POINTS + 1];
    for (index, value) in exercise.iter_mut().enumerate() {
        *value = payoff(libm::exp(x_min + index as f64 * dx), strike, is_call);
    }
    let mut previous = exercise.clone();
    let mut current = exercise.clone();
    let intensity = phases as f64 / maturity;
    let diffusion = 0.5 * volatility * volatility / (dx * dx);
    let mut lower_generator = diffusion - drift / (2.0 * dx);
    let mut upper_generator = diffusion + drift / (2.0 * dx);
    if lower_generator < 0.0 || upper_generator < 0.0 {
        lower_generator = diffusion + (-drift).max(0.0) / dx;
        upper_generator = diffusion + drift.max(0.0) / dx;
    }
    let lower = -lower_generator;
    let upper = -upper_generator;
    let diagonal = rate + intensity + lower_generator + upper_generator;
    for _phase in 0..phases {
        current.copy_from_slice(&previous);
        current[0] = if is_call { 0.0 } else { exercise[0] };
        current[GRID_POINTS] = if is_call { exercise[GRID_POINTS] } else { 0.0 };
        for _iteration in 0..10000 {
            let mut maximum_change = 0.0_f64;
            for index in 1..GRID_POINTS {
                let continuation = (intensity * previous[index]
                    - lower * current[index - 1]
                    - upper * current[index + 1])
                    / diagonal;
                let relaxed = current[index] + 1.2 * (continuation - current[index]);
                let updated = exercise[index].max(relaxed);
                maximum_change = maximum_change.max(libm::fabs(updated - current[index]));
                current[index] = updated;
            }
            if maximum_change < 1.0e-10 {
                break;
            }
        }
        core::mem::swap(&mut previous, &mut current);
    }
    let grid_position = (libm::log(spot) - x_min) / dx;
    let left = (libm::floor(grid_position) as usize).min(GRID_POINTS - 1);
    let weight = grid_position - left as f64;
    previous[left] * (1.0 - weight) + previous[left + 1] * weight
}

#[no_mangle]
pub extern "C" fn qk_carr_randomization_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    phases: i32,
    is_call: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || rate < 0.0
        || dividend_yield < 0.0
        || !(4..=256).contains(&phases)
    {
        return f64::NAN;
    }
    let call = is_call != 0;
    let coarse = carr_randomization_core(
        spot, strike, rate, dividend_yield, volatility, maturity, phases as usize, call,
    );
    let fine = carr_randomization_core(
        spot, strike, rate, dividend_yield, volatility, maturity, 2 * phases as usize, call,
    );
    (2.0 * fine - coarse).clamp(payoff(spot, strike, call), if call { spot } else { strike })
}

#[no_mangle]
pub extern "C" fn qk_bjerksund_american_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || rate < 0.0
        || dividend_yield < 0.0
    {
        return f64::NAN;
    }
    bjerksund_stensland_internal(
        spot,
        strike,
        rate,
        dividend_yield,
        volatility,
        maturity,
        is_call != 0,
    )
}

#[no_mangle]
pub extern "C" fn qk_bjerksund_2002_american_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    is_call: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || rate < 0.0
        || dividend_yield < 0.0
    {
        return f64::NAN;
    }
    bjerksund_stensland_2002_internal(
        spot,
        strike,
        rate,
        dividend_yield,
        volatility,
        maturity,
        is_call != 0,
    )
}

#[no_mangle]
pub extern "C" fn qk_binomial_european_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    steps: i32,
    is_call: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || steps < 1
        || steps as usize > MAX_BINOMIAL_STEPS
    {
        return f64::NAN;
    }
    if volatility == 0.0 {
        return deterministic_price(spot, strike, rate, dividend_yield, maturity, is_call != 0);
    }
    let step_count = steps as usize;
    let dt = maturity / steps as f64;
    let up = libm::exp(volatility * libm::sqrt(dt));
    let down = 1.0 / up;
    let probability = (libm::exp((rate - dividend_yield) * dt) - down) / (up - down);
    if !(0.0..=1.0).contains(&probability) {
        return f64::NAN;
    }
    let discount = libm::exp(-rate * dt);
    let up_over_down = up / down;
    let mut terminal_spot = spot * libm::pow(down, steps as f64);
    let mut values = [0.0_f64; MAX_BINOMIAL_STEPS + 1];
    for value in values.iter_mut().take(step_count + 1) {
        *value = payoff(terminal_spot, strike, is_call != 0);
        terminal_spot *= up_over_down;
    }
    for level in (0..step_count).rev() {
        for node in 0..=level {
            values[node] = discount
                * (probability * values[node + 1] + (1.0 - probability) * values[node]);
        }
    }
    values[0]
}

#[no_mangle]
pub extern "C" fn qk_binomial_american_price(
    spot: f64,
    strike: f64,
    rate: f64,
    dividend_yield: f64,
    volatility: f64,
    maturity: f64,
    steps: i32,
    is_call: i32,
) -> f64 {
    if !valid_common_inputs(spot, strike, volatility, maturity)
        || steps < 1
        || steps as usize > MAX_BINOMIAL_STEPS
    {
        return f64::NAN;
    }
    let intrinsic = payoff(spot, strike, is_call != 0);
    if volatility == 0.0 {
        return intrinsic.max(deterministic_price(
            spot,
            strike,
            rate,
            dividend_yield,
            maturity,
            is_call != 0,
        ));
    }
    let step_count = steps as usize;
    let dt = maturity / steps as f64;
    let up = libm::exp(volatility * libm::sqrt(dt));
    let down = 1.0 / up;
    let probability = (libm::exp((rate - dividend_yield) * dt) - down) / (up - down);
    if !(0.0..=1.0).contains(&probability) {
        return f64::NAN;
    }
    let discount = libm::exp(-rate * dt);
    let up_over_down = up / down;
    let mut terminal_spot = spot * libm::pow(down, steps as f64);
    let mut values = [0.0_f64; MAX_BINOMIAL_STEPS + 1];
    for value in values.iter_mut().take(step_count + 1) {
        *value = payoff(terminal_spot, strike, is_call != 0);
        terminal_spot *= up_over_down;
    }
    for level in (0..step_count).rev() {
        let mut node_spot = spot * libm::pow(down, level as f64);
        for node in 0..=level {
            let continuation = discount
                * (probability * values[node + 1] + (1.0 - probability) * values[node]);
            values[node] = continuation.max(payoff(node_spot, strike, is_call != 0));
            node_spot *= up_over_down;
        }
    }
    values[0]
}
