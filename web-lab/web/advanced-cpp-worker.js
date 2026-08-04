importScripts("pricer.js");

let setParameter;
let priceAdvanced;
let lastStandardError;
let lastStandardDeviation;

createQuantKillerModule({ locateFile: (path) => path }).then((module) => {
  setParameter = module.cwrap("qk_advanced_set_parameter", null, ["number", "number"]);
  priceAdvanced = module.cwrap("qk_advanced_price", "number", ["number", "number"]);
  lastStandardError = module.cwrap("qk_advanced_last_std_error", "number", []);
  lastStandardDeviation = module.cwrap("qk_advanced_last_std_dev", "number", []);
  postMessage({ type: "ready", language: "cpp" });
}).catch((error) => {
  postMessage({ type: "error", message: `C++ engine failed: ${error.message}` });
});

self.addEventListener("message", (event) => {
  if (event.data.type !== "price" || !priceAdvanced) return;
  const { requestId, parameters, paths, seed, config, method } = event.data;
  const started = performance.now();
  try {
    parameters.forEach((value, index) => setParameter(index, value));
    const price = priceAdvanced(paths, seed);
    const standardError = lastStandardError();
    const standardDeviation = lastStandardDeviation();
    if (![price, standardError, standardDeviation].every(Number.isFinite)) {
      throw new Error("The C++ engine rejected the advanced configuration.");
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
