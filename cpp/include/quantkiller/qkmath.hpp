#pragma once
// Special functions per contracts/rng-spec.md (FROZEN). norm_cdf/norminv are
// Hart(1968)/West(2005) and Acklam's rational approximations respectively,
// implemented identically in every QuantKiller language rather than relying
// on the platform's own erf (runtimes differ in the last bits).

#include <array>
#include <cmath>
#include <stdexcept>

namespace quantkiller {

inline constexpr double kSqrtTwoPi = 2.5066282746310005;

inline double norm_pdf(double x) {
    return std::exp(-0.5 * x * x) / kSqrtTwoPi;
}

inline double norm_cdf(double x) {
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

inline double norminv(double p) {
    if (!(p > 0.0 && p < 1.0)) {
        throw std::domain_error("norminv requires 0 < p < 1");
    }
    static constexpr std::array<double, 6> a = {
        -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
        1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00};
    static constexpr std::array<double, 5> b = {
        -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
        6.680131188771972e+01, -1.328068155288572e+01};
    static constexpr std::array<double, 6> c = {
        -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
        -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00};
    static constexpr std::array<double, 4> d = {
        7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00};

    constexpr double p_low = 0.02425;
    constexpr double p_high = 1.0 - p_low;
    double x;
    if (p < p_low) {
        const double q = std::sqrt(-2.0 * std::log(p));
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    } else if (p <= p_high) {
        const double q = p - 0.5;
        const double r = q * q;
        x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
    } else {
        const double q = std::sqrt(-2.0 * std::log(1.0 - p));
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    }
    const double error = norm_cdf(x) - p;
    const double correction = error * kSqrtTwoPi * std::exp(0.5 * x * x);
    return x - correction / (1.0 + 0.5 * x * correction);
}

}  // namespace quantkiller
