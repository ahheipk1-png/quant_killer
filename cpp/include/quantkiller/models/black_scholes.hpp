#pragma once
// Black-Scholes-Merton closed form with continuous dividend yield, plus
// Greeks. Mirrors python/quantkiller/models/black_scholes.py exactly,
// including the T==0 and vol==0 edge conventions.

#include <algorithm>
#include <cmath>
#include <map>
#include <string>

#include "quantkiller/qkmath.hpp"

namespace quantkiller::models {

inline std::map<std::string, double> black_scholes_price(
    double spot, double strike, double rate, double div_yield, double vol, double time, bool is_call) {
    const double sign = is_call ? 1.0 : -1.0;
    std::map<std::string, double> out;

    if (time == 0.0) {
        const double intrinsic = std::max(sign * (spot - strike), 0.0);
        double delta;
        if (spot == strike) delta = sign * 0.5;
        else delta = (sign * (spot - strike) > 0.0) ? sign : 0.0;
        out = {{"price", intrinsic}, {"delta", delta}, {"gamma", 0.0}, {"vega", 0.0}, {"theta", 0.0}, {"rho", 0.0}};
        return out;
    }

    const double df_r = std::exp(-rate * time);
    const double df_q = std::exp(-div_yield * time);

    if (vol == 0.0) {
        const double fwd = spot * df_q / df_r;
        const double intrinsic = std::max(sign * (fwd - strike), 0.0) * df_r;
        const bool in_money = sign * (fwd - strike) > 0.0;
        const double delta = in_money ? sign * df_q : 0.0;
        out = {{"price", intrinsic}, {"delta", delta}, {"gamma", 0.0}, {"vega", 0.0}, {"theta", 0.0}, {"rho", 0.0}};
        return out;
    }

    const double sqrt_t = std::sqrt(time);
    const double d1 = (std::log(spot / strike) + (rate - div_yield + 0.5 * vol * vol) * time) / (vol * sqrt_t);
    const double d2 = d1 - vol * sqrt_t;
    const double pdf_d1 = norm_pdf(d1);

    const double gamma = df_q * pdf_d1 / (spot * vol * sqrt_t);
    const double vega = spot * df_q * pdf_d1 * sqrt_t;

    double price, delta, theta, rho;
    if (is_call) {
        const double nd1 = norm_cdf(d1);
        const double nd2 = norm_cdf(d2);
        price = spot * df_q * nd1 - strike * df_r * nd2;
        delta = df_q * nd1;
        theta = -spot * df_q * pdf_d1 * vol / (2.0 * sqrt_t) + div_yield * spot * df_q * nd1 - rate * strike * df_r * nd2;
        rho = strike * time * df_r * nd2;
    } else {
        const double nmd1 = norm_cdf(-d1);
        const double nmd2 = norm_cdf(-d2);
        price = strike * df_r * nmd2 - spot * df_q * nmd1;
        delta = -df_q * nmd1;
        theta = -spot * df_q * pdf_d1 * vol / (2.0 * sqrt_t) - div_yield * spot * df_q * nmd1 + rate * strike * df_r * nmd2;
        rho = -strike * time * df_r * nmd2;
    }

    out = {{"price", price}, {"delta", delta}, {"gamma", gamma}, {"vega", vega},
           {"theta", theta}, {"rho", rho}, {"d1", d1}, {"d2", d2}};
    return out;
}

}  // namespace quantkiller::models
