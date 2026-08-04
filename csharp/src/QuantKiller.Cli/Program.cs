using System;
using System.IO;
using System.Text.Json;
using QuantKiller.Core;

namespace QuantKiller.Cli;

/// <summary>QuantKiller CLI — the universal cross-language bridge.
/// See python/quantkiller/cli.py for the shared request/response protocol.</summary>
public static class Program
{
    public const string EngineName = "csharp/0.1.0";

    public static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            PrintUsage();
            return 2;
        }

        switch (args[0])
        {
            case "version":
                Console.WriteLine(EngineName);
                return 0;
            case "models":
                foreach (var name in ModelRegistry.Models.Keys)
                {
                    Console.WriteLine(name);
                }
                return 0;
            case "price":
                return RunPrice(args);
            default:
                PrintUsage();
                return 2;
        }
    }

    private static int RunPrice(string[] args)
    {
        string? jsonArg = null;
        for (var i = 1; i < args.Length; i++)
        {
            if (args[i] == "--json" && i + 1 < args.Length)
            {
                jsonArg = args[i + 1];
            }
        }
        if (jsonArg == null)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = "usage: quantkiller price --json <file|->" }));
            return 2;
        }

        string raw;
        try
        {
            raw = jsonArg == "-" ? Console.In.ReadToEnd() : File.ReadAllText(jsonArg);
        }
        catch (Exception exc)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = $"bad request input: {exc.Message}" }));
            return 1;
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(raw);
        }
        catch (JsonException exc)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = $"bad request input: {exc.Message}" }));
            return 1;
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (!root.TryGetProperty("model", out var modelProp) || modelProp.ValueKind != JsonValueKind.String ||
                !root.TryGetProperty("params", out var paramsProp) || paramsProp.ValueKind != JsonValueKind.Object)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = "request must have 'model' (string) and 'params' (object)" }));
                return 1;
            }
            var model = modelProp.GetString()!;
            if (!ModelRegistry.Models.TryGetValue(model, out var fn))
            {
                Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = $"unknown model '{model}'; run 'quantkiller models'" }));
                return 1;
            }
            try
            {
                var results = fn(paramsProp);
                Console.WriteLine(JsonSerializer.Serialize(new { ok = true, model, engine = EngineName, results }));
                return 0;
            }
            catch (QkException exc)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = exc.Message }));
                return 1;
            }
        }
    }

    private static void PrintUsage()
    {
        Console.WriteLine("quantkiller price --json <file|->   price a JSON request");
        Console.WriteLine("quantkiller models                  list available models");
        Console.WriteLine("quantkiller version                 print engine identifier");
    }
}
