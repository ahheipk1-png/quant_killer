let monteCarloPrice;
let getLastStandardError;
let getLastStandardDeviation;
let generateDistribution;
let distributionTerminalAt;
let distributionPayoffAt;
let closedFormPrice;
let binomialPrice;
let americanBinomialPrice;
let baroneAdesiWhaleyPrice;
let juZhongPrice;
let carrRandomizationPrice;
let bjerksundStenslandPrice;
let bjerksundStensland2002Price;

const samplingModes = { pcg: 0, sobol: 1, rqmc: 2 };
const varianceModes = {
  none: 0,
  antithetic: 1,
  control: 2,
  "antithetic-control": 3,
};

async function loadEngine() {
  try {
    importScripts("pricer.js?v=10");
    const module = await createQuantKillerModule({ locateFile: (path) => path });
    monteCarloPrice = module.cwrap("qk_mc_european_price", "number", [
      "number", "number", "number", "number", "number", "number",
      "number", "number", "number", "number", "number",
    ]);
    getLastStandardError = module.cwrap("qk_mc_last_std_error", "number", []);
    getLastStandardDeviation = module.cwrap("qk_mc_last_std_dev", "number", []);
    generateDistribution = module.cwrap("qk_mc_generate_distribution", "number", [
      "number", "number", "number", "number", "number", "number",
      "number", "number", "number", "number",
    ]);
    distributionTerminalAt = module.cwrap("qk_mc_distribution_terminal", "number", ["number"]);
    distributionPayoffAt = module.cwrap("qk_mc_distribution_payoff", "number", ["number"]);
    closedFormPrice = module.cwrap("qk_bs_european_price", "number", [
      "number", "number", "number", "number", "number", "number", "number",
    ]);
    binomialPrice = module.cwrap("qk_binomial_european_price", "number", [
      "number", "number", "number", "number", "number", "number", "number", "number",
    ]);
    americanBinomialPrice = module.cwrap("qk_binomial_american_price", "number", [
      "number", "number", "number", "number", "number", "number", "number", "number",
    ]);
    baroneAdesiWhaleyPrice = module.cwrap("qk_baw_american_price", "number", [
      "number", "number", "number", "number", "number", "number", "number",
    ]);
    juZhongPrice = module.cwrap("qk_ju_american_price", "number", [
      "number", "number", "number", "number", "number", "number", "number",
    ]);
    carrRandomizationPrice = module.cwrap("qk_carr_randomization_price", "number", [
      "number", "number", "number", "number", "number", "number", "number", "number",
    ]);
    bjerksundStenslandPrice = module.cwrap("qk_bjerksund_american_price", "number", [
      "number", "number", "number", "number", "number", "number", "number",
    ]);
    bjerksundStensland2002Price = module.cwrap("qk_bjerksund_2002_american_price", "number", [
      "number", "number", "number", "number", "number", "number", "number",
    ]);
    postMessage({ type: "ready" });
  } catch (error) {
    postMessage({ type: "error", message: `Could not load the C++ WebAssembly engine: ${error.message}` });
  }
}

self.addEventListener("message", (event) => {
  if (event.data.type !== "price" || !monteCarloPrice) return;
  const { requestId, inputs } = event.data;
  const startedAt = performance.now();
  try {
    const common = [inputs.spot, inputs.strike, inputs.rate, inputs.dividendYield,
      inputs.volatility, inputs.maturity];
    let price;
    let standardError = 0;
    let standardDeviation = 0;
    let distribution;

    if (inputs.method === "closed-form") {
      price = closedFormPrice(...common, inputs.optionType === "call" ? 1 : 0);
    } else if (inputs.method === "barone-adesi-whaley") {
      price = baroneAdesiWhaleyPrice(...common, inputs.optionType === "call" ? 1 : 0);
    } else if (inputs.method === "ju-zhong") {
      price = juZhongPrice(...common, inputs.optionType === "call" ? 1 : 0);
    } else if (inputs.method === "carr-randomization") {
      price = carrRandomizationPrice(...common, inputs.carrPhases, inputs.optionType === "call" ? 1 : 0);
    } else if (inputs.method === "bjerksund-stensland") {
      price = bjerksundStenslandPrice(...common, inputs.optionType === "call" ? 1 : 0);
    } else if (inputs.method === "bjerksund-stensland-2002") {
      price = bjerksundStensland2002Price(...common, inputs.optionType === "call" ? 1 : 0);
    } else if (inputs.method === "binomial") {
      const treePrice = inputs.exerciseStyle === "american"
        ? americanBinomialPrice
        : binomialPrice;
      price = treePrice(...common, inputs.steps, inputs.optionType === "call" ? 1 : 0);
    } else {
      price = monteCarloPrice(
        ...common,
        inputs.paths,
        inputs.seed,
        inputs.optionType === "call" ? 1 : 0,
        samplingModes[inputs.sampling],
        varianceModes[inputs.varianceReduction],
      );
      standardError = getLastStandardError();
      standardDeviation = getLastStandardDeviation();
      if (inputs.includeDistribution) {
        const count = generateDistribution(
          ...common,
          Math.min(inputs.paths, 5000),
          inputs.seed,
          inputs.optionType === "call" ? 1 : 0,
          samplingModes[inputs.sampling],
        );
        const terminalPrices = new Float64Array(count);
        const payoffs = new Float64Array(count);
        for (let index = 0; index < count; index += 1) {
          terminalPrices[index] = distributionTerminalAt(index);
          payoffs[index] = distributionPayoffAt(index);
        }
        distribution = { terminalPrices, payoffs };
      }
    }

    if (![price, standardError, standardDeviation].every(Number.isFinite)) {
      throw new Error("The C++ engine rejected the supplied inputs.");
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
  }
});

loadEngine();
