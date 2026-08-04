using System.Text.Json;
using QuantKiller.Core;

namespace QuantKiller.Cli;

/// <summary>Typed extraction from a JSON params object, mirroring the
/// validation conventions in python/quantkiller/models/_common.py.</summary>
public sealed class ParamReader(JsonElement element)
{
    public double GetNum(string key, double? def = null, double? minimum = null, bool strictMin = false)
    {
        if (!element.TryGetProperty(key, out var prop))
        {
            if (def.HasValue) return def.Value;
            throw new QkException($"missing required parameter '{key}'");
        }
        if (prop.ValueKind is not (JsonValueKind.Number))
        {
            throw new QkException($"parameter '{key}' must be a number");
        }
        var v = prop.GetDouble();
        if (minimum.HasValue)
        {
            if (strictMin && v <= minimum.Value) throw new QkException($"parameter '{key}' must be > {minimum}, got {v}");
            if (!strictMin && v < minimum.Value) throw new QkException($"parameter '{key}' must be >= {minimum}, got {v}");
        }
        return v;
    }

    public double? GetOptionalNum(string key)
    {
        if (!element.TryGetProperty(key, out var prop)) return null;
        return prop.GetDouble();
    }

    public bool HasKey(string key) => element.TryGetProperty(key, out _);

    public int GetInt(string key, int? def = null, int? minimum = null)
    {
        if (!element.TryGetProperty(key, out var prop))
        {
            if (def.HasValue) return def.Value;
            throw new QkException($"missing required parameter '{key}'");
        }
        var v = prop.GetInt32();
        if (minimum.HasValue && v < minimum.Value) throw new QkException($"parameter '{key}' must be >= {minimum}, got {v}");
        return v;
    }

    public bool IsCall()
    {
        if (!element.TryGetProperty("option_type", out var prop))
        {
            throw new QkException("option_type must be 'call' or 'put'");
        }
        var s = prop.GetString();
        if (s == "call") return true;
        if (s == "put") return false;
        throw new QkException($"option_type must be 'call' or 'put', got {s}");
    }

    public bool IsAmerican(string def = "european")
    {
        var s = element.TryGetProperty("style", out var prop) ? prop.GetString() : def;
        if (s == "european") return false;
        if (s == "american") return true;
        throw new QkException($"style must be 'european' or 'american', got {s}");
    }

    public bool GetBool(string key, bool def)
    {
        if (!element.TryGetProperty(key, out var prop)) return def;
        return prop.GetBoolean();
    }
}
