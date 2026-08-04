import { loadPyodide } from "./pyodide/pyodide.mjs?v=2";

let monteCarloPrice;
let generateDistribution;
let closedFormPrice;
let binomialPrice;
let americanBinomialPrice;
let baroneAdesiWhaleyPrice;
let juZhongPrice;
let carrRandomizationPrice;
let bjerksundStenslandPrice;
let bjerksundStensland2002Price;

async function loadEngine() {
  try {
    const indexURL = new URL("./pyodide/", self.location.href).href;
    const pyodide = await loadPyodide({ indexURL });
    const source = await fetch("./python/pricer.py?v=10").then((response) => {
      if (!response.ok) throw new Error(`Python source returned HTTP ${response.status}`);
      return response.text();
    });
    await pyodide.runPythonAsync(source);
    monteCarloPrice = pyodide.globals.get("price_option");
    generateDistribution = pyodide.globals.get("generate_distribution");
    closedFormPrice = pyodide.globals.get("black_scholes_price");
    binomialPrice = pyodide.globals.get("binomial_price");
    americanBinomialPrice = pyodide.globals.get("american_binomial_price");
    baroneAdesiWhaleyPrice = pyodide.globals.get("barone_adesi_whaley_price");
    juZhongPrice = pyodide.globals.get("ju_zhong_price");
    carrRandomizationPrice = pyodide.globals.get("carr_randomization_price");
    bjerksundStenslandPrice = pyodide.globals.get("bjerksund_stensland_price");
    bjerksundStensland2002Price = pyodide.globals.get("bjerksund_stensland_2002_price");
    postMessage({ type: "ready" });
  } catch (error) {
    postMessage({ type: "error", message: `Python engine failed: ${error.message}` });
  }
}

self.addEventListener("message", (event) => {
  if (event.data.type !== "price" || !monteCarloPrice) return;
  const { requestId, inputs } = event.data;
  const startedAt = performance.now();
  let priceResult;
  let distributionResult;

  try {
    const common = [inputs.spot, inputs.strike, inputs.rate, inputs.dividendYield,
      inputs.volatility, inputs.maturity];
    let price;
    let standardError = 0;
    let standardDeviation = 0;
    let distribution;

    if (inputs.method === "closed-form") {
      price = closedFormPrice(...common, inputs.optionType);
    } else if (inputs.method === "barone-adesi-whaley") {
      price = baroneAdesiWhaleyPrice(...common, inputs.optionType);
    } else if (inputs.method === "ju-zhong") {
      price = juZhongPrice(...common, inputs.optionType);
    } else if (inputs.method === "carr-randomization") {
      price = carrRandomizationPrice(...common, inputs.carrPhases, inputs.optionType);
    } else if (inputs.method === "bjerksund-stensland") {
      price = bjerksundStenslandPrice(...common, inputs.optionType);
    } else if (inputs.method === "bjerksund-stensland-2002") {
      price = bjerksundStensland2002Price(...common, inputs.optionType);
    } else if (inputs.method === "binomial") {
      const treePrice = inputs.exerciseStyle === "american"
        ? americanBinomialPrice
        : binomialPrice;
      price = treePrice(...common, inputs.steps, inputs.optionType);
    } else {
      priceResult = monteCarloPrice(
        ...common,
        inputs.paths,
        inputs.seed,
        inputs.optionType,
        inputs.sampling,
        inputs.varianceReduction,
      );
      [price, standardError, standardDeviation] = priceResult.toJs();
      if (inputs.includeDistribution) {
        distributionResult = generateDistribution(
          ...common,
          Math.min(inputs.paths, 5000),
          inputs.seed,
          inputs.optionType,
          inputs.sampling,
        );
        const [terminalValues, payoffValues] = distributionResult.toJs();
        distribution = {
          terminalPrices: Float64Array.from(terminalValues),
          payoffs: Float64Array.from(payoffValues),
        };
      }
    }

    if (![price, standardError, standardDeviation].every(Number.isFinite)) {
      throw new Error("The Python engine rejected the supplied inputs.");
    }
    const payload = {
      type: "result",
      requestId,
      price,
      standardError,
      standardDeviation,
      distribution,
      elapsedMs: performance.now() - startedAt,
    };
    const transfer = distribution
      ? [distribution.terminalPrices.buffer, distribution.payoffs.buffer]
      : [];
    postMessage(payload, transfer);
  } catch (error) {
    postMessage({ type: "error", requestId, message: error.message });
  } finally {
    priceResult?.destroy();
    distributionResult?.destroy();
  }
});

loadEngine();
