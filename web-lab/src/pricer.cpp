#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define QK_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define QK_EXPORT
#endif

namespace {

constexpr std::uint64_t kPcgMultiplier = 6364136223846793005ULL;
constexpr double kInvUint32Range = 1.0 / 4294967296.0;
constexpr double kSqrtTwoPi = 2.5066282746310005;
constexpr int kRqmcReplications = 8;
constexpr int kMaxDistributionSamples = 5000;

double last_standard_error = std::numeric_limits<double>::quiet_NaN();
double last_standard_deviation = std::numeric_limits<double>::quiet_NaN();
std::array<double, kMaxDistributionSamples> distribution_terminal{};
std::array<double, kMaxDistributionSamples> distribution_payoff{};
int distribution_count = 0;

class Pcg32 {
public:
    explicit Pcg32(std::uint64_t seed, std::uint64_t sequence = 1ULL)
        : state_(0ULL), increment_((sequence << 1U) | 1ULL) {
        next_u32();
        state_ += seed;
        next_u32();
    }

    std::uint32_t next_u32() {
        const std::uint64_t old_state = state_;
        state_ = old_state * kPcgMultiplier + increment_;
        const auto xorshifted = static_cast<std::uint32_t>(
            ((old_state >> 18U) ^ old_state) >> 27U);
        const auto rotation = static_cast<std::uint32_t>(old_state >> 59U);
        return (xorshifted >> rotation) |
               (xorshifted << ((32U - rotation) & 31U));
    }

    double next_uniform() {
        return (static_cast<double>(next_u32()) + 0.5) * kInvUint32Range;
    }

private:
    std::uint64_t state_;
    std::uint64_t increment_;
};

std::uint32_t sobol_uint(std::uint32_t index) {
    const std::uint32_t gray = index ^ (index >> 1U);
    std::uint32_t value = 0U;
    for (std::uint32_t bit = 0U; bit < 32U; ++bit) {
        if ((gray & (1U << bit)) != 0U) {
            value ^= 1U << (31U - bit);
        }
    }
    return value;
}

double sobol_uniform(std::uint32_t index, std::uint32_t digital_shift) {
    return (static_cast<double>(sobol_uint(index) ^ digital_shift) + 0.5) *
           kInvUint32Range;
}

double normal_cdf(double x) {
    const double absolute_x = std::fabs(x);
    double tail;
    if (absolute_x > 37.0) {
        tail = 0.0;
    } else {
        const double exponential = std::exp(-0.5 * absolute_x * absolute_x);
        if (absolute_x < 7.07106781186547) {
            double numerator = 3.52624965998911e-02;
            numerator = numerator * absolute_x + 0.700383064443688;
            numerator = numerator * absolute_x + 6.37396220353165;
            numerator = numerator * absolute_x + 33.912866078383;
            numerator = numerator * absolute_x + 112.079291497871;
            numerator = numerator * absolute_x + 221.213596169931;
            numerator = numerator * absolute_x + 220.206867912376;
            double denominator = 8.83883476483184e-02;
            denominator = denominator * absolute_x + 1.75566716318264;
            denominator = denominator * absolute_x + 16.064177579207;
            denominator = denominator * absolute_x + 86.7807322029461;
            denominator = denominator * absolute_x + 296.564248779674;
            denominator = denominator * absolute_x + 637.333633378831;
            denominator = denominator * absolute_x + 793.826512519948;
            denominator = denominator * absolute_x + 440.413735824752;
            tail = exponential * numerator / denominator;
        } else {
            double continued_fraction = absolute_x + 0.65;
            continued_fraction = absolute_x + 4.0 / continued_fraction;
            continued_fraction = absolute_x + 3.0 / continued_fraction;
            continued_fraction = absolute_x + 2.0 / continued_fraction;
            continued_fraction = absolute_x + 1.0 / continued_fraction;
            tail = exponential / (continued_fraction * 2.506628274631);
        }
    }
    return x > 0.0 ? 1.0 - tail : tail;
}

double normal_pdf(double x) {
    return std::exp(-0.5 * x * x) / kSqrtTwoPi;
}

double inverse_normal_cdf(double probability) {
    constexpr std::array<double, 6> a = {
        -3.969683028665376e+01, 2.209460984245205e+02,
        -2.759285104469687e+02, 1.383577518672690e+02,
        -3.066479806614716e+01, 2.506628277459239e+00};
    constexpr std::array<double, 5> b = {
        -5.447609879822406e+01, 1.615858368580409e+02,
        -1.556989798598866e+02, 6.680131188771972e+01,
        -1.328068155288572e+01};
    constexpr std::array<double, 6> c = {
        -7.784894002430293e-03, -3.223964580411365e-01,
        -2.400758277161838e+00, -2.549732539343734e+00,
        4.374664141464968e+00, 2.938163982698783e+00};
    constexpr std::array<double, 4> d = {
        7.784695709041462e-03, 3.224671290700398e-01,
        2.445134137142996e+00, 3.754408661907416e+00};

    double x;
    if (probability < 0.02425) {
        const double q = std::sqrt(-2.0 * std::log(probability));
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    } else if (probability <= 0.97575) {
        const double q = probability - 0.5;
        const double r = q * q;
        x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
    } else {
        const double q = std::sqrt(-2.0 * std::log(1.0 - probability));
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    }

    const double error = normal_cdf(x) - probability;
    const double correction = error * kSqrtTwoPi * std::exp(0.5 * x * x);
    return x - correction / (1.0 + 0.5 * x * correction);
}

double payoff(double terminal_spot, double strike, bool is_call) {
    const double intrinsic = is_call ? terminal_spot - strike : strike - terminal_spot;
    return intrinsic > 0.0 ? intrinsic : 0.0;
}

bool valid_common_inputs(double spot, double strike, double volatility, double maturity) {
    return spot > 0.0 && strike > 0.0 && volatility >= 0.0 && maturity > 0.0;
}

double deterministic_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double maturity,
    bool is_call) {
    const double terminal_spot = spot * std::exp((rate - dividend_yield) * maturity);
    return std::exp(-rate * maturity) * payoff(terminal_spot, strike, is_call);
}

double black_scholes_price_internal(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    bool is_call) {
    if (volatility == 0.0) {
        return deterministic_price(
            spot, strike, rate, dividend_yield, maturity, is_call);
    }
    const double root_t = std::sqrt(maturity);
    const double d1 =
        (std::log(spot / strike) +
         (rate - dividend_yield + 0.5 * volatility * volatility) * maturity) /
        (volatility * root_t);
    const double d2 = d1 - volatility * root_t;
    const double discounted_spot = spot * std::exp(-dividend_yield * maturity);
    const double discounted_strike = strike * std::exp(-rate * maturity);
    return is_call
        ? discounted_spot * normal_cdf(d1) - discounted_strike * normal_cdf(d2)
        : discounted_strike * normal_cdf(-d2) - discounted_spot * normal_cdf(-d1);
}

double baw_critical_price(
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    bool is_call,
    double& exponent) {
    const double variance = volatility * volatility * maturity;
    const double root_variance = std::sqrt(variance);
    const double risk_free_discount = std::exp(-rate * maturity);
    const double dividend_discount = std::exp(-dividend_yield * maturity);
    const double n = 2.0 * std::log(dividend_discount / risk_free_discount) / variance;
    const double m = -2.0 * std::log(risk_free_discount) / variance;
    const double carry_time = std::log(dividend_discount / risk_free_discount);

    double upper_exponent;
    double upper;
    double boundary;
    if (is_call) {
        upper_exponent =
            (-(n - 1.0) + std::sqrt((n - 1.0) * (n - 1.0) + 4.0 * m)) / 2.0;
        upper = strike / (1.0 - 1.0 / upper_exponent);
        const double h = -(carry_time + 2.0 * root_variance) * strike /
                         (upper - strike);
        boundary = strike + (upper - strike) * (1.0 - std::exp(h));
    } else {
        upper_exponent =
            (-(n - 1.0) - std::sqrt((n - 1.0) * (n - 1.0) + 4.0 * m)) / 2.0;
        upper = strike / (1.0 - 1.0 / upper_exponent);
        const double h = (carry_time - 2.0 * root_variance) * strike /
                         (strike - upper);
        boundary = upper + (strike - upper) * std::exp(h);
    }

    const double coefficient = std::fabs(1.0 - risk_free_discount) > 1.0e-12
        ? -2.0 * std::log(risk_free_discount) /
              (variance * (1.0 - risk_free_discount))
        : 2.0 / variance;
    exponent = is_call
        ? (-(n - 1.0) + std::sqrt((n - 1.0) * (n - 1.0) + 4.0 * coefficient)) / 2.0
        : (-(n - 1.0) - std::sqrt((n - 1.0) * (n - 1.0) + 4.0 * coefficient)) / 2.0;

    for (int iteration = 0; iteration < 100; ++iteration) {
        const double forward_boundary =
            boundary * dividend_discount / risk_free_discount;
        const double d1 =
            (std::log(forward_boundary / strike) + 0.5 * variance) /
            root_variance;
        const double european = black_scholes_price_internal(
            boundary, strike, rate, dividend_yield, volatility, maturity, is_call);
        double lhs;
        double rhs;
        double slope;
        if (is_call) {
            lhs = boundary - strike;
            rhs = european + (1.0 - dividend_discount * normal_cdf(d1)) *
                  boundary / exponent;
            slope = dividend_discount * normal_cdf(d1) * (1.0 - 1.0 / exponent) +
                    (1.0 - dividend_discount * normal_pdf(d1) / root_variance) /
                        exponent;
            if (std::fabs(lhs - rhs) / strike <= 1.0e-8) break;
            boundary = (strike + rhs - slope * boundary) / (1.0 - slope);
        } else {
            lhs = strike - boundary;
            rhs = european - (1.0 - dividend_discount * normal_cdf(-d1)) *
                  boundary / exponent;
            slope = -dividend_discount * normal_cdf(-d1) *
                        (1.0 - 1.0 / exponent) -
                    (1.0 + dividend_discount * normal_pdf(-d1) / root_variance) /
                        exponent;
            if (std::fabs(lhs - rhs) / strike <= 1.0e-8) break;
            boundary = (strike - rhs + slope * boundary) / (1.0 + slope);
        }
    }
    return boundary;
}

double barone_adesi_whaley_price_internal(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    bool is_call) {
    const double european = black_scholes_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call);
    const double intrinsic = payoff(spot, strike, is_call);
    if (volatility == 0.0 || (is_call && dividend_yield <= 0.0)) {
        return std::max(european, intrinsic);
    }
    double exponent = 0.0;
    const double boundary = baw_critical_price(
        strike, rate, dividend_yield, volatility, maturity, is_call, exponent);
    const double variance = volatility * volatility * maturity;
    const double d1 =
        (std::log(boundary * std::exp((rate - dividend_yield) * maturity) /
                  strike) +
         0.5 * variance) /
        std::sqrt(variance);
    const double dividend_discount = std::exp(-dividend_yield * maturity);
    double value;
    if (is_call) {
        const double coefficient = boundary / exponent *
            (1.0 - dividend_discount * normal_cdf(d1));
        value = spot < boundary
            ? european + coefficient * std::pow(spot / boundary, exponent)
            : intrinsic;
    } else {
        const double coefficient = -boundary / exponent *
            (1.0 - dividend_discount * normal_cdf(-d1));
        value = spot > boundary
            ? european + coefficient * std::pow(spot / boundary, exponent)
            : intrinsic;
    }
    return std::max({value, european, intrinsic});
}

double ju_zhong_price_internal(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    bool is_call) {
    const double european = black_scholes_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call);
    const double intrinsic = payoff(spot, strike, is_call);
    if (volatility == 0.0 || (is_call && dividend_yield <= 0.0))
        return std::max(european, intrinsic);
    if (std::fabs(rate) < 1e-9)
        return barone_adesi_whaley_price_internal(
            spot, strike, rate, dividend_yield, volatility, maturity, is_call);
    double unused_exponent = 0.0;
    const double boundary = baw_critical_price(
        strike, rate, dividend_yield, volatility, maturity, is_call, unused_exponent);
    const double phi = is_call ? 1.0 : -1.0;
    const double variance_rate = volatility * volatility;
    const double variance = variance_rate * maturity;
    const double root_variance = std::sqrt(variance);
    const double risk_free_discount = std::exp(-rate * maturity);
    const double dividend_discount = std::exp(-dividend_yield * maturity);
    const double h = 1.0 - risk_free_discount;
    const double alpha = -2.0 * std::log(risk_free_discount) / variance;
    const double beta = 2.0 * std::log(dividend_discount / risk_free_discount) / variance;
    const double radical = std::sqrt((beta - 1.0) * (beta - 1.0) + 4.0 * alpha / h);
    const double exponent = (-(beta - 1.0) + phi * radical) / 2.0;
    const double exponent_prime = -phi * alpha / (h * h * radical);
    const double european_boundary = black_scholes_price_internal(
        boundary, strike, rate, dividend_yield, volatility, maturity, is_call);
    const double premium_boundary = phi * (boundary - strike) - european_boundary;
    const double denominator = 2.0 * exponent + beta - 1.0;
    if (std::fabs(premium_boundary) < 1e-12 || std::fabs(denominator) < 1e-12)
        return barone_adesi_whaley_price_internal(
            spot, strike, rate, dividend_yield, volatility, maturity, is_call);
    const double forward_boundary = boundary * dividend_discount / risk_free_discount;
    const double d1 = (std::log(forward_boundary / strike) + 0.5 * variance) / root_variance;
    const double d2 = d1 - root_variance;
    const double european_h = forward_boundary * normal_pdf(d1) / (alpha * root_variance) -
        phi * forward_boundary * normal_cdf(phi * d1) *
            std::log(dividend_discount) / std::log(risk_free_discount) +
        phi * strike * normal_cdf(phi * d2);
    const double quadratic = (1.0 - h) * alpha * exponent_prime / (2.0 * denominator);
    const double linear = -(1.0 - h) * alpha / denominator *
        (european_h / premium_boundary + 1.0 / h + exponent_prime / denominator);
    const double log_ratio = std::log(spot / boundary);
    const double chi = log_ratio * (quadratic * log_ratio + linear);
    if (!std::isfinite(chi) || std::fabs(1.0 - chi) <= 1e-8)
        return barone_adesi_whaley_price_internal(
            spot, strike, rate, dividend_yield, volatility, maturity, is_call);
    const bool continuation_region = phi * (boundary - spot) > 0.0;
    const double value = continuation_region
        ? european + premium_boundary * std::pow(spot / boundary, exponent) / (1.0 - chi)
        : intrinsic;
    return std::max({value, european, intrinsic});
}

double bjerksund_phi(
    double spot,
    double gamma,
    double boundary,
    double trigger,
    double rate_time,
    double carry_time,
    double variance) {
    const double root_variance = std::sqrt(variance);
    const double lambda = -rate_time + gamma * carry_time +
        0.5 * gamma * (gamma - 1.0) * variance;
    const double d =
        -(std::log(spot / boundary) + carry_time +
          (gamma - 0.5) * variance) /
        root_variance;
    const double kappa = 2.0 * carry_time / variance + 2.0 * gamma - 1.0;
    return std::exp(lambda) *
        (normal_cdf(d) - std::pow(trigger / spot, kappa) *
             normal_cdf(d - 2.0 * std::log(trigger / spot) / root_variance));
}

double bjerksund_call(
    double spot,
    double strike,
    double risk_free_discount,
    double dividend_discount,
    double variance) {
    const double rate_time = std::log(1.0 / risk_free_discount);
    const double carry_time = std::log(dividend_discount / risk_free_discount);
    const double european = black_scholes_price_internal(
        spot, strike, rate_time, rate_time - carry_time,
        std::sqrt(variance), 1.0, true);
    const double intrinsic = payoff(spot, strike, true);
    if (dividend_discount >= 1.0 && dividend_discount >= risk_free_discount) {
        return std::max(european, intrinsic);
    }
    const double beta = 0.5 - carry_time / variance +
        std::sqrt(std::pow(carry_time / variance - 0.5, 2.0) +
                  2.0 * rate_time / variance);
    if (beta <= 1.0) return std::max(european, intrinsic);
    const double boundary_infinity = beta / (beta - 1.0) * strike;
    const double boundary_zero = std::fabs(carry_time - rate_time) < 1.0e-14
        ? strike
        : std::max(strike, rate_time / (rate_time - carry_time) * strike);
    const double h = -(carry_time + 2.0 * std::sqrt(variance)) * boundary_zero /
                     (boundary_infinity - boundary_zero);
    const double boundary = boundary_zero +
        (boundary_infinity - boundary_zero) * (1.0 - std::exp(h));
    const double forward = spot * dividend_discount / risk_free_discount;
    if (spot >= boundary) return intrinsic;
    if (std::log(boundary / forward) / std::sqrt(variance) > 12.5) {
        return std::max(european, intrinsic);
    }
    const double value =
        (boundary - strike) * std::pow(spot / boundary, beta) *
            (1.0 - bjerksund_phi(
                spot, beta, boundary, boundary, rate_time, carry_time, variance)) +
        spot * bjerksund_phi(
            spot, 1.0, boundary, boundary, rate_time, carry_time, variance) -
        spot * bjerksund_phi(
            spot, 1.0, strike, boundary, rate_time, carry_time, variance) -
        strike * bjerksund_phi(
            spot, 0.0, boundary, boundary, rate_time, carry_time, variance) +
        strike * bjerksund_phi(
            spot, 0.0, strike, boundary, rate_time, carry_time, variance);
    return std::max({value, european, intrinsic});
}

double bjerksund_stensland_price_internal(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    bool is_call) {
    const double european = black_scholes_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call);
    const double intrinsic = payoff(spot, strike, is_call);
    if (volatility == 0.0) return std::max(european, intrinsic);
    const double risk_free_discount = std::exp(-rate * maturity);
    const double dividend_discount = std::exp(-dividend_yield * maturity);
    const double variance = volatility * volatility * maturity;
    const double value = is_call
        ? bjerksund_call(
            spot, strike, risk_free_discount, dividend_discount, variance)
        : bjerksund_call(
            strike, spot, dividend_discount, risk_free_discount, variance);
    return std::max({value, european, intrinsic});
}

double bivariate_normal_cdf(double first, double second, double correlation) {
    if (first <= -10.0 || second <= -10.0) return 0.0;
    if (first >= 10.0) return normal_cdf(second);
    if (second >= 10.0) return normal_cdf(first);
    if (std::fabs(correlation) < 1.0e-14) {
        return normal_cdf(first) * normal_cdf(second);
    }
    constexpr int intervals = 512;
    const double lower = -10.0;
    const double upper = std::min(first, 10.0);
    const double width = (upper - lower) / intervals;
    const double correlation_scale = std::sqrt(1.0 - correlation * correlation);
    const auto integrand = [&](double value) {
        return normal_pdf(value) *
            normal_cdf((second - correlation * value) / correlation_scale);
    };
    double total = integrand(lower) + integrand(upper);
    for (int index = 1; index < intervals; ++index) {
        total += (index % 2 == 0 ? 2.0 : 4.0) *
            integrand(lower + index * width);
    }
    return std::min(std::max(total * width / 3.0, 0.0), 1.0);
}

double bjerksund_2002_phi(
    double spot,
    double horizon,
    double gamma,
    double cap,
    double trigger,
    double rate,
    double carry,
    double volatility) {
    const double variance = volatility * volatility;
    const double denominator = volatility * std::sqrt(horizon);
    const double lambda = -rate + gamma * carry +
        0.5 * gamma * (gamma - 1.0) * variance;
    const double kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
    const double drift = (carry + (gamma - 0.5) * variance) * horizon;
    const double d1 = -(std::log(spot / cap) + drift) / denominator;
    const double d2 = d1 - 2.0 * std::log(trigger / spot) / denominator;
    return std::exp(lambda * horizon) * std::pow(spot, gamma) *
        (normal_cdf(d1) - std::pow(trigger / spot, kappa) * normal_cdf(d2));
}

double bjerksund_2002_psi(
    double spot,
    double maturity,
    double gamma,
    double cap,
    double first_boundary,
    double second_boundary,
    double split_time,
    double rate,
    double carry,
    double volatility) {
    const double variance = volatility * volatility;
    const double lambda = -rate + gamma * carry +
        0.5 * gamma * (gamma - 1.0) * variance;
    const double kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
    const double gamma_carry = carry + (gamma - 0.5) * variance;
    const double short_scale = volatility * std::sqrt(split_time);
    const double full_scale = volatility * std::sqrt(maturity);
    const double short_drift = gamma_carry * split_time;
    const double full_drift = gamma_carry * maturity;
    const double correlation = std::sqrt(split_time / maturity);
    const double d1 =
        -(std::log(spot / second_boundary) + short_drift) / short_scale;
    const double d2 =
        -(std::log(first_boundary * first_boundary /
                   (spot * second_boundary)) + short_drift) / short_scale;
    const double d3 =
        -(std::log(spot / second_boundary) - short_drift) / short_scale;
    const double d4 =
        -(std::log(first_boundary * first_boundary /
                   (spot * second_boundary)) - short_drift) / short_scale;
    const double e1 = -(std::log(spot / cap) + full_drift) / full_scale;
    const double e2 =
        -(std::log(first_boundary * first_boundary / (spot * cap)) +
          full_drift) / full_scale;
    const double e3 =
        -(std::log(second_boundary * second_boundary / (spot * cap)) +
          full_drift) / full_scale;
    const double e4 =
        -(std::log(spot * second_boundary * second_boundary /
                   (cap * first_boundary * first_boundary)) +
          full_drift) / full_scale;
    const double value =
        bivariate_normal_cdf(d1, e1, correlation) -
        std::pow(first_boundary / spot, kappa) *
            bivariate_normal_cdf(d2, e2, correlation) -
        std::pow(second_boundary / spot, kappa) *
            bivariate_normal_cdf(d3, e3, -correlation) +
        std::pow(second_boundary / first_boundary, kappa) *
            bivariate_normal_cdf(d4, e4, -correlation);
    return std::exp(lambda * maturity) * std::pow(spot, gamma) * value;
}

double bjerksund_2002_call(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity) {
    const double european = black_scholes_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, true);
    const double intrinsic = payoff(spot, strike, true);
    const double carry = rate - dividend_yield;
    if (volatility == 0.0 || carry >= rate) {
        return std::max(european, intrinsic);
    }
    const double variance = volatility * volatility;
    const double beta = 0.5 - carry / variance +
        std::sqrt(std::pow(carry / variance - 0.5, 2.0) +
                  2.0 * rate / variance);
    if (beta <= 1.0) return std::max(european, intrinsic);
    const double boundary_infinity = beta / (beta - 1.0) * strike;
    const double boundary_zero =
        std::max(strike, rate / (rate - carry) * strike);
    const auto boundary = [&](double horizon) {
        const double h =
            -(carry * horizon + 2.0 * volatility * std::sqrt(horizon)) *
            strike * strike /
            ((boundary_infinity - boundary_zero) * boundary_zero);
        return boundary_zero + (boundary_infinity - boundary_zero) *
            (1.0 - std::exp(h));
    };
    const double split_time = 0.5 * (std::sqrt(5.0) - 1.0) * maturity;
    const double first_boundary = boundary(maturity);
    const double second_boundary = boundary(maturity - split_time);
    if (spot >= first_boundary) return intrinsic;
    const double alpha_first =
        (first_boundary - strike) * std::pow(first_boundary, -beta);
    const double alpha_second =
        (second_boundary - strike) * std::pow(second_boundary, -beta);
    const double value =
        alpha_first * std::pow(spot, beta) -
        alpha_first * bjerksund_2002_phi(
            spot, split_time, beta, first_boundary, first_boundary,
            rate, carry, volatility) +
        bjerksund_2002_phi(
            spot, split_time, 1.0, first_boundary, first_boundary,
            rate, carry, volatility) -
        bjerksund_2002_phi(
            spot, split_time, 1.0, second_boundary, first_boundary,
            rate, carry, volatility) -
        strike * bjerksund_2002_phi(
            spot, split_time, 0.0, first_boundary, first_boundary,
            rate, carry, volatility) +
        strike * bjerksund_2002_phi(
            spot, split_time, 0.0, second_boundary, first_boundary,
            rate, carry, volatility) +
        alpha_second * bjerksund_2002_phi(
            spot, split_time, beta, second_boundary, first_boundary,
            rate, carry, volatility) -
        alpha_second * bjerksund_2002_psi(
            spot, maturity, beta, second_boundary, first_boundary,
            second_boundary, split_time, rate, carry, volatility) +
        bjerksund_2002_psi(
            spot, maturity, 1.0, second_boundary, first_boundary,
            second_boundary, split_time, rate, carry, volatility) -
        bjerksund_2002_psi(
            spot, maturity, 1.0, strike, first_boundary,
            second_boundary, split_time, rate, carry, volatility) -
        strike * bjerksund_2002_psi(
            spot, maturity, 0.0, second_boundary, first_boundary,
            second_boundary, split_time, rate, carry, volatility) +
        strike * bjerksund_2002_psi(
            spot, maturity, 0.0, strike, first_boundary,
            second_boundary, split_time, rate, carry, volatility);
    return std::max({value, european, intrinsic});
}

double bjerksund_stensland_2002_price_internal(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    bool is_call) {
    const double european = black_scholes_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call);
    const double intrinsic = payoff(spot, strike, is_call);
    const double value = is_call
        ? bjerksund_2002_call(
            spot, strike, rate, dividend_yield, volatility, maturity)
        : bjerksund_2002_call(
            strike, spot, dividend_yield, rate, volatility, maturity);
    return std::max({value, european, intrinsic});
}

double carr_randomization_core(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int phases,
    bool is_call) {
    constexpr int grid_points = 501;
    const double intrinsic = payoff(spot, strike, is_call);
    if (volatility == 0.0) {
        return std::max(intrinsic, deterministic_price(
            spot, strike, rate, dividend_yield, maturity, is_call));
    }
    if (is_call && dividend_yield == 0.0) {
        return black_scholes_price_internal(
            spot, strike, rate, dividend_yield, volatility, maturity, true);
    }
    const double drift = rate - dividend_yield - 0.5 * volatility * volatility;
    const double half_width = std::max({
        2.0,
        std::fabs(std::log(strike / spot)) + 1.5,
        5.0 * volatility * std::sqrt(maturity) + std::fabs(drift) * maturity,
    });
    const double x_min = std::log(spot) - half_width;
    const double dx = 2.0 * half_width / static_cast<double>(grid_points);
    std::vector<double> exercise(grid_points + 1);
    std::vector<double> previous(grid_points + 1);
    std::vector<double> current(grid_points + 1);
    for (int index = 0; index <= grid_points; ++index) {
        const double stock = std::exp(x_min + static_cast<double>(index) * dx);
        exercise[static_cast<std::size_t>(index)] = payoff(stock, strike, is_call);
    }
    previous = exercise;
    const double intensity = static_cast<double>(phases) / maturity;
    const double diffusion = 0.5 * volatility * volatility / (dx * dx);
    double lower_generator = diffusion - drift / (2.0 * dx);
    double upper_generator = diffusion + drift / (2.0 * dx);
    if (lower_generator < 0.0 || upper_generator < 0.0) {
        lower_generator = diffusion + std::max(-drift, 0.0) / dx;
        upper_generator = diffusion + std::max(drift, 0.0) / dx;
    }
    const double lower = -lower_generator;
    const double upper = -upper_generator;
    const double diagonal = rate + intensity + lower_generator + upper_generator;
    constexpr double omega = 1.2;
    for (int phase = 0; phase < phases; ++phase) {
        current = previous;
        current.front() = is_call ? 0.0 : exercise.front();
        current.back() = is_call ? exercise.back() : 0.0;
        for (int iteration = 0; iteration < 10000; ++iteration) {
            double maximum_change = 0.0;
            for (int index = 1; index < grid_points; ++index) {
                const std::size_t position = static_cast<std::size_t>(index);
                const double continuation = (
                    intensity * previous[position] - lower * current[position - 1] -
                    upper * current[position + 1]) / diagonal;
                const double relaxed = current[position] + omega * (continuation - current[position]);
                const double updated = std::max(exercise[position], relaxed);
                maximum_change = std::max(maximum_change, std::fabs(updated - current[position]));
                current[position] = updated;
            }
            if (maximum_change < 1.0e-10) break;
        }
        previous.swap(current);
    }
    const double grid_position = (std::log(spot) - x_min) / dx;
    const int left = std::clamp(static_cast<int>(std::floor(grid_position)), 0, grid_points - 1);
    const double weight = grid_position - static_cast<double>(left);
    return previous[static_cast<std::size_t>(left)] * (1.0 - weight) +
        previous[static_cast<std::size_t>(left + 1)] * weight;
}

double carr_randomization_price_internal(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int phases,
    bool is_call) {
    const double coarse = carr_randomization_core(
        spot, strike, rate, dividend_yield, volatility, maturity, phases, is_call);
    const double fine = carr_randomization_core(
        spot, strike, rate, dividend_yield, volatility, maturity, 2 * phases, is_call);
    const double extrapolated = 2.0 * fine - coarse;
    return std::clamp(extrapolated, payoff(spot, strike, is_call), is_call ? spot : strike);
}

}  // namespace

extern "C" {

QK_EXPORT double qk_mc_european_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int paths,
    std::uint32_t seed,
    int is_call,
    int sampling_mode,
    int variance_mode) {

    if (!valid_common_inputs(spot, strike, volatility, maturity) || paths < 2 ||
        sampling_mode < 0 || sampling_mode > 2 || variance_mode < 0 || variance_mode > 3 ||
        (sampling_mode == 2 && paths < kRqmcReplications)) {
        last_standard_error = std::numeric_limits<double>::quiet_NaN();
        last_standard_deviation = std::numeric_limits<double>::quiet_NaN();
        return std::numeric_limits<double>::quiet_NaN();
    }

    const bool use_antithetic = variance_mode == 1 || variance_mode == 3;
    const bool use_control = variance_mode == 2 || variance_mode == 3;
    const int replications = sampling_mode == 2 ? kRqmcReplications : 1;
    const double discount = std::exp(-rate * maturity);
    const double drift =
        (rate - dividend_yield - 0.5 * volatility * volatility) * maturity;
    const double diffusion = volatility * std::sqrt(maturity);
    const double expected_control = spot * std::exp(-dividend_yield * maturity);
    Pcg32 rng(seed);

    double sum_x = 0.0;
    double sum_y = 0.0;
    double sum_x_squared = 0.0;
    double sum_y_squared = 0.0;
    double sum_xy = 0.0;
    std::array<double, kRqmcReplications> replication_x{};
    std::array<double, kRqmcReplications> replication_y{};
    std::array<int, kRqmcReplications> replication_counts{};

    for (int replication = 0; replication < replications; ++replication) {
        const int local_paths = paths / replications +
            (replication < paths % replications ? 1 : 0);
        const std::uint32_t digital_shift = sampling_mode == 2 ? rng.next_u32() : 0U;
        replication_counts[static_cast<std::size_t>(replication)] = local_paths;

        for (int path = 0; path < local_paths; ++path) {
            const double uniform = sampling_mode == 0
                ? rng.next_uniform()
                : sobol_uniform(static_cast<std::uint32_t>(path + 1), digital_shift);
            const double z = inverse_normal_cdf(uniform);
            const double first_terminal = spot * std::exp(drift + diffusion * z);
            double sample_x = discount * payoff(first_terminal, strike, is_call != 0);
            double sample_y = discount * first_terminal;

            if (use_antithetic) {
                const double second_terminal = spot * std::exp(drift - diffusion * z);
                sample_x = 0.5 * (sample_x +
                    discount * payoff(second_terminal, strike, is_call != 0));
                sample_y = 0.5 * (sample_y + discount * second_terminal);
            }

            sum_x += sample_x;
            sum_y += sample_y;
            sum_x_squared += sample_x * sample_x;
            sum_y_squared += sample_y * sample_y;
            sum_xy += sample_x * sample_y;
            replication_x[static_cast<std::size_t>(replication)] += sample_x;
            replication_y[static_cast<std::size_t>(replication)] += sample_y;
        }
    }

    const double path_count = static_cast<double>(paths);
    double beta = 0.0;
    if (use_control) {
        const double control_variation = sum_y_squared - sum_y * sum_y / path_count;
        if (control_variation > 1.0e-18) {
            beta = (sum_xy - sum_x * sum_y / path_count) / control_variation;
        }
    }

    const double sum_z = sum_x - beta * (sum_y - path_count * expected_control);
    const double sum_z_squared = sum_x_squared + beta * beta *
        (sum_y_squared - 2.0 * expected_control * sum_y +
         path_count * expected_control * expected_control) -
        2.0 * beta * (sum_xy - expected_control * sum_x);
    const double mean = sum_z / path_count;
    double variance = (sum_z_squared - path_count * mean * mean) / (path_count - 1.0);
    if (variance < 0.0) variance = 0.0;
    last_standard_deviation = std::sqrt(variance);

    if (sampling_mode == 2) {
        double replication_mean = 0.0;
        std::array<double, kRqmcReplications> estimates{};
        for (int replication = 0; replication < replications; ++replication) {
            const double count = static_cast<double>(
                replication_counts[static_cast<std::size_t>(replication)]);
            estimates[static_cast<std::size_t>(replication)] =
                replication_x[static_cast<std::size_t>(replication)] / count -
                beta * (replication_y[static_cast<std::size_t>(replication)] / count -
                        expected_control);
            replication_mean += estimates[static_cast<std::size_t>(replication)];
        }
        replication_mean /= static_cast<double>(replications);
        double replication_variance = 0.0;
        for (int replication = 0; replication < replications; ++replication) {
            const double difference =
                estimates[static_cast<std::size_t>(replication)] - replication_mean;
            replication_variance += difference * difference;
        }
        replication_variance /= static_cast<double>(replications - 1);
        last_standard_error =
            std::sqrt(replication_variance / static_cast<double>(replications));
    } else {
        last_standard_error = last_standard_deviation / std::sqrt(path_count);
    }
    return mean;
}

QK_EXPORT double qk_mc_last_std_error() {
    return last_standard_error;
}

QK_EXPORT double qk_mc_last_std_dev() {
    return last_standard_deviation;
}

QK_EXPORT int qk_mc_generate_distribution(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int sample_count,
    std::uint32_t seed,
    int is_call,
    int sampling_mode) {

    if (!valid_common_inputs(spot, strike, volatility, maturity) ||
        sample_count < 1 || sampling_mode < 0 || sampling_mode > 2) {
        distribution_count = 0;
        return 0;
    }
    distribution_count = sample_count > kMaxDistributionSamples
        ? kMaxDistributionSamples
        : sample_count;
    Pcg32 rng(seed);
    const std::uint32_t digital_shift = sampling_mode == 2 ? rng.next_u32() : 0U;
    const double drift =
        (rate - dividend_yield - 0.5 * volatility * volatility) * maturity;
    const double diffusion = volatility * std::sqrt(maturity);

    for (int index = 0; index < distribution_count; ++index) {
        const double uniform = sampling_mode == 0
            ? rng.next_uniform()
            : sobol_uniform(static_cast<std::uint32_t>(index + 1), digital_shift);
        const double terminal =
            spot * std::exp(drift + diffusion * inverse_normal_cdf(uniform));
        distribution_terminal[static_cast<std::size_t>(index)] = terminal;
        distribution_payoff[static_cast<std::size_t>(index)] =
            payoff(terminal, strike, is_call != 0);
    }
    return distribution_count;
}

QK_EXPORT double qk_mc_distribution_terminal(int index) {
    if (index < 0 || index >= distribution_count) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return distribution_terminal[static_cast<std::size_t>(index)];
}

QK_EXPORT double qk_mc_distribution_payoff(int index) {
    if (index < 0 || index >= distribution_count) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return distribution_payoff[static_cast<std::size_t>(index)];
}

QK_EXPORT double qk_bs_european_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int is_call) {
    if (!valid_common_inputs(spot, strike, volatility, maturity)) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    if (volatility == 0.0) {
        return deterministic_price(spot, strike, rate, dividend_yield, maturity, is_call != 0);
    }
    const double root_t = std::sqrt(maturity);
    const double d1 =
        (std::log(spot / strike) +
         (rate - dividend_yield + 0.5 * volatility * volatility) * maturity) /
        (volatility * root_t);
    const double d2 = d1 - volatility * root_t;
    const double discounted_spot = spot * std::exp(-dividend_yield * maturity);
    const double discounted_strike = strike * std::exp(-rate * maturity);
    if (is_call != 0) {
        return discounted_spot * normal_cdf(d1) - discounted_strike * normal_cdf(d2);
    }
    return discounted_strike * normal_cdf(-d2) - discounted_spot * normal_cdf(-d1);
}

QK_EXPORT double qk_baw_american_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int is_call) {
    if (!valid_common_inputs(spot, strike, volatility, maturity) ||
        rate < 0.0 || dividend_yield < 0.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return barone_adesi_whaley_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call != 0);
}

QK_EXPORT double qk_ju_american_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int is_call) {
    if (!valid_common_inputs(spot, strike, volatility, maturity) ||
        rate < 0.0 || dividend_yield < 0.0) return std::numeric_limits<double>::quiet_NaN();
    return ju_zhong_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call != 0);
}

QK_EXPORT double qk_carr_randomization_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int phases,
    int is_call) {
    if (!valid_common_inputs(spot, strike, volatility, maturity) ||
        rate < 0.0 || dividend_yield < 0.0 || phases < 4 || phases > 256) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return carr_randomization_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, phases, is_call != 0);
}

QK_EXPORT double qk_bjerksund_american_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int is_call) {
    if (!valid_common_inputs(spot, strike, volatility, maturity) ||
        rate < 0.0 || dividend_yield < 0.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return bjerksund_stensland_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call != 0);
}

QK_EXPORT double qk_bjerksund_2002_american_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int is_call) {
    if (!valid_common_inputs(spot, strike, volatility, maturity) ||
        rate < 0.0 || dividend_yield < 0.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return bjerksund_stensland_2002_price_internal(
        spot, strike, rate, dividend_yield, volatility, maturity, is_call != 0);
}

QK_EXPORT double qk_binomial_european_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int steps,
    int is_call) {
    if (!valid_common_inputs(spot, strike, volatility, maturity) ||
        steps < 1 || steps > 2000) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    if (volatility == 0.0) {
        return deterministic_price(spot, strike, rate, dividend_yield, maturity, is_call != 0);
    }
    const double dt = maturity / static_cast<double>(steps);
    const double up = std::exp(volatility * std::sqrt(dt));
    const double down = 1.0 / up;
    const double probability =
        (std::exp((rate - dividend_yield) * dt) - down) / (up - down);
    if (probability < 0.0 || probability > 1.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    const double step_discount = std::exp(-rate * dt);
    const double up_over_down = up / down;
    double terminal_spot = spot * std::pow(down, steps);
    std::vector<double> values(static_cast<std::size_t>(steps) + 1U);
    for (int node = 0; node <= steps; ++node) {
        values[static_cast<std::size_t>(node)] = payoff(terminal_spot, strike, is_call != 0);
        terminal_spot *= up_over_down;
    }
    for (int level = steps - 1; level >= 0; --level) {
        for (int node = 0; node <= level; ++node) {
            values[static_cast<std::size_t>(node)] = step_discount *
                (probability * values[static_cast<std::size_t>(node + 1)] +
                 (1.0 - probability) * values[static_cast<std::size_t>(node)]);
        }
    }
    return values[0];
}

QK_EXPORT double qk_binomial_american_price(
    double spot,
    double strike,
    double rate,
    double dividend_yield,
    double volatility,
    double maturity,
    int steps,
    int is_call) {
    if (!valid_common_inputs(spot, strike, volatility, maturity) ||
        steps < 1 || steps > 2000) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    const double intrinsic = payoff(spot, strike, is_call != 0);
    if (volatility == 0.0) {
        return std::max(
            intrinsic,
            deterministic_price(
                spot, strike, rate, dividend_yield, maturity, is_call != 0));
    }
    const double dt = maturity / static_cast<double>(steps);
    const double up = std::exp(volatility * std::sqrt(dt));
    const double down = 1.0 / up;
    const double probability =
        (std::exp((rate - dividend_yield) * dt) - down) / (up - down);
    if (probability < 0.0 || probability > 1.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    const double step_discount = std::exp(-rate * dt);
    const double up_over_down = up / down;
    double terminal_spot = spot * std::pow(down, steps);
    std::vector<double> values(static_cast<std::size_t>(steps) + 1U);
    for (int node = 0; node <= steps; ++node) {
        values[static_cast<std::size_t>(node)] =
            payoff(terminal_spot, strike, is_call != 0);
        terminal_spot *= up_over_down;
    }
    for (int level = steps - 1; level >= 0; --level) {
        double node_spot = spot * std::pow(down, level);
        for (int node = 0; node <= level; ++node) {
            const double continuation = step_discount *
                (probability * values[static_cast<std::size_t>(node + 1)] +
                 (1.0 - probability) * values[static_cast<std::size_t>(node)]);
            values[static_cast<std::size_t>(node)] = std::max(
                continuation, payoff(node_spot, strike, is_call != 0));
            node_spot *= up_over_down;
        }
    }
    return values[0];
}

}  // extern "C"
