"""PCG32 (PCG-XSH-RR 64/32) per contracts/rng-spec.md (FROZEN).

Reference: M. O'Neill, "PCG: A Family of Simple Fast Space-Efficient
Statistically Good Algorithms for Random Number Generation" (2014).

Same seed => same stream in every QuantKiller language, which is what makes
Monte Carlo prices comparable across Python, C++, C#, Java and Rust.
"""

from .qkmath import norminv

_MASK64 = (1 << 64) - 1
_MULT = 6364136223846793005

# QuantKiller default stream (rng-spec.md §1)
DEFAULT_SEQ = 1


class Pcg32:
    __slots__ = ("state", "inc")

    def __init__(self, seed: int, seq: int = DEFAULT_SEQ):
        self.state = 0
        self.inc = ((seq << 1) | 1) & _MASK64
        self.next_u32()
        self.state = (self.state + seed) & _MASK64
        self.next_u32()

    def next_u32(self) -> int:
        old = self.state
        self.state = (old * _MULT + self.inc) & _MASK64
        xorshifted = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = (old >> 59) & 31
        return ((xorshifted >> rot) | (xorshifted << ((32 - rot) & 31))) & 0xFFFFFFFF

    def next_uniform(self) -> float:
        """Uniform double in the open interval (0, 1) — spec §2."""
        return (self.next_u32() + 0.5) * 2.0 ** -32

    def next_normal(self) -> float:
        """Standard normal draw via inverse CDF — spec §3."""
        return norminv(self.next_uniform())
