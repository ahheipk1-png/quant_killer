using System;
using System.Collections.Generic;

namespace QuantKiller.Core.Models;

/// <summary>Forward pricing by cost of carry and put-call parity. Mirrors
/// python/quantkiller/models/forward.py and parity.py.</summary>
public static class Forward
{
    public static Dictionary<string, double> Price(
        double spot, double rate, double divYield, double time, double? strike)
    {
        var fwd = spot * Math.Exp((rate - divYield) * time);
        var results = new Dictionary<string, double> { ["forward_price"] = fwd };
        if (strike.HasValue)
        {
            results["value"] = (fwd - strike.Value) * Math.Exp(-rate * time);
        }
        return results;
    }
}

public static class Parity
{
    public static Dictionary<string, double> Run(
        double spot, double strike, double rate, double divYield, double time,
        double? callPrice, double? putPrice)
    {
        if (callPrice is null && putPrice is null)
        {
            throw new QkException("put_call_parity needs call_price and/or put_price");
        }
        var basis = spot * Math.Exp(-divYield * time) - strike * Math.Exp(-rate * time);
        var results = new Dictionary<string, double>();
        if (callPrice.HasValue && putPrice.HasValue)
        {
            results["residual"] = callPrice.Value - putPrice.Value - basis;
        }
        else if (callPrice.HasValue)
        {
            results["put_price"] = callPrice.Value - basis;
            results["residual"] = 0.0;
        }
        else
        {
            results["call_price"] = putPrice!.Value + basis;
            results["residual"] = 0.0;
        }
        return results;
    }
}
