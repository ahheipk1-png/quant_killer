using System;
using System.Collections.Generic;

namespace QuantKiller.Core.Models;

/// <summary>Implied volatility via safeguarded Newton/bisection. Mirrors
/// python/quantkiller/models/implied_vol.py exactly.</summary>
public static class ImpliedVol
{
    private const double SigmaMin = 1e-9;
    private const double SigmaMax = 5.0;
    private const int MaxIter = 100;

    public static Dictionary<string, double> Solve(
        double target, double spot, double strike, double rate, double divYield,
        double time, bool isCall)
    {
        if (time <= 0.0) throw new QkException("implied_vol requires time > 0");

        var dfR = Math.Exp(-rate * time);
        var dfQ = Math.Exp(-divYield * time);
        double lower, upper;
        if (isCall)
        {
            lower = Math.Max(spot * dfQ - strike * dfR, 0.0);
            upper = spot * dfQ;
        }
        else
        {
            lower = Math.Max(strike * dfR - spot * dfQ, 0.0);
            upper = strike * dfR;
        }

        var tol = 1e-12 * (1.0 + Math.Abs(target));
        if (target < lower - tol || target > upper + tol)
        {
            throw new QkException($"target price {target} violates no-arbitrage bounds [{lower}, {upper}]");
        }
        if (target <= lower + tol)
        {
            return new Dictionary<string, double> { ["implied_vol"] = 0.0, ["iterations"] = 0.0 };
        }

        var sigma = Math.Sqrt(2.0 * Math.PI / time) * target / spot;
        sigma = Math.Min(Math.Max(sigma, 1e-4), SigmaMax);
        var lo = SigmaMin;
        var hi = SigmaMax;

        Dictionary<string, double> F(double vol) => BlackScholes.Price(spot, strike, rate, divYield, vol, time, isCall);

        var iterations = 0;
        for (iterations = 1; iterations <= MaxIter; iterations++)
        {
            var outp = F(sigma);
            var diff = outp["price"] - target;
            if (Math.Abs(diff) <= tol) break;
            if (diff > 0.0) hi = sigma; else lo = sigma;
            var vega = outp["vega"];
            var stepOk = false;
            var sigmaNext = 0.0;
            if (vega > 1e-12)
            {
                var candidate = sigma - diff / vega;
                if (candidate > lo && candidate < hi)
                {
                    stepOk = Math.Abs(candidate - sigma) > 1e-14;
                    sigmaNext = candidate;
                }
            }
            if (!stepOk)
            {
                sigmaNext = 0.5 * (lo + hi);
                if (Math.Abs(sigmaNext - sigma) <= 1e-14) break;
            }
            sigma = sigmaNext;
        }
        if (iterations > MaxIter) iterations = MaxIter;

        if (Math.Abs(F(sigma)["price"] - target) > Math.Max(tol, 1e-8 * (1.0 + Math.Abs(target))))
        {
            throw new QkException("implied_vol did not converge");
        }

        return new Dictionary<string, double> { ["implied_vol"] = sigma, ["iterations"] = iterations };
    }
}
