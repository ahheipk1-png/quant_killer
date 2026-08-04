using System;
using System.Collections.Generic;
using static QuantKiller.Core.QkMath;

namespace QuantKiller.Core.Models;

/// <summary>
/// Black-Scholes-Merton closed form with continuous dividend yield, plus Greeks.
/// See python/quantkiller/models/black_scholes.py for the derivation and edge
/// conventions this must match exactly (T==0 -> intrinsic; vol==0 -> discounted
/// forward intrinsic).
/// </summary>
public static class BlackScholes
{
    public static Dictionary<string, double> Price(
        double spot, double strike, double rate, double divYield,
        double vol, double time, bool isCall)
    {
        var sign = isCall ? 1.0 : -1.0;

        if (time == 0.0)
        {
            var intrinsic0 = Math.Max(sign * (spot - strike), 0.0);
            double delta0;
            if (spot == strike) delta0 = sign * 0.5;
            else delta0 = sign * (spot - strike) > 0.0 ? sign : 0.0;
            return new Dictionary<string, double>
            {
                ["price"] = intrinsic0, ["delta"] = delta0, ["gamma"] = 0.0,
                ["vega"] = 0.0, ["theta"] = 0.0, ["rho"] = 0.0,
            };
        }

        var dfR = Math.Exp(-rate * time);
        var dfQ = Math.Exp(-divYield * time);

        if (vol == 0.0)
        {
            var fwd = spot * dfQ / dfR;
            var intrinsic = Math.Max(sign * (fwd - strike), 0.0) * dfR;
            var inMoney = sign * (fwd - strike) > 0.0;
            var delta = inMoney ? sign * dfQ : 0.0;
            return new Dictionary<string, double>
            {
                ["price"] = intrinsic, ["delta"] = delta, ["gamma"] = 0.0,
                ["vega"] = 0.0, ["theta"] = 0.0, ["rho"] = 0.0,
            };
        }

        var sqrtT = Math.Sqrt(time);
        var d1 = (Math.Log(spot / strike) + (rate - divYield + 0.5 * vol * vol) * time) / (vol * sqrtT);
        var d2 = d1 - vol * sqrtT;
        var pdfD1 = NormPdf(d1);

        var gamma = dfQ * pdfD1 / (spot * vol * sqrtT);
        var vega = spot * dfQ * pdfD1 * sqrtT;

        double price, deltaOut, theta, rho;
        if (isCall)
        {
            var nd1 = NormCdf(d1);
            var nd2 = NormCdf(d2);
            price = spot * dfQ * nd1 - strike * dfR * nd2;
            deltaOut = dfQ * nd1;
            theta = -spot * dfQ * pdfD1 * vol / (2.0 * sqrtT) + divYield * spot * dfQ * nd1 - rate * strike * dfR * nd2;
            rho = strike * time * dfR * nd2;
        }
        else
        {
            var nmd1 = NormCdf(-d1);
            var nmd2 = NormCdf(-d2);
            price = strike * dfR * nmd2 - spot * dfQ * nmd1;
            deltaOut = -dfQ * nmd1;
            theta = -spot * dfQ * pdfD1 * vol / (2.0 * sqrtT) - divYield * spot * dfQ * nmd1 + rate * strike * dfR * nmd2;
            rho = -strike * time * dfR * nmd2;
        }

        return new Dictionary<string, double>
        {
            ["price"] = price, ["delta"] = deltaOut, ["gamma"] = gamma,
            ["vega"] = vega, ["theta"] = theta, ["rho"] = rho, ["d1"] = d1, ["d2"] = d2,
        };
    }
}
