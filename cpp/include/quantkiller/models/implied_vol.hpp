#pragma once
// Implied volatility via safeguarded Newton/bisection. Mirrors
// python/quantkiller/models/implied_vol.py exactly.

#include <algorithm>
#include <cmath>
#include <map>
#include <string>

#include "quantkiller/models/black_scholes.hpp"
#include "quantkiller/qkerror.hpp"

namespace quantkiller::models {

inline std::map<std::string, double> implied_vol_solve(
    double target, double spot, double strike, double rate, double div_yield, double time, bool is_call) {
    constexpr double kSigmaMin = 1e-9;
    constexpr double kSigmaMax = 5.0;
    constexpr int kMaxIter = 100;

    if (time <= 0.0) throw QkError("implied_vol requires time > 0");

    const double df_r = std::exp(-rate * time);
    const double df_q = std::exp(-div_yield * time);
    double lower, upper;
    if (is_call) {
        lower = std::max(spot * df_q - strike * df_r, 0.0);
        upper = spot * df_q;
    } else {
        lower = std::max(strike * df_r - spot * df_q, 0.0);
        upper = strike * df_r;
    }

    const double tol = 1e-12 * (1.0 + std::fabs(target));
    if (target < lower - tol || target > upper + tol) {
        throw QkError("target price violates no-arbitrage bounds");
    }
    if (target <= lower + tol) {
        return {{"implied_vol", 0.0}, {"iterations", 0.0}};
    }

    constexpr double kPi = 3.14159265358979323846;
    double sigma = std::sqrt(2.0 * kPi / time) * target / spot;
    sigma = std::min(std::max(sigma, 1e-4), kSigmaMax);
    double lo = kSigmaMin, hi = kSigmaMax;

    auto f = [&](double vol) { return black_scholes_price(spot, strike, rate, div_yield, vol, time, is_call); };

    int iterations = 0;
    for (iterations = 1; iterations <= kMaxIter; iterations++) {
        auto outp = f(sigma);
        const double diff = outp["price"] - target;
        if (std::fabs(diff) <= tol) break;
        if (diff > 0.0) hi = sigma; else lo = sigma;
        const double vega = outp["vega"];
        bool step_ok = false;
        double sigma_next = 0.0;
        if (vega > 1e-12) {
            const double candidate = sigma - diff / vega;
            if (candidate > lo && candidate < hi) {
                step_ok = std::fabs(candidate - sigma) > 1e-14;
                sigma_next = candidate;
            }
        }
        if (!step_ok) {
            sigma_next = 0.5 * (lo + hi);
            if (std::fabs(sigma_next - sigma) <= 1e-14) break;
        }
        sigma = sigma_next;
    }
    if (iterations > kMaxIter) iterations = kMaxIter;

    if (std::fabs(f(sigma)["price"] - target) > std::max(tol, 1e-8 * (1.0 + std::fabs(target)))) {
        throw QkError("implied_vol did not converge");
    }
    return {{"implied_vol", sigma}, {"iterations", static_cast<double>(iterations)}};
}

}  // namespace quantkiller::models
