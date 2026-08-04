using System;
using System.Collections.Generic;

namespace QuantKiller.Core.Models;

/// <summary>Cox-Ross-Rubinstein binomial tree, European and American. Mirrors
/// python/quantkiller/models/binomial.py's loop order exactly.</summary>
public static class Binomial
{
    public static Dictionary<string, double> Price(
        double spot, double strike, double rate, double divYield, double vol,
        double time, bool isCall, bool american, int steps)
    {
        var sign = isCall ? 1.0 : -1.0;
        if (vol <= 0.0) throw new QkException("binomial_crr requires vol > 0");
        if (time <= 0.0) throw new QkException("binomial_crr requires time > 0");

        var dt = time / steps;
        var u = Math.Exp(vol * Math.Sqrt(dt));
        var d = 1.0 / u;
        var a = Math.Exp((rate - divYield) * dt);
        var p = (a - d) / (u - d);
        if (!(p > 0.0 && p < 1.0))
        {
            throw new QkException($"CRR risk-neutral probability out of (0,1): p={p}");
        }
        var disc = Math.Exp(-rate * dt);
        var u2 = u * u;

        var values = new double[steps + 1];
        var s = spot * Math.Pow(d, steps);
        for (var j = 0; j <= steps; j++)
        {
            values[j] = Math.Max(sign * (s - strike), 0.0);
            s *= u2;
        }

        double[]? v2 = null;
        double[]? v1 = null;

        for (var i = steps - 1; i >= 0; i--)
        {
            s = spot * Math.Pow(d, i);
            for (var j = 0; j <= i; j++)
            {
                var cont = disc * (p * values[j + 1] + (1.0 - p) * values[j]);
                if (american) cont = Math.Max(cont, sign * (s - strike));
                values[j] = cont;
                s *= u2;
            }
            if (i == 2) v2 = [values[0], values[1], values[2]];
            else if (i == 1) v1 = [values[0], values[1]];
        }

        var root = values[0];
        var results = new Dictionary<string, double> { ["price"] = root };
        if (steps >= 2 && v1 != null && v2 != null)
        {
            var sU = spot * u; var sD = spot * d;
            var delta = (v1[1] - v1[0]) / (sU - sD);
            var sUu = spot * u2; var sMid = spot; var sDd = spot * d * d;
            var deltaUp = (v2[2] - v2[1]) / (sUu - sMid);
            var deltaDn = (v2[1] - v2[0]) / (sMid - sDd);
            var gamma = (deltaUp - deltaDn) / (0.5 * (sUu - sDd));
            var theta = (v2[1] - root) / (2.0 * dt);
            results["delta"] = delta;
            results["gamma"] = gamma;
            results["theta"] = theta;
        }
        return results;
    }
}
