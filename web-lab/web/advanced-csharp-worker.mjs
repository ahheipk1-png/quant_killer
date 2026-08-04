import { dotnet } from "./csharp/wwwroot/_framework/dotnet.js";

let pricer;

dotnet.create().then(async ({ getAssemblyExports, getConfig }) => {
  const config = getConfig();
  const exports = await getAssemblyExports(config.mainAssemblyName);
  pricer = exports.QuantKiller.Browser.AdvancedPricer;
  if (!pricer?.Price) throw new Error("Rebuild the C# module with AdvancedPricer exports.");
  postMessage({ type: "ready", language: "csharp" });
}).catch((error) => postMessage({ type: "error", message: `C# engine failed: ${error.message}` }));

self.addEventListener("message", (event) => {
  if (event.data.type !== "price" || !pricer) return;
  const { requestId, parameters, paths, seed, config, method } = event.data;
  const started = performance.now();
  try {
    parameters.forEach((value, index) => pricer.SetParameter(index, value));
    const price = pricer.Price(paths, seed);
    const standardError = pricer.LastStandardError();
    const standardDeviation = pricer.LastStandardDeviation();
    if (![price, standardError, standardDeviation].every(Number.isFinite)) {
      throw new Error("The C# engine rejected the advanced configuration.");
    }
    postMessage({
      type: "result", requestId,
      result: {
        price, standardError, standardDeviation, samples: paths,
        elapsedMs: performance.now() - started, config, method,
      },
    });
  } catch (error) {
    postMessage({ type: "error", requestId, message: error.message || String(error) });
  }
});
