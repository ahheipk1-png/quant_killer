#pragma once
// American-exercise approximations beyond the CRR tree in binomial.hpp.
// Ported from python/quantkiller/models/american.py (itself absorbed from
// the web-lab merge) -- see that file's docstring for paper references.
// Barone-Adesi-Whaley, Ju-Zhong, Bjerksund-Stensland 1993/2002, and Carr
// randomization (PSOR finite-difference, Richardson-extrapolated in phase
// count).

#include <algorithm>
#include <cmath>
#include <map>
#include <string>
#include <vector>

#include "quantkiller/models/black_scholes.hpp"
#include "quantkiller/qkerror.hpp"
#include "quantkiller/qkmath.hpp"

namespace quantkiller::models {
namespace detail {

inline double intrinsic(double spot, double strike, bool is_call) {
    return std::max(is_call ? spot - strike : strike - spot, 0.0);
}

inline double european(double spot, double strike, double rate, double div_yield, double vol, double time, bool is_call) {
    return black_scholes_price(spot, strike, rate, div_yield, vol, time, is_call)["price"];
}

inline void validate_american(double rate, double div_yield) {
    if (rate < 0.0 || div_yield < 0.0) {
        throw QkError("this American approximation requires rate >= 0 and div_yield >= 0");
    }
}

inline std::pair<double, double> baw_critical_price(
    double strike, double rate, double div_yield, double vol, double time, bool is_call) {
    const double variance = vol * vol * time;
    const double root_variance = std::sqrt(variance);
    const double risk_free_discount = std::exp(-rate * time);
    const double dividend_discount = std::exp(-div_yield * time);
    const double n = 2.0 * std::log(dividend_discount / risk_free_discount) / variance;
    const double m = -2.0 * std::log(risk_free_discount) / variance;
    const double carry_time = std::log(dividend_discount / risk_free_discount);

    double upper_exponent, upper, boundary;
    if (is_call) {
        upper_exponent = (-(n - 1.0) + std::sqrt((n - 1.0) * (n - 1.0) + 4.0 * m)) / 2.0;
        upper = strike / (1.0 - 1.0 / upper_exponent);
        const double h = -(carry_time + 2.0 * root_variance) * strike / (upper - strike);
        boundary = strike + (upper - strike) * (1.0 - std::exp(h));
    } else {
        upper_exponent = (-(n - 1.0) - std::sqrt((n - 1.0) * (n - 1.0) + 4.0 * m)) / 2.0;
        upper = strike / (1.0 - 1.0 / upper_exponent);
        const double h = (carry_time - 2.0 * root_variance) * strike / (strike - upper);
        boundary = upper + (strike - upper) * std::exp(h);
    }

    const double coefficient = std::fabs(1.0 - risk_free_discount) > 1.0e-12
        ? -2.0 * std::log(risk_free_discount) / (variance * (1.0 - risk_free_discount))
        : 2.0 / variance;
    const double exponent = is_call
        ? (-(n - 1.0) + std::sqrt((n - 1.0) * (n - 1.0) + 4.0 * coefficient)) / 2.0
        : (-(n - 1.0) - std::sqrt((n - 1.0) * (n - 1.0) + 4.0 * coefficient)) / 2.0;

    for (int iteration = 0; iteration < 100; ++iteration) {
        const double forward_boundary = boundary * dividend_discount / risk_free_discount;
        const double d1 = (std::log(forward_boundary / strike) + 0.5 * variance) / root_variance;
        const double euro = european(boundary, strike, rate, div_yield, vol, time, is_call);
        if (is_call) {
            const double lhs = boundary - strike;
            const double rhs = euro + (1.0 - dividend_discount * norm_cdf(d1)) * boundary / exponent;
            const double slope = dividend_discount * norm_cdf(d1) * (1.0 - 1.0 / exponent) +
                (1.0 - dividend_discount * norm_pdf(d1) / root_variance) / exponent;
            if (std::fabs(lhs - rhs) / strike <= 1.0e-8) break;
            boundary = (strike + rhs - slope * boundary) / (1.0 - slope);
        } else {
            const double lhs = strike - boundary;
            const double rhs = euro - (1.0 - dividend_discount * norm_cdf(-d1)) * boundary / exponent;
            const double slope = -dividend_discount * norm_cdf(-d1) * (1.0 - 1.0 / exponent) -
                (1.0 + dividend_discount * norm_pdf(-d1) / root_variance) / exponent;
            if (std::fabs(lhs - rhs) / strike <= 1.0e-8) break;
            boundary = (strike - rhs + slope * boundary) / (1.0 + slope);
        }
    }
    return {boundary, exponent};
}

}  // namespace detail

inline std::map<std::string, double> baw_price(
    double spot, double strike, double rate, double div_yield, double vol, double time, bool is_call) {
    detail::validate_american(rate, div_yield);
    const double euro = detail::european(spot, strike, rate, div_yield, vol, time, is_call);
    const double intr = detail::intrinsic(spot, strike, is_call);
    if (vol == 0.0 || (is_call && div_yield <= 0.0)) return {{"price", std::max(euro, intr)}};

    auto [boundary, exponent] = detail::baw_critical_price(strike, rate, div_yield, vol, time, is_call);
    const double variance = vol * vol * time;
    const double d1 = (std::log(boundary * std::exp((rate - div_yield) * time) / strike) + 0.5 * variance) / std::sqrt(variance);
    const double dividend_discount = std::exp(-div_yield * time);
    double value;
    if (is_call) {
        const double coefficient = boundary / exponent * (1.0 - dividend_discount * norm_cdf(d1));
        value = spot < boundary ? euro + coefficient * std::pow(spot / boundary, exponent) : intr;
    } else {
        const double coefficient = -boundary / exponent * (1.0 - dividend_discount * norm_cdf(-d1));
        value = spot > boundary ? euro + coefficient * std::pow(spot / boundary, exponent) : intr;
    }
    return {{"price", std::max({value, euro, intr})}};
}

inline std::map<std::string, double> ju_zhong_price(
    double spot, double strike, double rate, double div_yield, double vol, double time, bool is_call) {
    detail::validate_american(rate, div_yield);
    const double euro = detail::european(spot, strike, rate, div_yield, vol, time, is_call);
    const double intr = detail::intrinsic(spot, strike, is_call);
    if (vol == 0.0 || (is_call && div_yield <= 0.0)) return {{"price", std::max(euro, intr)}};
    if (std::fabs(rate) < 1e-9) return baw_price(spot, strike, rate, div_yield, vol, time, is_call);

    auto [boundary, unused_exponent] = detail::baw_critical_price(strike, rate, div_yield, vol, time, is_call);
    (void)unused_exponent;
    const double phi = is_call ? 1.0 : -1.0;
    const double variance = vol * vol * time;
    const double root_variance = std::sqrt(variance);
    const double risk_free_discount = std::exp(-rate * time);
    const double dividend_discount = std::exp(-div_yield * time);
    const double h = 1.0 - risk_free_discount;
    const double alpha = -2.0 * std::log(risk_free_discount) / variance;
    const double beta = 2.0 * std::log(dividend_discount / risk_free_discount) / variance;
    const double radical = std::sqrt((beta - 1.0) * (beta - 1.0) + 4.0 * alpha / h);
    const double exponent = (-(beta - 1.0) + phi * radical) / 2.0;
    const double exponent_prime = -phi * alpha / (h * h * radical);
    const double european_boundary = detail::european(boundary, strike, rate, div_yield, vol, time, is_call);
    const double premium_boundary = phi * (boundary - strike) - european_boundary;
    const double denominator = 2.0 * exponent + beta - 1.0;
    if (std::fabs(premium_boundary) < 1e-12 || std::fabs(denominator) < 1e-12) {
        return baw_price(spot, strike, rate, div_yield, vol, time, is_call);
    }
    const double forward_boundary = boundary * dividend_discount / risk_free_discount;
    const double d1 = (std::log(forward_boundary / strike) + 0.5 * variance) / root_variance;
    const double d2 = d1 - root_variance;
    const double european_h = forward_boundary * norm_pdf(d1) / (alpha * root_variance) -
        phi * forward_boundary * norm_cdf(phi * d1) * std::log(dividend_discount) / std::log(risk_free_discount) +
        phi * strike * norm_cdf(phi * d2);
    const double quadratic = (1.0 - h) * alpha * exponent_prime / (2.0 * denominator);
    const double linear = -(1.0 - h) * alpha / denominator *
        (european_h / premium_boundary + 1.0 / h + exponent_prime / denominator);
    const double log_ratio = std::log(spot / boundary);
    const double chi = log_ratio * (quadratic * log_ratio + linear);
    if (!std::isfinite(chi) || std::fabs(1.0 - chi) <= 1e-8) {
        return baw_price(spot, strike, rate, div_yield, vol, time, is_call);
    }
    const bool continuation_region = phi * (boundary - spot) > 0.0;
    const double value = continuation_region
        ? euro + premium_boundary * std::pow(spot / boundary, exponent) / (1.0 - chi)
        : intr;
    return {{"price", std::max({value, euro, intr})}};
}

namespace detail {

inline double bjerksund_phi(double spot, double gamma, double boundary, double trigger,
                             double rate_time, double carry_time, double variance) {
    const double root_variance = std::sqrt(variance);
    const double lambda = -rate_time + gamma * carry_time + 0.5 * gamma * (gamma - 1.0) * variance;
    const double d = -(std::log(spot / boundary) + carry_time + (gamma - 0.5) * variance) / root_variance;
    const double kappa = 2.0 * carry_time / variance + 2.0 * gamma - 1.0;
    return std::exp(lambda) * (norm_cdf(d) - std::pow(trigger / spot, kappa) *
        norm_cdf(d - 2.0 * std::log(trigger / spot) / root_variance));
}

inline double bjerksund_call(double spot, double strike, double risk_free_discount,
                              double dividend_discount, double variance) {
    const double rate_time = std::log(1.0 / risk_free_discount);
    const double carry_time = std::log(dividend_discount / risk_free_discount);
    const double euro = european(spot, strike, rate_time, rate_time - carry_time, std::sqrt(variance), 1.0, true);
    const double intr = std::max(spot - strike, 0.0);
    if (dividend_discount >= 1.0 && dividend_discount >= risk_free_discount) return std::max(euro, intr);

    const double beta = 0.5 - carry_time / variance +
        std::sqrt(std::pow(carry_time / variance - 0.5, 2.0) + 2.0 * rate_time / variance);
    if (beta <= 1.0) return std::max(euro, intr);
    const double boundary_infinity = beta / (beta - 1.0) * strike;
    const double boundary_zero = std::fabs(carry_time - rate_time) < 1.0e-14
        ? strike : std::max(strike, rate_time / (rate_time - carry_time) * strike);
    const double h = -(carry_time + 2.0 * std::sqrt(variance)) * boundary_zero / (boundary_infinity - boundary_zero);
    const double boundary = boundary_zero + (boundary_infinity - boundary_zero) * (1.0 - std::exp(h));
    const double forward = spot * dividend_discount / risk_free_discount;
    if (spot >= boundary) return intr;
    if (std::log(boundary / forward) / std::sqrt(variance) > 12.5) return std::max(euro, intr);

    const double value = (boundary - strike) * std::pow(spot / boundary, beta) *
        (1.0 - bjerksund_phi(spot, beta, boundary, boundary, rate_time, carry_time, variance)) +
        spot * bjerksund_phi(spot, 1.0, boundary, boundary, rate_time, carry_time, variance) -
        spot * bjerksund_phi(spot, 1.0, strike, boundary, rate_time, carry_time, variance) -
        strike * bjerksund_phi(spot, 0.0, boundary, boundary, rate_time, carry_time, variance) +
        strike * bjerksund_phi(spot, 0.0, strike, boundary, rate_time, carry_time, variance);
    return std::max({value, euro, intr});
}

}  // namespace detail

inline std::map<std::string, double> bjerksund_1993_price(
    double spot, double strike, double rate, double div_yield, double vol, double time, bool is_call) {
    detail::validate_american(rate, div_yield);
    const double euro = detail::european(spot, strike, rate, div_yield, vol, time, is_call);
    const double intr = detail::intrinsic(spot, strike, is_call);
    if (vol == 0.0) return {{"price", std::max(euro, intr)}};
    const double risk_free_discount = std::exp(-rate * time);
    const double dividend_discount = std::exp(-div_yield * time);
    const double variance = vol * vol * time;
    const double value = is_call
        ? detail::bjerksund_call(spot, strike, risk_free_discount, dividend_discount, variance)
        : detail::bjerksund_call(strike, spot, dividend_discount, risk_free_discount, variance);
    return {{"price", std::max({value, euro, intr})}};
}

namespace detail {

inline double bivariate_normal_cdf(double first, double second, double correlation) {
    if (first <= -10.0 || second <= -10.0) return 0.0;
    if (first >= 10.0) return norm_cdf(second);
    if (second >= 10.0) return norm_cdf(first);
    if (std::fabs(correlation) < 1.0e-14) return norm_cdf(first) * norm_cdf(second);
    constexpr int intervals = 512;
    const double lower = -10.0;
    const double upper = std::min(first, 10.0);
    const double width = (upper - lower) / intervals;
    const double correlation_scale = std::sqrt(1.0 - correlation * correlation);
    auto integrand = [&](double value) {
        return norm_pdf(value) * norm_cdf((second - correlation * value) / correlation_scale);
    };
    double total = integrand(lower) + integrand(upper);
    for (int index = 1; index < intervals; ++index) {
        total += (index % 2 == 0 ? 2.0 : 4.0) * integrand(lower + index * width);
    }
    return std::min(std::max(total * width / 3.0, 0.0), 1.0);
}

inline double bjerksund_2002_phi(double spot, double horizon, double gamma, double cap, double trigger,
                                  double rate, double carry, double vol) {
    const double variance = vol * vol;
    const double denominator = vol * std::sqrt(horizon);
    const double lambda = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance;
    const double kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
    const double drift = (carry + (gamma - 0.5) * variance) * horizon;
    const double d1 = -(std::log(spot / cap) + drift) / denominator;
    const double d2 = d1 - 2.0 * std::log(trigger / spot) / denominator;
    return std::exp(lambda * horizon) * std::pow(spot, gamma) *
        (norm_cdf(d1) - std::pow(trigger / spot, kappa) * norm_cdf(d2));
}

inline double bjerksund_2002_psi(double spot, double time, double gamma, double cap,
                                  double first_boundary, double second_boundary, double split_time,
                                  double rate, double carry, double vol) {
    const double variance = vol * vol;
    const double lambda = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance;
    const double kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
    const double gamma_carry = carry + (gamma - 0.5) * variance;
    const double short_scale = vol * std::sqrt(split_time);
    const double full_scale = vol * std::sqrt(time);
    const double short_drift = gamma_carry * split_time;
    const double full_drift = gamma_carry * time;
    const double correlation = std::sqrt(split_time / time);

    const double d1 = -(std::log(spot / second_boundary) + short_drift) / short_scale;
    const double d2 = -(std::log(first_boundary * first_boundary / (spot * second_boundary)) + short_drift) / short_scale;
    const double d3 = -(std::log(spot / second_boundary) - short_drift) / short_scale;
    const double d4 = -(std::log(first_boundary * first_boundary / (spot * second_boundary)) - short_drift) / short_scale;
    const double e1 = -(std::log(spot / cap) + full_drift) / full_scale;
    const double e2 = -(std::log(first_boundary * first_boundary / (spot * cap)) + full_drift) / full_scale;
    const double e3 = -(std::log(second_boundary * second_boundary / (spot * cap)) + full_drift) / full_scale;
    const double e4 = -(std::log(spot * second_boundary * second_boundary / (cap * first_boundary * first_boundary)) + full_drift) / full_scale;

    const double value =
        bivariate_normal_cdf(d1, e1, correlation) -
        std::pow(first_boundary / spot, kappa) * bivariate_normal_cdf(d2, e2, correlation) -
        std::pow(second_boundary / spot, kappa) * bivariate_normal_cdf(d3, e3, -correlation) +
        std::pow(second_boundary / first_boundary, kappa) * bivariate_normal_cdf(d4, e4, -correlation);
    return std::exp(lambda * time) * std::pow(spot, gamma) * value;
}

inline double bjerksund_2002_call(double spot, double strike, double rate, double div_yield, double vol, double time) {
    const double euro = european(spot, strike, rate, div_yield, vol, time, true);
    const double intr = std::max(spot - strike, 0.0);
    const double carry = rate - div_yield;
    if (vol == 0.0 || carry >= rate) return std::max(euro, intr);

    const double variance = vol * vol;
    const double beta = 0.5 - carry / variance + std::sqrt(std::pow(carry / variance - 0.5, 2.0) + 2.0 * rate / variance);
    if (beta <= 1.0) return std::max(euro, intr);
    const double boundary_infinity = beta / (beta - 1.0) * strike;
    const double boundary_zero = std::max(strike, rate / (rate - carry) * strike);
    auto boundary = [&](double horizon) {
        const double h = -(carry * horizon + 2.0 * vol * std::sqrt(horizon)) *
            strike * strike / ((boundary_infinity - boundary_zero) * boundary_zero);
        return boundary_zero + (boundary_infinity - boundary_zero) * (1.0 - std::exp(h));
    };
    const double split_time = 0.5 * (std::sqrt(5.0) - 1.0) * time;
    const double first_boundary = boundary(time);
    const double second_boundary = boundary(time - split_time);
    if (spot >= first_boundary) return intr;
    const double alpha_first = (first_boundary - strike) * std::pow(first_boundary, -beta);
    const double alpha_second = (second_boundary - strike) * std::pow(second_boundary, -beta);
    const double value =
        alpha_first * std::pow(spot, beta) -
        alpha_first * bjerksund_2002_phi(spot, split_time, beta, first_boundary, first_boundary, rate, carry, vol) +
        bjerksund_2002_phi(spot, split_time, 1.0, first_boundary, first_boundary, rate, carry, vol) -
        bjerksund_2002_phi(spot, split_time, 1.0, second_boundary, first_boundary, rate, carry, vol) -
        strike * bjerksund_2002_phi(spot, split_time, 0.0, first_boundary, first_boundary, rate, carry, vol) +
        strike * bjerksund_2002_phi(spot, split_time, 0.0, second_boundary, first_boundary, rate, carry, vol) +
        alpha_second * bjerksund_2002_phi(spot, split_time, beta, second_boundary, first_boundary, rate, carry, vol) -
        alpha_second * bjerksund_2002_psi(spot, time, beta, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol) +
        bjerksund_2002_psi(spot, time, 1.0, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol) -
        bjerksund_2002_psi(spot, time, 1.0, strike, first_boundary, second_boundary, split_time, rate, carry, vol) -
        strike * bjerksund_2002_psi(spot, time, 0.0, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol) +
        strike * bjerksund_2002_psi(spot, time, 0.0, strike, first_boundary, second_boundary, split_time, rate, carry, vol);
    return std::max({value, euro, intr});
}

}  // namespace detail

inline std::map<std::string, double> bjerksund_2002_price(
    double spot, double strike, double rate, double div_yield, double vol, double time, bool is_call) {
    detail::validate_american(rate, div_yield);
    const double euro = detail::european(spot, strike, rate, div_yield, vol, time, is_call);
    const double intr = detail::intrinsic(spot, strike, is_call);
    const double value = is_call
        ? detail::bjerksund_2002_call(spot, strike, rate, div_yield, vol, time)
        : detail::bjerksund_2002_call(strike, spot, div_yield, rate, vol, time);
    return {{"price", std::max({value, euro, intr})}};
}

namespace detail {

inline double payoff(double terminal_spot, double strike, bool is_call) {
    return std::max(is_call ? terminal_spot - strike : strike - terminal_spot, 0.0);
}

inline double carr_randomization_core(
    double spot, double strike, double rate, double div_yield, double vol, double time, int phases, bool is_call) {
    constexpr int grid_points = 501;
    const double intr = payoff(spot, strike, is_call);
    if (vol == 0.0) {
        const double fwd = spot * std::exp((rate - div_yield) * time);
        return std::max(intr, std::exp(-rate * time) * payoff(fwd, strike, is_call));
    }
    if (is_call && div_yield == 0.0) {
        return european(spot, strike, rate, div_yield, vol, time, true);
    }

    const double drift = rate - div_yield - 0.5 * vol * vol;
    const double half_width = std::max({2.0, std::fabs(std::log(strike / spot)) + 1.5,
        5.0 * vol * std::sqrt(time) + std::fabs(drift) * time});
    const double x_min = std::log(spot) - half_width;
    const double dx = 2.0 * half_width / grid_points;
    std::vector<double> exercise(grid_points + 1);
    for (int index = 0; index <= grid_points; ++index) {
        exercise[index] = payoff(std::exp(x_min + index * dx), strike, is_call);
    }
    std::vector<double> previous = exercise;
    std::vector<double> current = exercise;
    const double intensity = phases / time;
    const double diffusion = 0.5 * vol * vol / (dx * dx);
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
            double max_change = 0.0;
            for (int index = 1; index < grid_points; ++index) {
                const double continuation = (intensity * previous[index] -
                    lower * current[index - 1] - upper * current[index + 1]) / diagonal;
                const double relaxed = current[index] + omega * (continuation - current[index]);
                const double updated = std::max(exercise[index], relaxed);
                max_change = std::max(max_change, std::fabs(updated - current[index]));
                current[index] = updated;
            }
            if (max_change < 1.0e-10) break;
        }
        previous.swap(current);
    }

    const double grid_position = (std::log(spot) - x_min) / dx;
    const int left = std::clamp(static_cast<int>(std::floor(grid_position)), 0, grid_points - 1);
    const double weight = grid_position - left;
    return previous[left] * (1.0 - weight) + previous[left + 1] * weight;
}

}  // namespace detail

inline std::map<std::string, double> carr_randomization_price(
    double spot, double strike, double rate, double div_yield, double vol, double time, int phases, bool is_call) {
    detail::validate_american(rate, div_yield);
    if (phases < 4 || phases > 256) throw QkError("carr_randomization requires 4 <= phases <= 256");
    const double coarse = detail::carr_randomization_core(spot, strike, rate, div_yield, vol, time, phases, is_call);
    const double fine = detail::carr_randomization_core(spot, strike, rate, div_yield, vol, time, 2 * phases, is_call);
    const double extrapolated = 2.0 * fine - coarse;
    const double lower = detail::payoff(spot, strike, is_call);
    const double upper = is_call ? spot : strike;
    return {{"price", std::clamp(extrapolated, lower, upper)}};
}

}  // namespace quantkiller::models
