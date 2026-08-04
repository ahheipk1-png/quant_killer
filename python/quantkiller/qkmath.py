"""Special functions per contracts/rng-spec.md (FROZEN).

norm_cdf : Hart (1968) / West (2005) double-precision cumulative normal.
norminv  : Acklam's rational approximation + one Halley refinement.

Every language implements these byte-for-byte the same, so we never depend
on the platform's own erf(), which differs in the last bits between runtimes.
"""

import math

SQRT_2PI = 2.5066282746310005  # sqrt(2*pi)


def norm_pdf(x: float) -> float:
    """Standard normal density φ(x)."""
    return math.exp(-0.5 * x * x) / SQRT_2PI


def norm_cdf(x: float) -> float:
    """Standard normal CDF N(x), accurate to ~1e-15 (Hart/West)."""
    xa = abs(x)
    if xa > 37.0:
        tail = 0.0
    else:
        e = math.exp(-0.5 * xa * xa)
        if xa < 7.07106781186547:
            num = 3.52624965998911e-02
            num = num * xa + 0.700383064443688
            num = num * xa + 6.37396220353165
            num = num * xa + 33.912866078383
            num = num * xa + 112.079291497871
            num = num * xa + 221.213596169931
            num = num * xa + 220.206867912376
            den = 8.83883476483184e-02
            den = den * xa + 1.75566716318264
            den = den * xa + 16.064177579207
            den = den * xa + 86.7807322029461
            den = den * xa + 296.564248779674
            den = den * xa + 637.333633378831
            den = den * xa + 793.826512519948
            den = den * xa + 440.413735824752
            tail = e * num / den
        else:
            b = xa + 0.65
            b = xa + 4.0 / b
            b = xa + 3.0 / b
            b = xa + 2.0 / b
            b = xa + 1.0 / b
            tail = e / (b * 2.506628274631)
    return 1.0 - tail if x > 0.0 else tail


# Acklam coefficients (see contracts/rng-spec.md §3)
_A = (-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00)
_B = (-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01)
_C = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00)
_D = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
      3.754408661907416e+00)

_P_LOW = 0.02425
_P_HIGH = 1.0 - _P_LOW


def norminv(p: float) -> float:
    """Inverse standard normal CDF for p in (0, 1)."""
    if not 0.0 < p < 1.0:
        raise ValueError(f"norminv requires 0 < p < 1, got {p}")

    if p < _P_LOW:
        q = math.sqrt(-2.0 * math.log(p))
        x = ((((( _C[0]*q + _C[1])*q + _C[2])*q + _C[3])*q + _C[4])*q + _C[5]) / \
            (((( _D[0]*q + _D[1])*q + _D[2])*q + _D[3])*q + 1.0)
    elif p <= _P_HIGH:
        q = p - 0.5
        r = q * q
        x = ((((( _A[0]*r + _A[1])*r + _A[2])*r + _A[3])*r + _A[4])*r + _A[5]) * q / \
            ((((( _B[0]*r + _B[1])*r + _B[2])*r + _B[3])*r + _B[4])*r + 1.0)
    else:
        q = math.sqrt(-2.0 * math.log(1.0 - p))
        x = -((((( _C[0]*q + _C[1])*q + _C[2])*q + _C[3])*q + _C[4])*q + _C[5]) / \
             (((( _D[0]*q + _D[1])*q + _D[2])*q + _D[3])*q + 1.0)

    # One Halley refinement against the exact CDF (spec §3).
    e = norm_cdf(x) - p
    u = e * SQRT_2PI * math.exp(0.5 * x * x)
    x = x - u / (1.0 + 0.5 * x * u)
    return x
