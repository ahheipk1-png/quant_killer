import { loadPyodide } from "./pyodide/pyodide.mjs?v=2";

let pyodide;
let priceAdvanced;

async function loadEngine() {
  try {
    const indexURL = new URL("./pyodide/", self.location.href).href;
    pyodide = await loadPyodide({ indexURL });
    const source = await fetch("./python/advanced_pricer.py").then((response) => {
      if (!response.ok) throw new Error(`Python source returned HTTP ${response.status}`);
      return response.text();
    });
    await pyodide.runPythonAsync(source);
    priceAdvanced = pyodide.globals.get("price_advanced");
    postMessage({ type: "ready", language: "python" });
  } catch (error) {
    postMessage({ type: "error", message: `Python engine failed: ${error.message}` });
  }
}

self.addEventListener("message", (event) => {
  if (event.data.type !== "price" || !priceAdvanced) return;
  const { requestId, parameters, paths, seed, config, method } = event.data;
  const started = performance.now();
  let pythonParameters;
  let result;
  try {
    pythonParameters = pyodide.toPy(Array.from(parameters));
    result = priceAdvanced(pythonParameters, paths, seed);
    const [price, standardError, standardDeviation] = result.toJs();
    postMessage({
      type: "result", requestId,
      result: {
        price, standardError, standardDeviation, samples: paths,
        elapsedMs: performance.now() - started, config, method,
      },
    });
  } catch (error) {
    postMessage({ type: "error", requestId, message: error.message || String(error) });
  } finally {
    pythonParameters?.destroy?.();
    result?.destroy?.();
  }
});

loadEngine();
