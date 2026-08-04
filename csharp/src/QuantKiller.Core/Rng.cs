namespace QuantKiller.Core;

/// <summary>PCG32 (PCG-XSH-RR 64/32) per contracts/rng-spec.md (FROZEN).</summary>
public struct Pcg32
{
    private const ulong Mult = 6364136223846793005UL;
    private ulong _state;
    private readonly ulong _inc;

    public Pcg32(ulong seed, ulong seq = 1)
    {
        _state = 0;
        _inc = unchecked((seq << 1) | 1);
        NextU32();
        _state = unchecked(_state + seed);
        NextU32();
    }

    public uint NextU32()
    {
        var old = _state;
        _state = unchecked(old * Mult + _inc);
        var xorshifted = (uint)(((old >> 18) ^ old) >> 27);
        var rot = (int)(old >> 59);
        return (xorshifted >> rot) | (xorshifted << ((32 - rot) & 31));
    }

    /// <summary>Uniform double in the open interval (0, 1) — spec section 2.</summary>
    public double NextUniform() => (NextU32() + 0.5) * 2.3283064365386963e-10; // 2^-32

    /// <summary>Standard normal draw via inverse CDF — spec section 3.</summary>
    public double NextNormal() => QkMath.NormInv(NextUniform());
}
