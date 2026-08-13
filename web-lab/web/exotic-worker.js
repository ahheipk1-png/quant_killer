importScripts("exotic-pricer.js?v=16");
importScripts("advanced-pricer.js?v=12");

postMessage({
  type: "ready",
  methods: AdvancedPricer.PRODUCT_METHODS,
  descriptions: AdvancedPricer.PRODUCT_DESCRIPTIONS,
  volatilityModels: AdvancedPricer.VOLATILITY_MODELS,
});

self.addEventListener("message", (event) => {
  const { type, requestId } = event.data;
  try {
    if (type === "price") {
      postMessage({
        type: "result",
        requestId,
        result: AdvancedPricer.price(event.data.config, event.data.method),
      });
    } else if (type === "benchmark") {
      postMessage({ type: "benchmarks", requestId, rows: ExoticPricer.runBenchmarks() });
    } else if (type === "volatility-regression") {
      postMessage({
        type: "volatility-regressions",
        requestId,
        rows: AdvancedPricer.runVolatilityRegressions(event.data.paths || 1024),
      });
    }
  } catch (error) {
    postMessage({ type: "error", requestId, message: error.message || String(error) });
  }
});
