using System;
using System.Collections.Generic;
using static QuantKiller.Core.QkMath;

namespace QuantKiller.Core.Models;

/// <summary>
/// American-exercise approximations beyond the CRR tree in Binomial.cs.
/// Ported from python/quantkiller/models/american.py (itself absorbed from
/// the web-lab merge) — see that file's docstring for paper references.
/// Barone-Adesi-Whaley, Ju-Zhong, Bjerksund-Stensland 1993/2002, and Carr
/// randomization (PSOR finite-difference, Richardson-extrapolated in phase
/// count).
/// </summary>
public static class American
{
    private static double Intrinsic(double spot, double strike, bool isCall) =>
        Math.Max(isCall ? spot - strike : strike - spot, 0.0);

    private static double European(double spot, double strike, double rate, double divYield,
        double vol, double time, bool isCall) =>
        BlackScholes.Price(spot, strike, rate, divYield, vol, time, isCall)["price"];

    private static void ValidateAmerican(double rate, double divYield)
    {
        if (rate < 0.0 || divYield < 0.0)
        {
            throw new QkException("this American approximation requires rate >= 0 and div_yield >= 0");
        }
    }

    // ----- Barone-Adesi-Whaley -----

    private static (double Boundary, double Exponent) BawCriticalPrice(
        double strike, double rate, double divYield, double vol, double time, bool isCall)
    {
        var variance = vol * vol * time;
        var rootVariance = Math.Sqrt(variance);
        var riskFreeDiscount = Math.Exp(-rate * time);
        var dividendDiscount = Math.Exp(-divYield * time);
        var n = 2.0 * Math.Log(dividendDiscount / riskFreeDiscount) / variance;
        var m = -2.0 * Math.Log(riskFreeDiscount) / variance;
        var carryTime = Math.Log(dividendDiscount / riskFreeDiscount);

        double upperExponent, upper, boundary;
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
            var european = European(boundary, strike, rate, divYield, vol, time, isCall);
            if (isCall)
            {
                var lhs = boundary - strike;
                var rhs = european + (1.0 - dividendDiscount * NormCdf(d1)) * boundary / exponent;
                var slope = dividendDiscount * NormCdf(d1) * (1.0 - 1.0 / exponent) +
                    (1.0 - dividendDiscount * NormPdf(d1) / rootVariance) / exponent;
                if (Math.Abs(lhs - rhs) / strike <= 1.0e-8) break;
                boundary = (strike + rhs - slope * boundary) / (1.0 - slope);
            }
            else
            {
                var lhs = strike - boundary;
                var rhs = european - (1.0 - dividendDiscount * NormCdf(-d1)) * boundary / exponent;
                var slope = -dividendDiscount * NormCdf(-d1) * (1.0 - 1.0 / exponent) -
                    (1.0 + dividendDiscount * NormPdf(-d1) / rootVariance) / exponent;
                if (Math.Abs(lhs - rhs) / strike <= 1.0e-8) break;
                boundary = (strike - rhs + slope * boundary) / (1.0 + slope);
            }
        }
        return (boundary, exponent);
    }

    public static Dictionary<string, double> Baw(
        double spot, double strike, double rate, double divYield, double vol, double time, bool isCall)
    {
        ValidateAmerican(rate, divYield);
        var european = European(spot, strike, rate, divYield, vol, time, isCall);
        var intrinsic = Intrinsic(spot, strike, isCall);
        if (vol == 0.0 || (isCall && divYield <= 0.0))
        {
            return new Dictionary<string, double> { ["price"] = Math.Max(european, intrinsic) };
        }
        var (boundary, exponent) = BawCriticalPrice(strike, rate, divYield, vol, time, isCall);
        var variance = vol * vol * time;
        var d1 = (Math.Log(boundary * Math.Exp((rate - divYield) * time) / strike) + 0.5 * variance) / Math.Sqrt(variance);
        var dividendDiscount = Math.Exp(-divYield * time);
        double value;
        if (isCall)
        {
            var coefficient = boundary / exponent * (1.0 - dividendDiscount * NormCdf(d1));
            value = spot < boundary ? european + coefficient * Math.Pow(spot / boundary, exponent) : intrinsic;
        }
        else
        {
            var coefficient = -boundary / exponent * (1.0 - dividendDiscount * NormCdf(-d1));
            value = spot > boundary ? european + coefficient * Math.Pow(spot / boundary, exponent) : intrinsic;
        }
        return new Dictionary<string, double> { ["price"] = Math.Max(value, Math.Max(european, intrinsic)) };
    }

    // ----- Ju-Zhong -----

    public static Dictionary<string, double> JuZhong(
        double spot, double strike, double rate, double divYield, double vol, double time, bool isCall)
    {
        ValidateAmerican(rate, divYield);
        var european = European(spot, strike, rate, divYield, vol, time, isCall);
        var intrinsic = Intrinsic(spot, strike, isCall);
        if (vol == 0.0 || (isCall && divYield <= 0.0))
        {
            return new Dictionary<string, double> { ["price"] = Math.Max(european, intrinsic) };
        }
        if (Math.Abs(rate) < 1e-9) return Baw(spot, strike, rate, divYield, vol, time, isCall);

        var (boundary, _) = BawCriticalPrice(strike, rate, divYield, vol, time, isCall);
        var phi = isCall ? 1.0 : -1.0;
        var variance = vol * vol * time;
        var rootVariance = Math.Sqrt(variance);
        var riskFreeDiscount = Math.Exp(-rate * time);
        var dividendDiscount = Math.Exp(-divYield * time);
        var h = 1.0 - riskFreeDiscount;
        var alpha = -2.0 * Math.Log(riskFreeDiscount) / variance;
        var beta = 2.0 * Math.Log(dividendDiscount / riskFreeDiscount) / variance;
        var radical = Math.Sqrt((beta - 1.0) * (beta - 1.0) + 4.0 * alpha / h);
        var exponent = (-(beta - 1.0) + phi * radical) / 2.0;
        var exponentPrime = -phi * alpha / (h * h * radical);
        var europeanBoundary = European(boundary, strike, rate, divYield, vol, time, isCall);
        var premiumBoundary = phi * (boundary - strike) - europeanBoundary;
        var denominator = 2.0 * exponent + beta - 1.0;
        if (Math.Abs(premiumBoundary) < 1e-12 || Math.Abs(denominator) < 1e-12)
        {
            return Baw(spot, strike, rate, divYield, vol, time, isCall);
        }
        var forwardBoundary = boundary * dividendDiscount / riskFreeDiscount;
        var d1 = (Math.Log(forwardBoundary / strike) + 0.5 * variance) / rootVariance;
        var d2 = d1 - rootVariance;
        var europeanH = forwardBoundary * NormPdf(d1) / (alpha * rootVariance)
            - phi * forwardBoundary * NormCdf(phi * d1) * Math.Log(dividendDiscount) / Math.Log(riskFreeDiscount)
            + phi * strike * NormCdf(phi * d2);
        var quadratic = (1.0 - h) * alpha * exponentPrime / (2.0 * denominator);
        var linear = -(1.0 - h) * alpha / denominator * (europeanH / premiumBoundary + 1.0 / h + exponentPrime / denominator);
        var logRatio = Math.Log(spot / boundary);
        var chi = logRatio * (quadratic * logRatio + linear);
        if (double.IsNaN(chi) || double.IsInfinity(chi) || Math.Abs(1.0 - chi) <= 1e-8)
        {
            return Baw(spot, strike, rate, divYield, vol, time, isCall);
        }
        var continuationRegion = phi * (boundary - spot) > 0.0;
        var value = continuationRegion
            ? european + premiumBoundary * Math.Pow(spot / boundary, exponent) / (1.0 - chi)
            : intrinsic;
        return new Dictionary<string, double> { ["price"] = Math.Max(value, Math.Max(european, intrinsic)) };
    }

    // ----- Bjerksund-Stensland 1993 -----

    private static double BjerksundPhi(double spot, double gamma, double boundary, double trigger,
        double rateTime, double carryTime, double variance)
    {
        var rootVariance = Math.Sqrt(variance);
        var lambda = -rateTime + gamma * carryTime + 0.5 * gamma * (gamma - 1.0) * variance;
        var d = -(Math.Log(spot / boundary) + carryTime + (gamma - 0.5) * variance) / rootVariance;
        var kappa = 2.0 * carryTime / variance + 2.0 * gamma - 1.0;
        return Math.Exp(lambda) * (NormCdf(d) - Math.Pow(trigger / spot, kappa) *
            NormCdf(d - 2.0 * Math.Log(trigger / spot) / rootVariance));
    }

    private static double BjerksundCall(double spot, double strike, double riskFreeDiscount,
        double dividendDiscount, double variance)
    {
        var rateTime = Math.Log(1.0 / riskFreeDiscount);
        var carryTime = Math.Log(dividendDiscount / riskFreeDiscount);
        var european = European(spot, strike, rateTime, rateTime - carryTime, Math.Sqrt(variance), 1.0, true);
        var intrinsic = Math.Max(spot - strike, 0.0);
        if (dividendDiscount >= 1.0 && dividendDiscount >= riskFreeDiscount) return Math.Max(european, intrinsic);

        var beta = 0.5 - carryTime / variance + Math.Sqrt(Math.Pow(carryTime / variance - 0.5, 2.0) + 2.0 * rateTime / variance);
        if (beta <= 1.0) return Math.Max(european, intrinsic);
        var boundaryInfinity = beta / (beta - 1.0) * strike;
        var boundaryZero = Math.Abs(carryTime - rateTime) < 1.0e-14
            ? strike : Math.Max(strike, rateTime / (rateTime - carryTime) * strike);
        var h = -(carryTime + 2.0 * Math.Sqrt(variance)) * boundaryZero / (boundaryInfinity - boundaryZero);
        var boundary = boundaryZero + (boundaryInfinity - boundaryZero) * (1.0 - Math.Exp(h));
        var forward = spot * dividendDiscount / riskFreeDiscount;
        if (spot >= boundary) return intrinsic;
        if (Math.Log(boundary / forward) / Math.Sqrt(variance) > 12.5) return Math.Max(european, intrinsic);

        var value = (boundary - strike) * Math.Pow(spot / boundary, beta) *
            (1.0 - BjerksundPhi(spot, beta, boundary, boundary, rateTime, carryTime, variance))
            + spot * BjerksundPhi(spot, 1.0, boundary, boundary, rateTime, carryTime, variance)
            - spot * BjerksundPhi(spot, 1.0, strike, boundary, rateTime, carryTime, variance)
            - strike * BjerksundPhi(spot, 0.0, boundary, boundary, rateTime, carryTime, variance)
            + strike * BjerksundPhi(spot, 0.0, strike, boundary, rateTime, carryTime, variance);
        return Math.Max(value, Math.Max(european, intrinsic));
    }

    public static Dictionary<string, double> Bjerksund1993(
        double spot, double strike, double rate, double divYield, double vol, double time, bool isCall)
    {
        ValidateAmerican(rate, divYield);
        var european = European(spot, strike, rate, divYield, vol, time, isCall);
        var intrinsic = Intrinsic(spot, strike, isCall);
        if (vol == 0.0) return new Dictionary<string, double> { ["price"] = Math.Max(european, intrinsic) };
        var riskFreeDiscount = Math.Exp(-rate * time);
        var dividendDiscount = Math.Exp(-divYield * time);
        var variance = vol * vol * time;
        var value = isCall
            ? BjerksundCall(spot, strike, riskFreeDiscount, dividendDiscount, variance)
            : BjerksundCall(strike, spot, dividendDiscount, riskFreeDiscount, variance);
        return new Dictionary<string, double> { ["price"] = Math.Max(value, Math.Max(european, intrinsic)) };
    }

    // ----- Bjerksund-Stensland 2002 -----

    private static double BivariateNormalCdf(double first, double second, double correlation)
    {
        if (first <= -10.0 || second <= -10.0) return 0.0;
        if (first >= 10.0) return NormCdf(second);
        if (second >= 10.0) return NormCdf(first);
        if (Math.Abs(correlation) < 1.0e-14) return NormCdf(first) * NormCdf(second);
        const int intervals = 512;
        const double lower = -10.0;
        var upper = Math.Min(first, 10.0);
        var width = (upper - lower) / intervals;
        var correlationScale = Math.Sqrt(1.0 - correlation * correlation);
        double Integrand(double value) => NormPdf(value) * NormCdf((second - correlation * value) / correlationScale);
        var total = Integrand(lower) + Integrand(upper);
        for (var index = 1; index < intervals; index++)
        {
            total += (index % 2 == 0 ? 2.0 : 4.0) * Integrand(lower + index * width);
        }
        return Math.Min(Math.Max(total * width / 3.0, 0.0), 1.0);
    }

    private static double Bjerksund2002Phi(double spot, double horizon, double gamma, double cap,
        double trigger, double rate, double carry, double vol)
    {
        var variance = vol * vol;
        var denominator = vol * Math.Sqrt(horizon);
        var lambda = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance;
        var kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
        var drift = (carry + (gamma - 0.5) * variance) * horizon;
        var d1 = -(Math.Log(spot / cap) + drift) / denominator;
        var d2 = d1 - 2.0 * Math.Log(trigger / spot) / denominator;
        return Math.Exp(lambda * horizon) * Math.Pow(spot, gamma) *
            (NormCdf(d1) - Math.Pow(trigger / spot, kappa) * NormCdf(d2));
    }

    private static double Bjerksund2002Psi(double spot, double time, double gamma, double cap,
        double firstBoundary, double secondBoundary, double splitTime, double rate, double carry, double vol)
    {
        var variance = vol * vol;
        var lambda = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance;
        var kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
        var gammaCarry = carry + (gamma - 0.5) * variance;
        var shortScale = vol * Math.Sqrt(splitTime);
        var fullScale = vol * Math.Sqrt(time);
        var shortDrift = gammaCarry * splitTime;
        var fullDrift = gammaCarry * time;
        var correlation = Math.Sqrt(splitTime / time);

        var d1 = -(Math.Log(spot / secondBoundary) + shortDrift) / shortScale;
        var d2 = -(Math.Log(firstBoundary * firstBoundary / (spot * secondBoundary)) + shortDrift) / shortScale;
        var d3 = -(Math.Log(spot / secondBoundary) - shortDrift) / shortScale;
        var d4 = -(Math.Log(firstBoundary * firstBoundary / (spot * secondBoundary)) - shortDrift) / shortScale;
        var e1 = -(Math.Log(spot / cap) + fullDrift) / fullScale;
        var e2 = -(Math.Log(firstBoundary * firstBoundary / (spot * cap)) + fullDrift) / fullScale;
        var e3 = -(Math.Log(secondBoundary * secondBoundary / (spot * cap)) + fullDrift) / fullScale;
        var e4 = -(Math.Log(spot * secondBoundary * secondBoundary / (cap * firstBoundary * firstBoundary)) + fullDrift) / fullScale;

        var value = BivariateNormalCdf(d1, e1, correlation)
            - Math.Pow(firstBoundary / spot, kappa) * BivariateNormalCdf(d2, e2, correlation)
            - Math.Pow(secondBoundary / spot, kappa) * BivariateNormalCdf(d3, e3, -correlation)
            + Math.Pow(secondBoundary / firstBoundary, kappa) * BivariateNormalCdf(d4, e4, -correlation);
        return Math.Exp(lambda * time) * Math.Pow(spot, gamma) * value;
    }

    private static double Bjerksund2002CallCore(double spot, double strike, double rate, double divYield,
        double vol, double time)
    {
        var european = European(spot, strike, rate, divYield, vol, time, true);
        var intrinsic = Math.Max(spot - strike, 0.0);
        var carry = rate - divYield;
        if (vol == 0.0 || carry >= rate) return Math.Max(european, intrinsic);

        var variance = vol * vol;
        var beta = 0.5 - carry / variance + Math.Sqrt(Math.Pow(carry / variance - 0.5, 2.0) + 2.0 * rate / variance);
        if (beta <= 1.0) return Math.Max(european, intrinsic);
        var boundaryInfinity = beta / (beta - 1.0) * strike;
        var boundaryZero = Math.Max(strike, rate / (rate - carry) * strike);

        double Boundary(double horizon)
        {
            var h = -(carry * horizon + 2.0 * vol * Math.Sqrt(horizon)) *
                strike * strike / ((boundaryInfinity - boundaryZero) * boundaryZero);
            return boundaryZero + (boundaryInfinity - boundaryZero) * (1.0 - Math.Exp(h));
        }

        var splitTime = 0.5 * (Math.Sqrt(5.0) - 1.0) * time;
        var firstBoundary = Boundary(time);
        var secondBoundary = Boundary(time - splitTime);
        if (spot >= firstBoundary) return intrinsic;

        var alphaFirst = (firstBoundary - strike) * Math.Pow(firstBoundary, -beta);
        var alphaSecond = (secondBoundary - strike) * Math.Pow(secondBoundary, -beta);
        var value = alphaFirst * Math.Pow(spot, beta)
            - alphaFirst * Bjerksund2002Phi(spot, splitTime, beta, firstBoundary, firstBoundary, rate, carry, vol)
            + Bjerksund2002Phi(spot, splitTime, 1.0, firstBoundary, firstBoundary, rate, carry, vol)
            - Bjerksund2002Phi(spot, splitTime, 1.0, secondBoundary, firstBoundary, rate, carry, vol)
            - strike * Bjerksund2002Phi(spot, splitTime, 0.0, firstBoundary, firstBoundary, rate, carry, vol)
            + strike * Bjerksund2002Phi(spot, splitTime, 0.0, secondBoundary, firstBoundary, rate, carry, vol)
            + alphaSecond * Bjerksund2002Phi(spot, splitTime, beta, secondBoundary, firstBoundary, rate, carry, vol)
            - alphaSecond * Bjerksund2002Psi(spot, time, beta, secondBoundary, firstBoundary, secondBoundary, splitTime, rate, carry, vol)
            + Bjerksund2002Psi(spot, time, 1.0, secondBoundary, firstBoundary, secondBoundary, splitTime, rate, carry, vol)
            - Bjerksund2002Psi(spot, time, 1.0, strike, firstBoundary, secondBoundary, splitTime, rate, carry, vol)
            - strike * Bjerksund2002Psi(spot, time, 0.0, secondBoundary, firstBoundary, secondBoundary, splitTime, rate, carry, vol)
            + strike * Bjerksund2002Psi(spot, time, 0.0, strike, firstBoundary, secondBoundary, splitTime, rate, carry, vol);
        return Math.Max(value, Math.Max(european, intrinsic));
    }

    public static Dictionary<string, double> Bjerksund2002(
        double spot, double strike, double rate, double divYield, double vol, double time, bool isCall)
    {
        ValidateAmerican(rate, divYield);
        var european = European(spot, strike, rate, divYield, vol, time, isCall);
        var intrinsic = Intrinsic(spot, strike, isCall);
        var value = isCall
            ? Bjerksund2002CallCore(spot, strike, rate, divYield, vol, time)
            : Bjerksund2002CallCore(strike, spot, divYield, rate, vol, time);
        return new Dictionary<string, double> { ["price"] = Math.Max(value, Math.Max(european, intrinsic)) };
    }

    // ----- Carr randomization -----

    private static double Payoff(double terminalSpot, double strike, bool isCall) =>
        Math.Max(isCall ? terminalSpot - strike : strike - terminalSpot, 0.0);

    private static double CarrRandomizationCore(double spot, double strike, double rate, double divYield,
        double vol, double time, int phases, bool isCall)
    {
        const int gridPoints = 501;
        var intrinsic = Payoff(spot, strike, isCall);
        if (vol == 0.0)
        {
            var fwd = spot * Math.Exp((rate - divYield) * time);
            return Math.Max(intrinsic, Math.Exp(-rate * time) * Payoff(fwd, strike, isCall));
        }
        if (isCall && divYield == 0.0)
        {
            return European(spot, strike, rate, divYield, vol, time, true);
        }

        var drift = rate - divYield - 0.5 * vol * vol;
        var halfWidth = Math.Max(2.0, Math.Max(Math.Abs(Math.Log(strike / spot)) + 1.5,
            5.0 * vol * Math.Sqrt(time) + Math.Abs(drift) * time));
        var xMin = Math.Log(spot) - halfWidth;
        var dx = 2.0 * halfWidth / gridPoints;
        var exercise = new double[gridPoints + 1];
        for (var index = 0; index <= gridPoints; index++)
        {
            exercise[index] = Payoff(Math.Exp(xMin + index * dx), strike, isCall);
        }
        var previous = (double[])exercise.Clone();
        var current = new double[gridPoints + 1];
        var intensity = phases / time;
        var diffusion = 0.5 * vol * vol / (dx * dx);
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
        const double omega = 1.2;

        for (var phase = 0; phase < phases; phase++)
        {
            Array.Copy(previous, current, previous.Length);
            current[0] = isCall ? 0.0 : exercise[0];
            current[gridPoints] = isCall ? exercise[gridPoints] : 0.0;
            for (var iteration = 0; iteration < 10000; iteration++)
            {
                var maxChange = 0.0;
                for (var index = 1; index < gridPoints; index++)
                {
                    var continuation = (intensity * previous[index] - lower * current[index - 1] - upper * current[index + 1]) / diagonal;
                    var relaxed = current[index] + omega * (continuation - current[index]);
                    var updated = Math.Max(exercise[index], relaxed);
                    maxChange = Math.Max(maxChange, Math.Abs(updated - current[index]));
                    current[index] = updated;
                }
                if (maxChange < 1.0e-10) break;
            }
            (previous, current) = (current, previous);
        }

        var gridPosition = (Math.Log(spot) - xMin) / dx;
        var left = Math.Min(Math.Max((int)Math.Floor(gridPosition), 0), gridPoints - 1);
        var weight = gridPosition - left;
        return previous[left] * (1.0 - weight) + previous[left + 1] * weight;
    }

    public static Dictionary<string, double> CarrRandomization(
        double spot, double strike, double rate, double divYield, double vol, double time,
        int phases, bool isCall)
    {
        ValidateAmerican(rate, divYield);
        if (phases < 4 || phases > 256) throw new QkException("carr_randomization requires 4 <= phases <= 256");
        var coarse = CarrRandomizationCore(spot, strike, rate, divYield, vol, time, phases, isCall);
        var fine = CarrRandomizationCore(spot, strike, rate, divYield, vol, time, 2 * phases, isCall);
        var extrapolated = 2.0 * fine - coarse;
        var lower = Payoff(spot, strike, isCall);
        var upper = isCall ? spot : strike;
        return new Dictionary<string, double> { ["price"] = Math.Min(Math.Max(extrapolated, lower), upper) };
    }
}
