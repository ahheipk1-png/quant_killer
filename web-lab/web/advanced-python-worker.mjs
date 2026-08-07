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

// rainbow/himalayan's arbitrary-N basket assets don't fit the fixed 3-asset
// packed `parameters` header (shared byte-for-byte with the C++/Rust/C#
// engines, which stay capped at 3) -- so the extra assets travel as a
// separate flat list built from the raw `config` object instead:
// [assetCount, spot_2, vol_2, div_2, spot_3, vol_3, div_3, ...].
function extraAssetsFor(config) {
  if (config.product !== "rainbow" && config.product !== "himalayan") return null;
  const spots = Array.isArray(config.assetSpots) ? config.assetSpots : [];
  const vols = Array.isArray(config.assetVolatilities) ? config.assetVolatilities : [];
  const divs = Array.isArray(config.assetDividendYields) ? config.assetDividendYields : [];
  const assetCount = Math.trunc(Number(config.assetCount ?? (config.product === "rainbow" ? 2 : 3)));
  const extra = [assetCount];
  for (let index = 0; index < assetCount - 1; index += 1) {
    extra.push(Number(spots[index]), Number(vols[index]), Number(divs[index]));
  }
  return extra;
}

self.addEventListener("message", (event) => {
  if (event.data.type !== "price" || !priceAdvanced) return;
  const { requestId, parameters, paths, seed, config, method } = event.data;
  const started = performance.now();
  let pythonParameters;
  let extraAssets;
  let result;
  try {
    pythonParameters = pyodide.toPy(Array.from(parameters));
    extraAssets = pyodide.toPy(extraAssetsFor(config));
    result = priceAdvanced(pythonParameters, paths, seed, extraAssets);
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
    extraAssets?.destroy?.();
    result?.destroy?.();
  }
});

loadEngine();
