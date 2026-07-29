# QuantKiller numeric spec (FROZEN)

This file defines the random-number generator and the special functions that **every language
implements identically**. Same seed ⇒ same random paths ⇒ Monte Carlo prices that agree across
Python, C++, C#, Java, and Rust to ~1e-12 (vector tolerance 1e-9).

Do **not** change anything here without regenerating every vector and updating all five
implementations in the same commit.

Reference outputs for everything below live in `vectors/rng.json` and
`vectors/math_functions.json` — port those tests first when adding a language.

---

## 1. PCG32 (PCG-XSH-RR 64/32) — the only RNG used anywhere

State: two unsigned 64-bit integers `state`, `inc`. All arithmetic is modulo 2^64
(wrapping). Reference: M. O'Neill, *PCG: A Family of Simple Fast Space-Efficient Statistically
Good Algorithms for Random Number Generation* (2014).

```text
MULT = 6364136223846793005          # 0x5851F42D4C957F2D

seed(initstate, initseq):           # QuantKiller default stream: initseq = 1
    state = 0
    inc   = (initseq << 1) | 1      # must be odd
    next_u32()
    state = state + initstate       # wrapping
    next_u32()

next_u32():                         # returns unsigned 32-bit
    old        = state
    state      = old * MULT + inc                     # wrapping mul/add mod 2^64
    xorshifted = uint32( ((old >> 18) XOR old) >> 27 )
    rot        = uint32( old >> 59 )                  # in [0, 31]
    return rotate_right_32(xorshifted, rot)
```

All shifts are **logical** (unsigned). Languages without native u64 (Java) use two's-complement
`long` — wrapping `*` and `+` are bit-identical; use `>>>` for shifts and
`Integer.rotateRight`.

A model that needs randomness takes a `seed` parameter and uses `seed(seed, 1)`.

**First five outputs of `seed(42, 1)`** (decimal u32): see `vectors/rng.json` (generated —
these are the canonical check).

## 2. Uniform doubles in (0, 1)

```text
next_uniform():  u = (next_u32() + 0.5) * 2^-32      # exactly: (x + 0.5) / 4294967296.0
```

Never 0, never 1, so it is always a valid input to the inverse normal CDF.

## 3. Standard normal draws — Acklam inverse CDF + one Halley refinement

`next_normal(): return norminv(next_uniform())`

`norminv(p)` for `p ∈ (0,1)`: P. J. Acklam's rational approximation, then **exactly one**
Halley refinement step (making it accurate to ~1e-15, and making the tiny coefficient
differences between typed-in copies irrelevant).

```text
Coefficients:
a1..a6 = -3.969683028665376e+01,  2.209460984245205e+02, -2.759285104469687e+02,
          1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00
b1..b5 = -5.447609879822406e+01,  1.615858368580409e+02, -1.556989798598866e+02,
          6.680131188771972e+01, -1.328068155288572e+01
c1..c6 = -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00
d1..d4 =  7.784695709041462e-03,  3.224671290700398e-01,  2.445134137142996e+00,
          3.754408661907416e+00

p_low = 0.02425, p_high = 1 - p_low

if p < p_low:            # lower tail
    q = sqrt(-2 ln p)
    x = (((((c1 q + c2) q + c3) q + c4) q + c5) q + c6) /
        ((((d1 q + d2) q + d3) q + d4) q + 1)
elif p <= p_high:        # central
    q = p - 0.5 ; r = q*q
    x = (((((a1 r + a2) r + a3) r + a4) r + a5) r + a6) q /
        (((((b1 r + b2) r + b3) r + b4) r + b5) r + 1)
else:                    # upper tail
    q = sqrt(-2 ln(1 - p))
    x = -(((((c1 q + c2) q + c3) q + c4) q + c5) q + c6) /
         ((((d1 q + d2) q + d3) q + d4) q + 1)

# One Halley step against the exact CDF (uses norm_cdf below):
e = norm_cdf(x) - p
u = e * sqrt(2π) * exp(x²/2)
x = x - u / (1 + x·u/2)
return x
```

## 4. norm_cdf — Hart/West double-precision cumulative normal

Reference: G. West, *Better approximations to cumulative normal functions*, Wilmott (2005),
Hart (1968) coefficients. Accurate to ~1e-15. **All languages use this — never the runtime's
own `erf`** (runtimes differ in the last bits; ours is identical everywhere).

```text
norm_cdf(x):
    xa = |x|
    if xa > 37:  tail = 0
    else:
        e = exp(-xa²/2)
        if xa < 7.07106781186547:
            num = 3.52624965998911e-02
            num = num*xa + 0.700383064443688
            num = num*xa + 6.37396220353165
            num = num*xa + 33.912866078383
            num = num*xa + 112.079291497871
            num = num*xa + 221.213596169931
            num = num*xa + 220.206867912376
            den = 8.83883476483184e-02
            den = den*xa + 1.75566716318264
            den = den*xa + 16.064177579207
            den = den*xa + 86.7807322029461
            den = den*xa + 296.564248779674
            den = den*xa + 637.333633378831
            den = den*xa + 793.826512519948
            den = den*xa + 440.413735824752
            tail = e * num / den
        else:
            b = xa + 0.65
            b = xa + 4/b
            b = xa + 3/b
            b = xa + 2/b
            b = xa + 1/b
            tail = e / (b * 2.506628274631)
    return (x > 0) ? 1 - tail : tail

norm_pdf(x) = exp(-x²/2) / sqrt(2π)      # sqrt(2π) = 2.506628274631000502415765...
```

The Python test suite cross-checks this implementation against `math.erf` on a dense grid
(agreement < 1e-14), so a typo in any port is caught by `vectors/math_functions.json`.

## 5. Monte Carlo conventions (deterministic across languages)

For GBM European MC (`monte_carlo_gbm`), with parameters `paths`, `seed`,
`antithetic` (bool):

```text
rng = seed(seed, 1)
disc = exp(-rate*time)
drift = (rate - div_yield - vol²/2) * time
volt  = vol * sqrt(time)
sum = 0 ; sumsq = 0
repeat i = 0 .. paths-1:                  # 'paths' = number of samples, in order
    z  = rng.next_normal()
    p1 = payoff( spot * exp(drift + volt*z) )
    if antithetic:
        p2 = payoff( spot * exp(drift - volt*z) )
        s  = (p1 + p2) / 2                # one sample = the pair average
    else:
        s  = p1
    sum   += s                            # plain left-to-right double accumulation
    sumsq += s*s
mean  = sum / paths
var   = (sumsq - paths*mean²) / (paths - 1)   # single-pass; if var < 0, use 0
price = disc * mean
std_error = disc * sqrt(var / paths)
```

No Kahan summation, no FMA-contracted expressions (`a*b + c` written as two operations),
no parallel reduction — the loop order **is** the spec.

## 6. Why tolerances are not zero

IEEE-754 requires correctly rounded `+ - * / sqrt`, but **not** `exp`, `log`, `pow` — each
language runtime ships its own libm with ≤1-ulp differences in the last bits. Identical
algorithms therefore agree to ~1e-13 relative, not bit-for-bit. Vector tolerances
(closed-form 1e-10, trees 1e-11, MC 1e-9) absorb exactly this and nothing more.
