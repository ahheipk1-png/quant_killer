using System;
using System.Collections.Generic;

namespace QuantKiller.Core.Models;

/// <summary>Monte Carlo pricing of European options under GBM. Exact algorithm
/// per contracts/rng-spec.md section 5 — loop order and accumulation order
/// are part of the spec so every language agrees for the same seed.</summary>
public static class MonteCarlo
{
    public static Dictionary<string, double> Price(
        double spot, double strike, double rate, double divYield, double vol,
        double time, bool isCall, int paths, ulong seed, bool antithetic)
    {
        var sign = isCall ? 1.0 : -1.0;
        if (time <= 0.0) throw new QkException("monte_carlo_gbm requires time > 0");
        if (paths < 2) throw new QkException("monte_carlo_gbm requires paths >= 2");

        var rng = new Pcg32(seed);
        var disc = Math.Exp(-rate * time);
        var drift = (rate - divYield - 0.5 * vol * vol) * time;
        var volt = vol * Math.Sqrt(time);

        var total = 0.0;
        var totalSq = 0.0;
        for (var i = 0; i < paths; i++)
        {
            var z = rng.NextNormal();
            var p1 = Math.Max(sign * (spot * Math.Exp(drift + volt * z) - strike), 0.0);
            double s;
            if (antithetic)
            {
                var p2 = Math.Max(sign * (spot * Math.Exp(drift - volt * z) - strike), 0.0);
                s = 0.5 * (p1 + p2);
            }
            else
            {
                s = p1;
            }
            total += s;
            totalSq += s * s;
        }

        var mean = total / paths;
        var variance = (totalSq - paths * mean * mean) / (paths - 1);
        if (variance < 0.0) variance = 0.0;

        return new Dictionary<string, double>
        {
            ["price"] = disc * mean,
            ["std_error"] = disc * Math.Sqrt(variance / paths),
        };
    }
}
