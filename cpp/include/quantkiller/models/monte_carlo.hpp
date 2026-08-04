#pragma once
// Monte Carlo pricing of European options under GBM. Exact algorithm per
// contracts/rng-spec.md section 5 -- loop order and accumulation order are
// part of the spec so every language agrees for the same seed.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <string>

#include "quantkiller/qkerror.hpp"
#include "quantkiller/rng.hpp"

namespace quantkiller::models {

inline std::map<std::string, double> monte_carlo_price(
    double spot, double strike, double rate, double div_yield, double vol, double time,
    bool is_call, int paths, std::uint64_t seed, bool antithetic) {
    const double sign = is_call ? 1.0 : -1.0;
    if (time <= 0.0) throw QkError("monte_carlo_gbm requires time > 0");
    if (paths < 2) throw QkError("monte_carlo_gbm requires paths >= 2");

    Pcg32 rng(seed);
    const double disc = std::exp(-rate * time);
    const double drift = (rate - div_yield - 0.5 * vol * vol) * time;
    const double volt = vol * std::sqrt(time);

    double total = 0.0, total_sq = 0.0;
    for (int i = 0; i < paths; i++) {
        const double z = rng.next_normal();
        const double p1 = std::max(sign * (spot * std::exp(drift + volt * z) - strike), 0.0);
        double s;
        if (antithetic) {
            const double p2 = std::max(sign * (spot * std::exp(drift - volt * z) - strike), 0.0);
            s = 0.5 * (p1 + p2);
        } else {
            s = p1;
        }
        total += s;
        total_sq += s * s;
    }

    const double n = static_cast<double>(paths);
    const double mean = total / n;
    double variance = (total_sq - n * mean * mean) / (n - 1.0);
    if (variance < 0.0) variance = 0.0;

    return {{"price", disc * mean}, {"std_error", disc * std::sqrt(variance / n)}};
}

}  // namespace quantkiller::models
