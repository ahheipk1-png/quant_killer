#pragma once
// Forward pricing by cost of carry and put-call parity. Mirrors
// python/quantkiller/models/forward.py and parity.py.

#include <cmath>
#include <map>
#include <optional>
#include <string>

#include "quantkiller/qkerror.hpp"

namespace quantkiller::models {

inline std::map<std::string, double> forward_price(
    double spot, double rate, double div_yield, double time, std::optional<double> strike) {
    const double fwd = spot * std::exp((rate - div_yield) * time);
    std::map<std::string, double> out = {{"forward_price", fwd}};
    if (strike.has_value()) {
        out["value"] = (fwd - *strike) * std::exp(-rate * time);
    }
    return out;
}

inline std::map<std::string, double> put_call_parity(
    double spot, double strike, double rate, double div_yield, double time,
    std::optional<double> call_price, std::optional<double> put_price) {
    if (!call_price.has_value() && !put_price.has_value()) {
        throw QkError("put_call_parity needs call_price and/or put_price");
    }
    const double basis = spot * std::exp(-div_yield * time) - strike * std::exp(-rate * time);
    std::map<std::string, double> out;
    if (call_price.has_value() && put_price.has_value()) {
        out["residual"] = *call_price - *put_price - basis;
    } else if (call_price.has_value()) {
        out["put_price"] = *call_price - basis;
        out["residual"] = 0.0;
    } else {
        out["call_price"] = *put_price + basis;
        out["residual"] = 0.0;
    }
    return out;
}

}  // namespace quantkiller::models
