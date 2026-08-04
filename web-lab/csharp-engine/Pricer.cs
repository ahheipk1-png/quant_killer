using System;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;

namespace QuantKiller.Browser;

[SupportedOSPlatform("browser")]
public static partial class Pricer
{
    private const ulong PcgMultiplier = 6364136223846793005UL;
    private const double SqrtTwoPi = 2.5066282746310005;
    private const int MaxBinomialSteps = 2000;
    private const int MaxDistributionSamples = 5000;
    private const int RqmcReplications = 8;
    private static double _lastStandardError = double.NaN;
    private static double _lastStandardDeviation = double.NaN;
    private static readonly double[] DistributionTerminal = new double[MaxDistributionSamples];
    private static readonly double[] DistributionPayoff = new double[MaxDistributionSamples];

    private static int _distributionCount;
    private static readonly double[] A = [-39.69683028665376, 220.9460984245205,
        -275.9285104469687, 138.3577518672690, -30.66479806614716,
        2.506628277459239];
    private static readonly double[] B = [-54.47609879822406, 161.5858368580409,
        -155.6989798598866, 66.80131188771972, -13.28068155288572];
    private static readonly double[] C = [-0.007784894002430293, -0.3223964580411365,
        -2.400758277161838, -2.549732539343734, 4.374664141464968,
        2.938163982698783];
    private static readonly double[] D = [0.007784695709041462, 0.3224671290700398,
        2.445134137142996, 3.754408661907416];

    private struct Pcg32
    {
        private ulong _state;
        private readonly ulong _increment;

        public Pcg32(uint seed)
        {
            _state = 0;
            _increment = 3;
            NextUInt32();
            _state = unchecked(_state + seed);
            NextUInt32();
        }

        public uint NextUInt32()
        {
            var oldState = _state;
            _state = unchecked(oldState * PcgMultiplier + _increment);
            var xorshifted = (uint)(((oldState >> 18) ^ oldState) >> 27);
            var rotation = (int)(oldState >> 59);
            return (xorshifted >> rotation) | (xorshifted << ((32 - rotation) & 31));
        }

        public double NextUniform() => (NextUInt32() + 0.5) / 4294967296.0;
    }

    private static uint SobolUInt(uint index)
    {
        var gray = index ^ (index >> 1);
        uint value = 0;
        for (var bit = 0; bit < 32; bit++)
        {
            if ((gray & (1U << bit)) != 0)
            {
                value ^= 1U << (31 - bit);
            }
        }
        return value;
    }

    private static double SobolUniform(uint index, uint digitalShift) =>
        ((SobolUInt(index) ^ digitalShift) + 0.5) / 4294967296.0;

    private static double NormalCdf(double x)
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

    private static double NormalPdf(double x) => Math.Exp(-0.5 * x * x) / SqrtTwoPi;

    private static double InverseNormalCdf(double probability)
    {
        double x;
        if (probability < 0.02425)
        {
            var q = Math.Sqrt(-2.0 * Math.Log(probability));
            x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
                ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0);
        }
        else if (probability <= 0.97575)
        {
            var q = probability - 0.5;
            var r = q * q;
            x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
                (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0);
        }
        else
        {
            var q = Math.Sqrt(-2.0 * Math.Log(1.0 - probability));
            x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
                ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0);
        }
        var error = NormalCdf(x) - probability;
        var correction = error * SqrtTwoPi * Math.Exp(0.5 * x * x);
        return x - correction / (1.0 + 0.5 * x * correction);
    }

    private static bool ValidCommonInputs(
        double spot, double strike, double volatility, double maturity) =>
        spot > 0.0 && strike > 0.0 && volatility >= 0.0 && maturity > 0.0;

    private static double Payoff(double terminalSpot, double strike, bool isCall) =>
        isCall ? Math.Max(terminalSpot - strike, 0.0) : Math.Max(strike - terminalSpot, 0.0);

    private static double DeterministicPrice(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double maturity,
        bool isCall)
    {
        var terminalSpot = spot * Math.Exp((rate - dividendYield) * maturity);
        return Math.Exp(-rate * maturity) * Payoff(terminalSpot, strike, isCall);
    }

    private static double BlackScholesInternal(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        bool isCall)
    {
        if (volatility == 0.0)
        {
            return DeterministicPrice(spot, strike, rate, dividendYield, maturity, isCall);
        }
        var rootT = Math.Sqrt(maturity);
        var d1 = (Math.Log(spot / strike) +
            (rate - dividendYield + 0.5 * volatility * volatility) * maturity) /
            (volatility * rootT);
        var d2 = d1 - volatility * rootT;
        var discountedSpot = spot * Math.Exp(-dividendYield * maturity);
        var discountedStrike = strike * Math.Exp(-rate * maturity);
        return isCall
            ? discountedSpot * NormalCdf(d1) - discountedStrike * NormalCdf(d2)
            : discountedStrike * NormalCdf(-d2) - discountedSpot * NormalCdf(-d1);
    }

    private static (double Boundary, double Exponent) BawCriticalPrice(
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        bool isCall)
    {
        var variance = volatility * volatility * maturity;
        var rootVariance = Math.Sqrt(variance);
        var riskFreeDiscount = Math.Exp(-rate * maturity);
        var dividendDiscount = Math.Exp(-dividendYield * maturity);
        var n = 2.0 * Math.Log(dividendDiscount / riskFreeDiscount) / variance;
        var m = -2.0 * Math.Log(riskFreeDiscount) / variance;
        var carryTime = Math.Log(dividendDiscount / riskFreeDiscount);
        double upperExponent;
        double upper;
        double boundary;
        if (isCall)
        {
            upperExponent = (-(n - 1.0) + Math.Sqrt((n - 1.0) * (n - 1.0) + 4.0 * m)) / 2.0;
            upper = strike / (1.0 - 1.0 / upperExponent);
            var h = -(carryTime + 2.0 * rootVariance) * strike / (upper - strike);
            boundary = strike + (upper - strike) * (1.0 - Math.Exp(h));
        }
        else
        {
            upperExponent = (-(n - 1.0) - Math.Sqrt((n - 1.0) * (n - 1.0) + 4.0 * m)) / 2.0;
            upper = strike / (1.0 - 1.0 / upperExponent);
            var h = (carryTime - 2.0 * rootVariance) * strike / (strike - upper);
            boundary = upper + (strike - upper) * Math.Exp(h);
        }
        var coefficient = Math.Abs(1.0 - riskFreeDiscount) > 1.0e-12
            ? -2.0 * Math.Log(riskFreeDiscount) / (variance * (1.0 - riskFreeDiscount))
            : 2.0 / variance;
        var exponent = isCall
            ? (-(n - 1.0) + Math.Sqrt((n - 1.0) * (n - 1.0) + 4.0 * coefficient)) / 2.0
            : (-(n - 1.0) - Math.Sqrt((n - 1.0) * (n - 1.0) + 4.0 * coefficient)) / 2.0;

        for (var iteration = 0; iteration < 100; iteration++)
        {
            var forwardBoundary = boundary * dividendDiscount / riskFreeDiscount;
            var d1 = (Math.Log(forwardBoundary / strike) + 0.5 * variance) / rootVariance;
            var european = BlackScholesInternal(
                boundary, strike, rate, dividendYield, volatility, maturity, isCall);
            if (isCall)
            {
                var lhs = boundary - strike;
                var rhs = european + (1.0 - dividendDiscount * NormalCdf(d1)) * boundary / exponent;
                var slope = dividendDiscount * NormalCdf(d1) * (1.0 - 1.0 / exponent) +
                    (1.0 - dividendDiscount * NormalPdf(d1) / rootVariance) / exponent;
                if (Math.Abs(lhs - rhs) / strike <= 1.0e-8) break;
                boundary = (strike + rhs - slope * boundary) / (1.0 - slope);
            }
            else
            {
                var lhs = strike - boundary;
                var rhs = european - (1.0 - dividendDiscount * NormalCdf(-d1)) * boundary / exponent;
                var slope = -dividendDiscount * NormalCdf(-d1) * (1.0 - 1.0 / exponent) -
                    (1.0 + dividendDiscount * NormalPdf(-d1) / rootVariance) / exponent;
                if (Math.Abs(lhs - rhs) / strike <= 1.0e-8) break;
                boundary = (strike - rhs + slope * boundary) / (1.0 + slope);
            }
        }
        return (boundary, exponent);
    }

    private static double BaroneAdesiWhaleyInternal(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        bool isCall)
    {
        var european = BlackScholesInternal(
            spot, strike, rate, dividendYield, volatility, maturity, isCall);
        var intrinsic = Payoff(spot, strike, isCall);
        if (volatility == 0.0 || (isCall && dividendYield <= 0.0))
        {
            return Math.Max(european, intrinsic);
        }
        var (boundary, exponent) = BawCriticalPrice(
            strike, rate, dividendYield, volatility, maturity, isCall);
        var variance = volatility * volatility * maturity;
        var d1 = (Math.Log(
            boundary * Math.Exp((rate - dividendYield) * maturity) / strike)
            + 0.5 * variance) / Math.Sqrt(variance);
        var dividendDiscount = Math.Exp(-dividendYield * maturity);
        double value;
        if (isCall)
        {
            var coefficient = boundary / exponent *
                (1.0 - dividendDiscount * NormalCdf(d1));
            value = spot < boundary
                ? european + coefficient * Math.Pow(spot / boundary, exponent)
                : intrinsic;
        }
        else
        {
            var coefficient = -boundary / exponent *
                (1.0 - dividendDiscount * NormalCdf(-d1));
            value = spot > boundary
                ? european + coefficient * Math.Pow(spot / boundary, exponent)
                : intrinsic;
        }
        return Math.Max(value, Math.Max(european, intrinsic));
    }

    private static double JuZhongInternal(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        bool isCall)
    {
        var european = BlackScholesInternal(
            spot, strike, rate, dividendYield, volatility, maturity, isCall);
        var intrinsic = Payoff(spot, strike, isCall);
        if (volatility == 0.0 || (isCall && dividendYield <= 0.0))
            return Math.Max(european, intrinsic);
        if (Math.Abs(rate) < 1e-9)
            return BaroneAdesiWhaleyInternal(
                spot, strike, rate, dividendYield, volatility, maturity, isCall);
        var (boundary, _) = BawCriticalPrice(
            strike, rate, dividendYield, volatility, maturity, isCall);
        var phi = isCall ? 1.0 : -1.0;
        var variance = volatility * volatility * maturity;
        var rootVariance = Math.Sqrt(variance);
        var riskFreeDiscount = Math.Exp(-rate * maturity);
        var dividendDiscount = Math.Exp(-dividendYield * maturity);
        var h = 1.0 - riskFreeDiscount;
        var alpha = -2.0 * Math.Log(riskFreeDiscount) / variance;
        var beta = 2.0 * Math.Log(dividendDiscount / riskFreeDiscount) / variance;
        var radical = Math.Sqrt((beta - 1.0) * (beta - 1.0) + 4.0 * alpha / h);
        var exponent = (-(beta - 1.0) + phi * radical) / 2.0;
        var exponentPrime = -phi * alpha / (h * h * radical);
        var europeanBoundary = BlackScholesInternal(
            boundary, strike, rate, dividendYield, volatility, maturity, isCall);
        var premiumBoundary = phi * (boundary - strike) - europeanBoundary;
        var denominator = 2.0 * exponent + beta - 1.0;
        if (Math.Abs(premiumBoundary) < 1e-12 || Math.Abs(denominator) < 1e-12)
            return BaroneAdesiWhaleyInternal(
                spot, strike, rate, dividendYield, volatility, maturity, isCall);
        var forwardBoundary = boundary * dividendDiscount / riskFreeDiscount;
        var d1 = (Math.Log(forwardBoundary / strike) + 0.5 * variance) / rootVariance;
        var d2 = d1 - rootVariance;
        var europeanH = forwardBoundary * NormalPdf(d1) / (alpha * rootVariance)
            - phi * forwardBoundary * NormalCdf(phi * d1)
                * Math.Log(dividendDiscount) / Math.Log(riskFreeDiscount)
            + phi * strike * NormalCdf(phi * d2);
        var quadratic = (1.0 - h) * alpha * exponentPrime / (2.0 * denominator);
        var linear = -(1.0 - h) * alpha / denominator
            * (europeanH / premiumBoundary + 1.0 / h + exponentPrime / denominator);
        var logRatio = Math.Log(spot / boundary);
        var chi = logRatio * (quadratic * logRatio + linear);
        if (!double.IsFinite(chi) || Math.Abs(1.0 - chi) <= 1e-8)
            return BaroneAdesiWhaleyInternal(
                spot, strike, rate, dividendYield, volatility, maturity, isCall);
        var value = phi * (boundary - spot) > 0.0
            ? european + premiumBoundary * Math.Pow(spot / boundary, exponent) / (1.0 - chi)
            : intrinsic;
        return Math.Max(value, Math.Max(european, intrinsic));
    }

    private static double BjerksundPhi(
        double spot,
        double gamma,
        double boundary,
        double trigger,
        double rateTime,
        double carryTime,
        double variance)
    {
        var rootVariance = Math.Sqrt(variance);
        var lambda = -rateTime + gamma * carryTime +
            0.5 * gamma * (gamma - 1.0) * variance;
        var d = -(Math.Log(spot / boundary) + carryTime +
            (gamma - 0.5) * variance) / rootVariance;
        var kappa = 2.0 * carryTime / variance + 2.0 * gamma - 1.0;
        return Math.Exp(lambda) * (
            NormalCdf(d) - Math.Pow(trigger / spot, kappa) *
            NormalCdf(d - 2.0 * Math.Log(trigger / spot) / rootVariance));
    }

    private static double BjerksundCall(
        double spot,
        double strike,
        double riskFreeDiscount,
        double dividendDiscount,
        double variance)
    {
        var rateTime = Math.Log(1.0 / riskFreeDiscount);
        var carryTime = Math.Log(dividendDiscount / riskFreeDiscount);
        var european = BlackScholesInternal(
            spot, strike, rateTime, rateTime - carryTime, Math.Sqrt(variance), 1.0, true);
        var intrinsic = Payoff(spot, strike, true);
        if (dividendDiscount >= 1.0 && dividendDiscount >= riskFreeDiscount)
        {
            return Math.Max(european, intrinsic);
        }
        var beta = 0.5 - carryTime / variance + Math.Sqrt(
            Math.Pow(carryTime / variance - 0.5, 2.0) + 2.0 * rateTime / variance);
        if (beta <= 1.0) return Math.Max(european, intrinsic);
        var boundaryInfinity = beta / (beta - 1.0) * strike;
        var boundaryZero = Math.Abs(carryTime - rateTime) < 1.0e-14
            ? strike
            : Math.Max(strike, rateTime / (rateTime - carryTime) * strike);
        var h = -(carryTime + 2.0 * Math.Sqrt(variance)) * boundaryZero /
            (boundaryInfinity - boundaryZero);
        var boundary = boundaryZero + (boundaryInfinity - boundaryZero) *
            (1.0 - Math.Exp(h));
        var forward = spot * dividendDiscount / riskFreeDiscount;
        if (spot >= boundary) return intrinsic;
        if (Math.Log(boundary / forward) / Math.Sqrt(variance) > 12.5)
        {
            return Math.Max(european, intrinsic);
        }
        var value = (boundary - strike) * Math.Pow(spot / boundary, beta) *
            (1.0 - BjerksundPhi(spot, beta, boundary, boundary, rateTime, carryTime, variance))
            + spot * BjerksundPhi(spot, 1.0, boundary, boundary, rateTime, carryTime, variance)
            - spot * BjerksundPhi(spot, 1.0, strike, boundary, rateTime, carryTime, variance)
            - strike * BjerksundPhi(spot, 0.0, boundary, boundary, rateTime, carryTime, variance)
            + strike * BjerksundPhi(spot, 0.0, strike, boundary, rateTime, carryTime, variance);
        return Math.Max(value, Math.Max(european, intrinsic));
    }

    private static double BjerksundStenslandInternal(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        bool isCall)
    {
        var european = BlackScholesInternal(
            spot, strike, rate, dividendYield, volatility, maturity, isCall);
        var intrinsic = Payoff(spot, strike, isCall);
        if (volatility == 0.0) return Math.Max(european, intrinsic);
        var riskFreeDiscount = Math.Exp(-rate * maturity);
        var dividendDiscount = Math.Exp(-dividendYield * maturity);
        var variance = volatility * volatility * maturity;
        var value = isCall
            ? BjerksundCall(spot, strike, riskFreeDiscount, dividendDiscount, variance)
            : BjerksundCall(strike, spot, dividendDiscount, riskFreeDiscount, variance);
        return Math.Max(value, Math.Max(european, intrinsic));
    }

    private static double BivariateNormalCdf(
        double first, double second, double correlation)
    {
        if (first <= -10.0 || second <= -10.0) return 0.0;
        if (first >= 10.0) return NormalCdf(second);
        if (second >= 10.0) return NormalCdf(first);
        if (Math.Abs(correlation) < 1.0e-14)
        {
            return NormalCdf(first) * NormalCdf(second);
        }
        const int intervals = 512;
        const double lower = -10.0;
        var upper = Math.Min(first, 10.0);
        var width = (upper - lower) / intervals;
        var correlationScale = Math.Sqrt(1.0 - correlation * correlation);
        double Integrand(double value) => NormalPdf(value) *
            NormalCdf((second - correlation * value) / correlationScale);
        var total = Integrand(lower) + Integrand(upper);
        for (var index = 1; index < intervals; index++)
        {
            total += (index % 2 == 0 ? 2.0 : 4.0) *
                Integrand(lower + index * width);
        }
        return Math.Min(Math.Max(total * width / 3.0, 0.0), 1.0);
    }

    private static double Bjerksund2002Phi(
        double spot,
        double horizon,
        double gamma,
        double cap,
        double trigger,
        double rate,
        double carry,
        double volatility)
    {
        var variance = volatility * volatility;
        var denominator = volatility * Math.Sqrt(horizon);
        var lambda = -rate + gamma * carry +
            0.5 * gamma * (gamma - 1.0) * variance;
        var kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
        var drift = (carry + (gamma - 0.5) * variance) * horizon;
        var d1 = -(Math.Log(spot / cap) + drift) / denominator;
        var d2 = d1 - 2.0 * Math.Log(trigger / spot) / denominator;
        return Math.Exp(lambda * horizon) * Math.Pow(spot, gamma) * (
            NormalCdf(d1) - Math.Pow(trigger / spot, kappa) * NormalCdf(d2));
    }

    private static double Bjerksund2002Psi(
        double spot,
        double maturity,
        double gamma,
        double cap,
        double firstBoundary,
        double secondBoundary,
        double splitTime,
        double rate,
        double carry,
        double volatility)
    {
        var variance = volatility * volatility;
        var lambda = -rate + gamma * carry +
            0.5 * gamma * (gamma - 1.0) * variance;
        var kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
        var gammaCarry = carry + (gamma - 0.5) * variance;
        var shortScale = volatility * Math.Sqrt(splitTime);
        var fullScale = volatility * Math.Sqrt(maturity);
        var shortDrift = gammaCarry * splitTime;
        var fullDrift = gammaCarry * maturity;
        var correlation = Math.Sqrt(splitTime / maturity);
        var d1 = -(Math.Log(spot / secondBoundary) + shortDrift) / shortScale;
        var d2 = -(Math.Log(firstBoundary * firstBoundary /
            (spot * secondBoundary)) + shortDrift) / shortScale;
        var d3 = -(Math.Log(spot / secondBoundary) - shortDrift) / shortScale;
        var d4 = -(Math.Log(firstBoundary * firstBoundary /
            (spot * secondBoundary)) - shortDrift) / shortScale;
        var e1 = -(Math.Log(spot / cap) + fullDrift) / fullScale;
        var e2 = -(Math.Log(firstBoundary * firstBoundary / (spot * cap))
            + fullDrift) / fullScale;
        var e3 = -(Math.Log(secondBoundary * secondBoundary / (spot * cap))
            + fullDrift) / fullScale;
        var e4 = -(Math.Log(spot * secondBoundary * secondBoundary /
            (cap * firstBoundary * firstBoundary)) + fullDrift) / fullScale;
        var value = BivariateNormalCdf(d1, e1, correlation)
            - Math.Pow(firstBoundary / spot, kappa) *
                BivariateNormalCdf(d2, e2, correlation)
            - Math.Pow(secondBoundary / spot, kappa) *
                BivariateNormalCdf(d3, e3, -correlation)
            + Math.Pow(secondBoundary / firstBoundary, kappa) *
                BivariateNormalCdf(d4, e4, -correlation);
        return Math.Exp(lambda * maturity) * Math.Pow(spot, gamma) * value;
    }

    private static double Bjerksund2002Call(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity)
    {
        var european = BlackScholesInternal(
            spot, strike, rate, dividendYield, volatility, maturity, true);
        var intrinsic = Payoff(spot, strike, true);
        var carry = rate - dividendYield;
        if (volatility == 0.0 || carry >= rate)
        {
            return Math.Max(european, intrinsic);
        }
        var variance = volatility * volatility;
        var beta = 0.5 - carry / variance + Math.Sqrt(
            Math.Pow(carry / variance - 0.5, 2.0) + 2.0 * rate / variance);
        if (beta <= 1.0) return Math.Max(european, intrinsic);
        var boundaryInfinity = beta / (beta - 1.0) * strike;
        var boundaryZero = Math.Max(strike, rate / (rate - carry) * strike);
        double Boundary(double horizon)
        {
            var h = -(carry * horizon + 2.0 * volatility * Math.Sqrt(horizon)) *
                strike * strike /
                ((boundaryInfinity - boundaryZero) * boundaryZero);
            return boundaryZero + (boundaryInfinity - boundaryZero) *
                (1.0 - Math.Exp(h));
        }
        var splitTime = 0.5 * (Math.Sqrt(5.0) - 1.0) * maturity;
        var firstBoundary = Boundary(maturity);
        var secondBoundary = Boundary(maturity - splitTime);
        if (spot >= firstBoundary) return intrinsic;
        var alphaFirst = (firstBoundary - strike) * Math.Pow(firstBoundary, -beta);
        var alphaSecond = (secondBoundary - strike) * Math.Pow(secondBoundary, -beta);
        var value = alphaFirst * Math.Pow(spot, beta)
            - alphaFirst * Bjerksund2002Phi(
                spot, splitTime, beta, firstBoundary, firstBoundary,
                rate, carry, volatility)
            + Bjerksund2002Phi(
                spot, splitTime, 1.0, firstBoundary, firstBoundary,
                rate, carry, volatility)
            - Bjerksund2002Phi(
                spot, splitTime, 1.0, secondBoundary, firstBoundary,
                rate, carry, volatility)
            - strike * Bjerksund2002Phi(
                spot, splitTime, 0.0, firstBoundary, firstBoundary,
                rate, carry, volatility)
            + strike * Bjerksund2002Phi(
                spot, splitTime, 0.0, secondBoundary, firstBoundary,
                rate, carry, volatility)
            + alphaSecond * Bjerksund2002Phi(
                spot, splitTime, beta, secondBoundary, firstBoundary,
                rate, carry, volatility)
            - alphaSecond * Bjerksund2002Psi(
                spot, maturity, beta, secondBoundary, firstBoundary,
                secondBoundary, splitTime, rate, carry, volatility)
            + Bjerksund2002Psi(
                spot, maturity, 1.0, secondBoundary, firstBoundary,
                secondBoundary, splitTime, rate, carry, volatility)
            - Bjerksund2002Psi(
                spot, maturity, 1.0, strike, firstBoundary,
                secondBoundary, splitTime, rate, carry, volatility)
            - strike * Bjerksund2002Psi(
                spot, maturity, 0.0, secondBoundary, firstBoundary,
                secondBoundary, splitTime, rate, carry, volatility)
            + strike * Bjerksund2002Psi(
                spot, maturity, 0.0, strike, firstBoundary,
                secondBoundary, splitTime, rate, carry, volatility);
        return Math.Max(value, Math.Max(european, intrinsic));
    }

    private static double BjerksundStensland2002Internal(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        bool isCall)
    {
        var european = BlackScholesInternal(
            spot, strike, rate, dividendYield, volatility, maturity, isCall);
        var intrinsic = Payoff(spot, strike, isCall);
        var value = isCall
            ? Bjerksund2002Call(
                spot, strike, rate, dividendYield, volatility, maturity)
            : Bjerksund2002Call(
                strike, spot, dividendYield, rate, volatility, maturity);
        return Math.Max(value, Math.Max(european, intrinsic));
    }

    private static double CarrRandomizationCore(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int phases,
        bool isCall)
    {
        const int gridPoints = 501;
        var intrinsic = Payoff(spot, strike, isCall);
        if (volatility == 0.0)
        {
            return Math.Max(intrinsic, DeterministicPrice(
                spot, strike, rate, dividendYield, maturity, isCall));
        }
        if (isCall && dividendYield == 0.0)
        {
            return BlackScholesInternal(
                spot, strike, rate, dividendYield, volatility, maturity, true);
        }
        var drift = rate - dividendYield - 0.5 * volatility * volatility;
        var halfWidth = Math.Max(2.0, Math.Max(
            Math.Abs(Math.Log(strike / spot)) + 1.5,
            5.0 * volatility * Math.Sqrt(maturity) + Math.Abs(drift) * maturity));
        var xMin = Math.Log(spot) - halfWidth;
        var dx = 2.0 * halfWidth / gridPoints;
        var exercise = new double[gridPoints + 1];
        for (var index = 0; index <= gridPoints; index++)
        {
            exercise[index] = Payoff(Math.Exp(xMin + index * dx), strike, isCall);
        }
        var previous = (double[])exercise.Clone();
        var current = new double[gridPoints + 1];
        var intensity = phases / maturity;
        var diffusion = 0.5 * volatility * volatility / (dx * dx);
        var lowerGenerator = diffusion - drift / (2.0 * dx);
        var upperGenerator = diffusion + drift / (2.0 * dx);
        if (lowerGenerator < 0.0 || upperGenerator < 0.0)
        {
            lowerGenerator = diffusion + Math.Max(-drift, 0.0) / dx;
            upperGenerator = diffusion + Math.Max(drift, 0.0) / dx;
        }
        var lower = -lowerGenerator;
        var upper = -upperGenerator;
        var diagonal = rate + intensity + lowerGenerator + upperGenerator;
        for (var phase = 0; phase < phases; phase++)
        {
            Array.Copy(previous, current, previous.Length);
            current[0] = isCall ? 0.0 : exercise[0];
            current[gridPoints] = isCall ? exercise[gridPoints] : 0.0;
            for (var iteration = 0; iteration < 10000; iteration++)
            {
                var maximumChange = 0.0;
                for (var index = 1; index < gridPoints; index++)
                {
                    var continuation = (intensity * previous[index]
                        - lower * current[index - 1]
                        - upper * current[index + 1]) / diagonal;
                    var relaxed = current[index] + 1.2 * (continuation - current[index]);
                    var updated = Math.Max(exercise[index], relaxed);
                    maximumChange = Math.Max(maximumChange, Math.Abs(updated - current[index]));
                    current[index] = updated;
                }
                if (maximumChange < 1.0e-10) break;
            }
            (previous, current) = (current, previous);
        }
        var gridPosition = (Math.Log(spot) - xMin) / dx;
        var left = Math.Clamp((int)Math.Floor(gridPosition), 0, gridPoints - 1);
        var weight = gridPosition - left;
        return previous[left] * (1.0 - weight) + previous[left + 1] * weight;
    }

    [JSExport]
    public static double Price(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int paths,
        double seed,
        int isCall,
        int samplingMode,
        int varianceMode)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) || paths < 2 ||
            samplingMode < 0 || samplingMode > 2 || varianceMode < 0 || varianceMode > 3 ||
            (samplingMode == 2 && paths < RqmcReplications))
        {
            _lastStandardError = double.NaN;
            _lastStandardDeviation = double.NaN;
            return double.NaN;
        }

        var useAntithetic = varianceMode is 1 or 3;
        var useControl = varianceMode is 2 or 3;
        var replications = samplingMode == 2 ? RqmcReplications : 1;
        var discount = Math.Exp(-rate * maturity);
        var drift = (rate - dividendYield - 0.5 * volatility * volatility) * maturity;
        var diffusion = volatility * Math.Sqrt(maturity);
        var expectedControl = spot * Math.Exp(-dividendYield * maturity);
        var rng = new Pcg32((uint)seed);

        var sumX = 0.0;
        var sumY = 0.0;
        var sumXSquared = 0.0;
        var sumYSquared = 0.0;
        var sumXY = 0.0;
        var replicationX = new double[RqmcReplications];
        var replicationY = new double[RqmcReplications];
        var replicationCounts = new int[RqmcReplications];

        for (var replication = 0; replication < replications; replication++)
        {
            var localPaths = paths / replications + (replication < paths % replications ? 1 : 0);
            var digitalShift = samplingMode == 2 ? rng.NextUInt32() : 0U;
            replicationCounts[replication] = localPaths;
            for (var path = 0; path < localPaths; path++)
            {
                var uniform = samplingMode == 0
                    ? rng.NextUniform()
                    : SobolUniform((uint)path + 1U, digitalShift);
                var z = InverseNormalCdf(uniform);
                var firstTerminal = spot * Math.Exp(drift + diffusion * z);
                var sampleX = discount * Payoff(firstTerminal, strike, isCall != 0);
                var sampleY = discount * firstTerminal;
                if (useAntithetic)
                {
                    var secondTerminal = spot * Math.Exp(drift - diffusion * z);
                    sampleX = 0.5 * (sampleX + discount * Payoff(secondTerminal, strike, isCall != 0));
                    sampleY = 0.5 * (sampleY + discount * secondTerminal);
                }
                sumX += sampleX;
                sumY += sampleY;
                sumXSquared += sampleX * sampleX;
                sumYSquared += sampleY * sampleY;
                sumXY += sampleX * sampleY;
                replicationX[replication] += sampleX;
                replicationY[replication] += sampleY;
            }
        }

        var pathCount = (double)paths;
        var beta = 0.0;
        if (useControl)
        {
            var controlVariation = sumYSquared - sumY * sumY / pathCount;
            if (controlVariation > 1.0e-18)
            {
                beta = (sumXY - sumX * sumY / pathCount) / controlVariation;
            }
        }
        var sumZ = sumX - beta * (sumY - pathCount * expectedControl);
        var sumZSquared = sumXSquared + beta * beta *
            (sumYSquared - 2.0 * expectedControl * sumY + pathCount * expectedControl * expectedControl) -
            2.0 * beta * (sumXY - expectedControl * sumX);
        var mean = sumZ / pathCount;
        var variance = Math.Max(
            (sumZSquared - pathCount * mean * mean) / (pathCount - 1.0), 0.0);
        _lastStandardDeviation = Math.Sqrt(variance);

        if (samplingMode == 2)
        {
            var estimates = new double[RqmcReplications];
            var replicationMean = 0.0;
            for (var replication = 0; replication < replications; replication++)
            {
                var count = (double)replicationCounts[replication];
                estimates[replication] = replicationX[replication] / count -
                    beta * (replicationY[replication] / count - expectedControl);
                replicationMean += estimates[replication];
            }
            replicationMean /= replications;
            var replicationVariance = 0.0;
            for (var replication = 0; replication < replications; replication++)
            {
                var difference = estimates[replication] - replicationMean;
                replicationVariance += difference * difference;
            }
            replicationVariance /= replications - 1;
            _lastStandardError = Math.Sqrt(replicationVariance / replications);
        }
        else
        {
            _lastStandardError = _lastStandardDeviation / Math.Sqrt(pathCount);
        }
        return mean;
    }

    [JSExport]
    public static double LastStandardError() => _lastStandardError;

    [JSExport]
    public static double LastStandardDeviation() => _lastStandardDeviation;

    [JSExport]
    public static int GenerateDistribution(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int sampleCount,
        double seed,
        int isCall,
        int samplingMode)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) ||
            sampleCount < 1 || samplingMode < 0 || samplingMode > 2)
        {
            _distributionCount = 0;
            return 0;
        }
        _distributionCount = Math.Min(sampleCount, MaxDistributionSamples);
        var rng = new Pcg32((uint)seed);
        var digitalShift = samplingMode == 2 ? rng.NextUInt32() : 0U;
        var drift = (rate - dividendYield - 0.5 * volatility * volatility) * maturity;
        var diffusion = volatility * Math.Sqrt(maturity);
        for (var index = 0; index < _distributionCount; index++)
        {
            var uniform = samplingMode == 0
                ? rng.NextUniform()
                : SobolUniform((uint)index + 1U, digitalShift);
            var terminal = spot * Math.Exp(drift + diffusion * InverseNormalCdf(uniform));
            DistributionTerminal[index] = terminal;
            DistributionPayoff[index] = Payoff(terminal, strike, isCall != 0);
        }
        return _distributionCount;
    }

    [JSExport]
    public static double DistributionTerminalAt(int index) =>
        index >= 0 && index < _distributionCount ? DistributionTerminal[index] : double.NaN;

    [JSExport]
    public static double DistributionPayoffAt(int index) =>
        index >= 0 && index < _distributionCount ? DistributionPayoff[index] : double.NaN;

    [JSExport]
    public static double BlackScholes(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int isCall)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity)) return double.NaN;
        if (volatility == 0.0)
        {
            return DeterministicPrice(spot, strike, rate, dividendYield, maturity, isCall != 0);
        }
        var rootT = Math.Sqrt(maturity);
        var d1 = (Math.Log(spot / strike) +
            (rate - dividendYield + 0.5 * volatility * volatility) * maturity) /
            (volatility * rootT);
        var d2 = d1 - volatility * rootT;
        var discountedSpot = spot * Math.Exp(-dividendYield * maturity);
        var discountedStrike = strike * Math.Exp(-rate * maturity);
        return isCall != 0
            ? discountedSpot * NormalCdf(d1) - discountedStrike * NormalCdf(d2)
            : discountedStrike * NormalCdf(-d2) - discountedSpot * NormalCdf(-d1);
    }

    [JSExport]
    public static double BaroneAdesiWhaley(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int isCall)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) ||
            rate < 0.0 || dividendYield < 0.0)
        {
            return double.NaN;
        }
        return BaroneAdesiWhaleyInternal(
            spot, strike, rate, dividendYield, volatility, maturity, isCall != 0);
    }

    [JSExport]
    public static double JuZhong(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int isCall)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) ||
            rate < 0.0 || dividendYield < 0.0)
        {
            return double.NaN;
        }
        return JuZhongInternal(
            spot, strike, rate, dividendYield, volatility, maturity, isCall != 0);
    }

    [JSExport]
    public static double CarrRandomization(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int phases,
        int isCall)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) ||
            rate < 0.0 || dividendYield < 0.0 || phases < 4 || phases > 256)
        {
            return double.NaN;
        }
        var call = isCall != 0;
        var coarse = CarrRandomizationCore(
            spot, strike, rate, dividendYield, volatility, maturity, phases, call);
        var fine = CarrRandomizationCore(
            spot, strike, rate, dividendYield, volatility, maturity, 2 * phases, call);
        return Math.Clamp(2.0 * fine - coarse, Payoff(spot, strike, call), call ? spot : strike);
    }

    [JSExport]
    public static double BjerksundStensland(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int isCall)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) ||
            rate < 0.0 || dividendYield < 0.0)
        {
            return double.NaN;
        }
        return BjerksundStenslandInternal(
            spot, strike, rate, dividendYield, volatility, maturity, isCall != 0);
    }

    [JSExport]
    public static double BjerksundStensland2002(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int isCall)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) ||
            rate < 0.0 || dividendYield < 0.0)
        {
            return double.NaN;
        }
        return BjerksundStensland2002Internal(
            spot, strike, rate, dividendYield, volatility, maturity, isCall != 0);
    }

    [JSExport]
    public static double Binomial(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int steps,
        int isCall)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) ||
            steps < 1 || steps > MaxBinomialSteps) return double.NaN;
        if (volatility == 0.0)
        {
            return DeterministicPrice(spot, strike, rate, dividendYield, maturity, isCall != 0);
        }
        var dt = maturity / steps;
        var up = Math.Exp(volatility * Math.Sqrt(dt));
        var down = 1.0 / up;
        var probability = (Math.Exp((rate - dividendYield) * dt) - down) / (up - down);
        if (probability < 0.0 || probability > 1.0) return double.NaN;
        var discount = Math.Exp(-rate * dt);
        var upOverDown = up / down;
        var terminalSpot = spot * Math.Pow(down, steps);
        var values = new double[steps + 1];
        for (var node = 0; node <= steps; node++)
        {
            values[node] = Payoff(terminalSpot, strike, isCall != 0);
            terminalSpot *= upOverDown;
        }
        for (var level = steps - 1; level >= 0; level--)
        {
            for (var node = 0; node <= level; node++)
            {
                values[node] = discount *
                    (probability * values[node + 1] + (1.0 - probability) * values[node]);
            }
        }
        return values[0];
    }

    [JSExport]
    public static double AmericanBinomial(
        double spot,
        double strike,
        double rate,
        double dividendYield,
        double volatility,
        double maturity,
        int steps,
        int isCall)
    {
        if (!ValidCommonInputs(spot, strike, volatility, maturity) ||
            steps < 1 || steps > MaxBinomialSteps)
        {
            return double.NaN;
        }
        var intrinsic = Payoff(spot, strike, isCall != 0);
        if (volatility == 0.0)
        {
            return Math.Max(intrinsic, DeterministicPrice(
                spot, strike, rate, dividendYield, maturity, isCall != 0));
        }
        var dt = maturity / steps;
        var up = Math.Exp(volatility * Math.Sqrt(dt));
        var down = 1.0 / up;
        var probability = (Math.Exp((rate - dividendYield) * dt) - down) / (up - down);
        if (probability < 0.0 || probability > 1.0) return double.NaN;
        var discount = Math.Exp(-rate * dt);
        var upOverDown = up / down;
        var terminalSpot = spot * Math.Pow(down, steps);
        var values = new double[steps + 1];
        for (var node = 0; node <= steps; node++)
        {
            values[node] = Payoff(terminalSpot, strike, isCall != 0);
            terminalSpot *= upOverDown;
        }
        for (var level = steps - 1; level >= 0; level--)
        {
            var nodeSpot = spot * Math.Pow(down, level);
            for (var node = 0; node <= level; node++)
            {
                var continuation = discount *
                    (probability * values[node + 1] + (1.0 - probability) * values[node]);
                values[node] = Math.Max(
                    continuation, Payoff(nodeSpot, strike, isCall != 0));
                nodeSpot *= upOverDown;
            }
        }
        return values[0];
    }
}
