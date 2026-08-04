using System;

namespace QuantKiller.Core;

/// <summary>
/// Special functions per contracts/rng-spec.md (FROZEN). NormCdf/NormInv are
/// Hart(1968)/West(2005) and Acklam's rational approximations respectively,
/// implemented identically in every QuantKiller language rather than relying
/// on the platform's own erf (runtimes differ in the last bits).
/// </summary>
public static class QkMath
{
    public const double SqrtTwoPi = 2.5066282746310005;

    public static double NormPdf(double x) => Math.Exp(-0.5 * x * x) / SqrtTwoPi;

    public static double NormCdf(double x)
    {
        var absoluteX = Math.Abs(x);
        double tail;
        if (absoluteX > 37.0)
        {
            tail = 0.0;
        }
        else
        {
            var exponential = Math.Exp(-0.5 * absoluteX * absoluteX);
            if (absoluteX < 7.07106781186547)
            {
                var numerator = 3.52624965998911e-02;
                numerator = numerator * absoluteX + 0.700383064443688;
                numerator = numerator * absoluteX + 6.37396220353165;
                numerator = numerator * absoluteX + 33.912866078383;
                numerator = numerator * absoluteX + 112.079291497871;
                numerator = numerator * absoluteX + 221.213596169931;
                numerator = numerator * absoluteX + 220.206867912376;
                var denominator = 8.83883476483184e-02;
                denominator = denominator * absoluteX + 1.75566716318264;
                denominator = denominator * absoluteX + 16.064177579207;
                denominator = denominator * absoluteX + 86.7807322029461;
                denominator = denominator * absoluteX + 296.564248779674;
                denominator = denominator * absoluteX + 637.333633378831;
                denominator = denominator * absoluteX + 793.826512519948;
                denominator = denominator * absoluteX + 440.413735824752;
                tail = exponential * numerator / denominator;
            }
            else
            {
                var continuedFraction = absoluteX + 0.65;
                continuedFraction = absoluteX + 4.0 / continuedFraction;
                continuedFraction = absoluteX + 3.0 / continuedFraction;
                continuedFraction = absoluteX + 2.0 / continuedFraction;
                continuedFraction = absoluteX + 1.0 / continuedFraction;
                tail = exponential / (continuedFraction * 2.506628274631);
            }
        }
        return x > 0.0 ? 1.0 - tail : tail;
    }

    private static readonly double[] A =
        [-39.69683028665376, 220.9460984245205, -275.9285104469687,
         138.3577518672690, -30.66479806614716, 2.506628277459239];
    private static readonly double[] B =
        [-54.47609879822406, 161.5858368580409, -155.6989798598866,
         66.80131188771972, -13.28068155288572];
    private static readonly double[] C =
        [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
         -2.549732539343734, 4.374664141464968, 2.938163982698783];
    private static readonly double[] D =
        [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

    private const double PLow = 0.02425;
    private const double PHigh = 1.0 - PLow;

    /// <summary>Inverse standard normal CDF for p in (0, 1). Acklam + one Halley refinement.</summary>
    public static double NormInv(double p)
    {
        if (!(p > 0.0 && p < 1.0))
        {
            throw new ArgumentOutOfRangeException(nameof(p), $"NormInv requires 0 < p < 1, got {p}");
        }

        double x;
        if (p < PLow)
        {
            var q = Math.Sqrt(-2.0 * Math.Log(p));
            x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
                ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0);
        }
        else if (p <= PHigh)
        {
            var q = p - 0.5;
            var r = q * q;
            x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
                (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0);
        }
        else
        {
            var q = Math.Sqrt(-2.0 * Math.Log(1.0 - p));
            x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
                 ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0);
        }

        var error = NormCdf(x) - p;
        var correction = error * SqrtTwoPi * Math.Exp(0.5 * x * x);
        return x - correction / (1.0 + 0.5 * x * correction);
    }
}
