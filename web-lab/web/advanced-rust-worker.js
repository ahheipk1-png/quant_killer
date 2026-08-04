let instance;

fetch("rust-pricer.wasm")
  .then((response) => {
    if (!response.ok) throw new Error(`Rust module returned HTTP ${response.status}`);
    return WebAssembly.instantiateStreaming(response);
  })
  .then((result) => {
    instance = result.instance;
    if (!instance.exports.qk_advanced_price) throw new Error("Rebuild the Rust module with advanced exports.");
    postMessage({ type: "ready", language: "rust" });
  })
  .catch((error) => postMessage({ type: "error", message: `Rust engine failed: ${error.message}` }));

self.addEventListener("message", (event) => {
  if (event.data.type !== "price" || !instance) return;
  const { requestId, parameters, paths, seed, config, method } = event.data;
  const started = performance.now();
  try {
    parameters.forEach((value, index) => instance.exports.qk_advanced_set_parameter(index, value));
    const price = instance.exports.qk_advanced_price(paths, seed);
    const standardError = instance.exports.qk_advanced_last_std_error();
    const standardDeviation = instance.exports.qk_advanced_last_std_dev();
    if (![price, standardError, standardDeviation].every(Number.isFinite)) {
      throw new Error("The Rust engine rejected the advanced configuration.");
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
