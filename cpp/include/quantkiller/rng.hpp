#pragma once
// PCG32 (PCG-XSH-RR 64/32) per contracts/rng-spec.md (FROZEN).

#include <cstdint>

#include "quantkiller/qkmath.hpp"

namespace quantkiller {

class Pcg32 {
public:
    explicit Pcg32(std::uint64_t seed, std::uint64_t sequence = 1ULL)
        : state_(0ULL), inc_((sequence << 1U) | 1ULL) {
        next_u32();
        state_ += seed;
        next_u32();
    }

    std::uint32_t next_u32() {
        const std::uint64_t old_state = state_;
        state_ = old_state * kMult + inc_;
        const auto xorshifted = static_cast<std::uint32_t>(((old_state >> 18U) ^ old_state) >> 27U);
        const auto rot = static_cast<std::uint32_t>(old_state >> 59U);
        return (xorshifted >> rot) | (xorshifted << ((32U - rot) & 31U));
    }

    // Uniform double in the open interval (0, 1) -- spec section 2.
    double next_uniform() {
        return (static_cast<double>(next_u32()) + 0.5) * kInvUint32Range;
    }

    // Standard normal draw via inverse CDF -- spec section 3.
    double next_normal() {
        return norminv(next_uniform());
    }

private:
    static constexpr std::uint64_t kMult = 6364136223846793005ULL;
    static constexpr double kInvUint32Range = 1.0 / 4294967296.0;
    std::uint64_t state_;
    std::uint64_t inc_;
};

}  // namespace quantkiller
