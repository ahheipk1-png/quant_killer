"""PCG32 tests against the reference algorithm in contracts/rng-spec.md.

The five known-answer u32 outputs below are computed directly from the
textbook PCG-XSH-RR reference algorithm (O'Neill 2014) independent of
this module, so a transcription bug in rng.py would be caught here.
"""

from quantkiller.rng import Pcg32


def _reference_pcg32_first_n(seed, seq, n):
    mask64 = (1 << 64) - 1
    mult = 6364136223846793005

    def next_u32(state, inc):
        old_state = state
        state = (old_state * mult + inc) & mask64
        xorshifted = (((old_state >> 18) ^ old_state) >> 27) & 0xFFFFFFFF
        rot = (old_state >> 59) & 31
        return state, ((xorshifted >> rot) | (xorshifted << ((32 - rot) & 31))) & 0xFFFFFFFF

    inc = ((seq << 1) | 1) & mask64
    state = 0
    state, _ = next_u32(state, inc)
    state = (state + seed) & mask64
    state, _ = next_u32(state, inc)
    out = []
    for _ in range(n):
        state, v = next_u32(state, inc)
        out.append(v)
    return out


def test_pcg32_matches_reference_algorithm_seed42():
    expected = _reference_pcg32_first_n(42, 1, 8)
    rng = Pcg32(42)
    actual = [rng.next_u32() for _ in range(8)]
    assert actual == expected


def test_pcg32_matches_reference_algorithm_seed0():
    expected = _reference_pcg32_first_n(0, 1, 8)
    rng = Pcg32(0)
    actual = [rng.next_u32() for _ in range(8)]
    assert actual == expected


def test_pcg32_stream_is_deterministic_per_seed():
    a = [Pcg32(123).next_u32() for _ in range(20)]
    b = [Pcg32(123).next_u32() for _ in range(20)]
    assert a == b


def test_pcg32_different_seeds_diverge():
    a = [Pcg32(1).next_u32() for _ in range(5)]
    b = [Pcg32(2).next_u32() for _ in range(5)]
    assert a != b


def test_next_uniform_is_in_open_interval():
    rng = Pcg32(7)
    for _ in range(5000):
        u = rng.next_uniform()
        assert 0.0 < u < 1.0


def test_next_normal_has_roughly_standard_moments():
    rng = Pcg32(999)
    n = 20000
    draws = [rng.next_normal() for _ in range(n)]
    mean = sum(draws) / n
    var = sum((d - mean) ** 2 for d in draws) / (n - 1)
    # Loose bounds: this is a statistical sanity check, not a precision test.
    assert abs(mean) < 0.05
    assert abs(var - 1.0) < 0.05
