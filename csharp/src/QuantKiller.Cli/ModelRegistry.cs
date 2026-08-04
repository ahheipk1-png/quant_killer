using System.Collections.Generic;
using System.Text.Json;
using QuantKiller.Core.Models;

namespace QuantKiller.Cli;

public static class ModelRegistry
{
    public static readonly Dictionary<string, System.Func<JsonElement, Dictionary<string, double>>> Models = new()
    {
        ["black_scholes"] = p =>
        {
            var r = new ParamReader(p);
            return BlackScholes.Price(
                r.GetNum("spot", minimum: 0, strictMin: true), r.GetNum("strike", minimum: 0, strictMin: true),
                r.GetNum("rate"), r.GetNum("div_yield", 0.0), r.GetNum("vol", minimum: 0),
                r.GetNum("time", minimum: 0), r.IsCall());
        },
        ["binomial_crr"] = p =>
        {
            var r = new ParamReader(p);
            return Binomial.Price(
                r.GetNum("spot", minimum: 0, strictMin: true), r.GetNum("strike", minimum: 0, strictMin: true),
                r.GetNum("rate"), r.GetNum("div_yield", 0.0), r.GetNum("vol", minimum: 0),
                r.GetNum("time", minimum: 0), r.IsCall(), r.IsAmerican(), r.GetInt("steps", minimum: 1));
        },
        ["monte_carlo_gbm"] = p =>
        {
            var r = new ParamReader(p);
            return MonteCarlo.Price(
                r.GetNum("spot", minimum: 0, strictMin: true), r.GetNum("strike", minimum: 0, strictMin: true),
                r.GetNum("rate"), r.GetNum("div_yield", 0.0), r.GetNum("vol", minimum: 0),
                r.GetNum("time", minimum: 0), r.IsCall(), r.GetInt("paths", minimum: 2),
                (ulong)r.GetInt("seed", 42, minimum: 0), r.GetBool("antithetic", true));
        },
        ["implied_vol"] = p =>
        {
            var r = new ParamReader(p);
            return ImpliedVol.Solve(
                r.GetNum("price", minimum: 0), r.GetNum("spot", minimum: 0, strictMin: true),
                r.GetNum("strike", minimum: 0, strictMin: true), r.GetNum("rate"), r.GetNum("div_yield", 0.0),
                r.GetNum("time", minimum: 0), r.IsCall());
        },
        ["forward"] = p =>
        {
            var r = new ParamReader(p);
            return Forward.Price(r.GetNum("spot", minimum: 0, strictMin: true), r.GetNum("rate"),
                r.GetNum("div_yield", 0.0), r.GetNum("time", minimum: 0), r.GetOptionalNum("strike"));
        },
        ["put_call_parity"] = p =>
        {
            var r = new ParamReader(p);
            return Parity.Run(r.GetNum("spot", minimum: 0, strictMin: true), r.GetNum("strike", minimum: 0, strictMin: true),
                r.GetNum("rate"), r.GetNum("div_yield", 0.0), r.GetNum("time", minimum: 0),
                r.GetOptionalNum("call_price"), r.GetOptionalNum("put_price"));
        },
        ["american_baw"] = p => RunAmerican(p, American.Baw),
        ["american_ju_zhong"] = p => RunAmerican(p, American.JuZhong),
        ["american_bjerksund_1993"] = p => RunAmerican(p, American.Bjerksund1993),
        ["american_bjerksund_2002"] = p => RunAmerican(p, American.Bjerksund2002),
        ["american_carr_randomization"] = p =>
        {
            var r = new ParamReader(p);
            return American.CarrRandomization(
                r.GetNum("spot", minimum: 0, strictMin: true), r.GetNum("strike", minimum: 0, strictMin: true),
                r.GetNum("rate"), r.GetNum("div_yield", 0.0), r.GetNum("vol", minimum: 0),
                r.GetNum("time", minimum: 0, strictMin: true), r.GetInt("phases", 64, minimum: 4), r.IsCall());
        },
    };

    private static Dictionary<string, double> RunAmerican(
        JsonElement p, System.Func<double, double, double, double, double, double, bool, Dictionary<string, double>> fn)
    {
        var r = new ParamReader(p);
        return fn(
            r.GetNum("spot", minimum: 0, strictMin: true), r.GetNum("strike", minimum: 0, strictMin: true),
            r.GetNum("rate"), r.GetNum("div_yield", 0.0), r.GetNum("vol", minimum: 0),
            r.GetNum("time", minimum: 0, strictMin: true), r.IsCall());
    }
}
