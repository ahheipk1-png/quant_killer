#pragma once
// Cox-Ross-Rubinstein binomial tree, European and American. Mirrors
// python/quantkiller/models/binomial.py's loop order exactly.

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "quantkiller/qkerror.hpp"

namespace quantkiller::models {

inline std::map<std::string, double> binomial_price(
    double spot, double strike, double rate, double div_yield, double vol, double time,
    bool is_call, bool american, int steps) {
    const double sign = is_call ? 1.0 : -1.0;
    if (vol <= 0.0) throw QkError("binomial_crr requires vol > 0");
    if (time <= 0.0) throw QkError("binomial_crr requires time > 0");

    const double dt = time / steps;
    const double u = std::exp(vol * std::sqrt(dt));
    const double d = 1.0 / u;
    const double a = std::exp((rate - div_yield) * dt);
    const double p = (a - d) / (u - d);
    if (!(p > 0.0 && p < 1.0)) {
        throw QkError("CRR risk-neutral probability out of (0,1)");
    }
    const double disc = std::exp(-rate * dt);
    const double u2 = u * u;

    std::vector<double> values(steps + 1);
    double s = spot * std::pow(d, steps);
    for (int j = 0; j <= steps; j++) {
        values[j] = std::max(sign * (s - strike), 0.0);
        s *= u2;
    }

    std::optional<std::array<double, 3>> v2;
    std::optional<std::array<double, 2>> v1;

    for (int i = steps - 1; i >= 0; i--) {
        s = spot * std::pow(d, i);
        for (int j = 0; j <= i; j++) {
            double cont = disc * (p * values[j + 1] + (1.0 - p) * values[j]);
            if (american) cont = std::max(cont, sign * (s - strike));
            values[j] = cont;
            s *= u2;
        }
        if (i == 2) v2 = std::array<double, 3>{values[0], values[1], values[2]};
        else if (i == 1) v1 = std::array<double, 2>{values[0], values[1]};
    }

    const double root = values[0];
    std::map<std::string, double> out = {{"price", root}};
    if (steps >= 2 && v1.has_value() && v2.has_value()) {
        const double s_u = spot * u, s_d = spot * d;
        const double delta = ((*v1)[1] - (*v1)[0]) / (s_u - s_d);
        const double s_uu = spot * u2, s_mid = spot, s_dd = spot * d * d;
        const double delta_up = ((*v2)[2] - (*v2)[1]) / (s_uu - s_mid);
        const double delta_dn = ((*v2)[1] - (*v2)[0]) / (s_mid - s_dd);
        const double gamma = (delta_up - delta_dn) / (0.5 * (s_uu - s_dd));
        const double theta = ((*v2)[1] - root) / (2.0 * dt);
        out["delta"] = delta;
        out["gamma"] = gamma;
        out["theta"] = theta;
    }
    return out;
}

}  // namespace quantkiller::models
