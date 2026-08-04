const fs = require("node:fs");
const path = require("node:path");
const createCppModule = require("./web/pricer.js");
const base = require("./web/exotic-pricer.js");
const advanced = require("./web/advanced-pricer.js");
const contract = require("./web/polyglot-contract.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertClose(name, actual, expected, tolerance = 1e-8) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${name}: expected ${expected}, received ${actual}`);
  }
}

const overrides = {
  digital: { cashPayoff: 10 },
  barrier: { barrier: 130, barrierDirection: "up", barrierStyle: "out" },
  "double-barrier": { lowerBarrier: 70, upperBarrier: 140, barrierStyle: "out" },
  bermudan: { optionType: "put", exerciseDates: 4 },
  rainbow: { spot2: 95, volatility2: 0.25, dividendYield2: 0.01, rainbowStyle: "best" },
  autocallable: { notional: 100, coupon: 0.02, autocallBarrier: 1, protectionBarrier: 0.7 },
  himalayan: { assetCount: 3, observations: 3, notional: 100 },
  lookback: {}, ladder: { ladderRungs: [110, 120, 130] },
  compound: { decisionTime: 0.5, compoundStrike: 5, compoundOuterType: "put", compoundInnerType: "call" },
  asian: { includeInitialFixing: true },
  "phoenix-autocall": { notional: 100, coupon: 0.02, couponBarrier: 0.7, autocallBarrier: 1, protectionBarrier: 0.7 },
  "variance-swap": { varianceStrike: 0.04, varianceNotional: 1000 },
  "volatility-swap": { volatilityStrike: 0.2, varianceNotional: 1000 },
  "variance-option": { varianceStrike: 0.04, varianceNotional: 1000 },
  "volatility-option": { volatilityStrike: 0.2, varianceNotional: 1000 },
  accumulator: { accumulatorQuantity: 1, accumulatorGearing: 2, accumulatorKnockOut: 1.1 },
  "yield-seeker": { notional: 100, coupon: 0.02, couponBarrier: 0.7, protectionBarrier: 0.7 },
};

const common = {
  spot: 100, strike: 100, rate: 0.03, dividendYield: 0.01,
  volatility: 0.2, termVolatility: 0.25, localBeta: -0.2,
  hestonKappa: 1.8, hestonLongRunVol: 0.22, hestonVolOfVol: 0.35, hestonRho: -0.55,
  volatilityModel: "slv", maturity: 1, optionType: "call", monitoringSteps: 4,
  spot2: 95, volatility2: 0.25, dividendYield2: 0.01,
  spot3: 105, volatility3: 0.3, dividendYield3: 0.02,
  correlation: 0.3, paths: 512, seed: 99173,
};

async function main() {
  const payoffRows = [...base.runPayoffUnitTests(), ...advanced.runAdvancedPayoffUnitTests()];
  assert(payoffRows.length >= 54, "Expected direct unit coverage for every payoff family");
  assert(payoffRows.every((row) => row.passed),
    `Payoff failures: ${payoffRows.filter((row) => !row.passed).map((row) => row.name).join(", ")}`);

  const volatilityRows = advanced.runVolatilityRegressions(512);
  assert(volatilityRows.length === 84, `Expected 84 volatility limits, received ${volatilityRows.length}`);
  assert(volatilityRows.every((row) => row.passed),
    `Volatility-limit failures: ${volatilityRows.filter((row) => !row.passed).map((row) => row.name).join(", ")}`);

  const asian = {
    ...common, product: "asian", volatilityModel: "constant", termVolatility: common.volatility,
    monitoringSteps: 6, paths: 8192, pdeSpotGrid: 48, pdeAverageGrid: 48, pdeTimeSteps: 120,
  };
  const asianResults = Object.fromEntries(advanced.PRODUCT_METHODS.asian.map((method) =>
    [method, advanced.price(asian, method).price]));
  for (const [method, value] of Object.entries(asianResults)) {
    assert(Number.isFinite(value) && value >= 0, `Asian ${method} returned ${value}`);
  }
  const asianReference = asianResults.qmc;
  for (const method of ["levy", "shifted-lognormal", "curran", "curran-two-moment", "ju-taylor", "adi"]) {
    assert(Math.abs(asianResults[method] - asianReference) < 0.4,
      `Asian ${method} is not sensible against Sobol QMC`);
  }
  const juAsianCases = [
    { name: "monthly ATM call", config: { ...asian, monitoringSteps: 12, paths: 32768 } },
    { name: "uneven put with initial fixing", config: {
      ...asian, optionType: "put", strike: 110, includeInitialFixing: true,
      observationTimes: [0.1, 0.4, 0.9, 1.0], paths: 32768,
    } },
    { name: "positive-weight two-asset basket", config: {
      ...asian, monitoringSteps: 6, paths: 32768,
      underlyingMode: "weighted-price", basketAssetCount: 2, basketWeights: [0.6, 0.4],
      spot2: 95, volatility2: 0.25, dividendYield2: 0.01, correlation: 0.4,
    } },
  ];
  const juAsianBenchmarks = juAsianCases.map(({ name, config }) => {
    const ju = advanced.price(config, "ju-taylor").price;
    const qmc = advanced.price(config, "qmc").price;
    assertClose(`Ju Asian vs Sobol QMC: ${name}`, ju, qmc, 0.05);
    return { name, ju, qmc, difference: ju - qmc };
  });
  const oneFixingAsian = { ...asian, monitoringSteps: 1, includeInitialFixing: false };
  assertClose("Ju one-fixing reduction to Black-Scholes",
    advanced.price(oneFixingAsian, "ju-taylor").price,
    base.blackScholes(oneFixingAsian), 1e-11);

  const constantVariance = advanced.normalizeConfig({
    ...common, product: "variance-swap", volatilityModel: "constant",
    termVolatility: 0.2, varianceStrike: 0.04, varianceNotional: 1000,
  });
  assertClose("constant-vol static variance replication", advanced.staticVarianceSwapPrice(constantVariance), 0, 2e-7);
  const termFairVariance = (0.2 ** 2 + 0.2 * 0.3 + 0.3 ** 2) / 3;
  const termVariance = advanced.normalizeConfig({
    ...constantVariance, volatilityModel: "term", termVolatility: 0.3,
    varianceStrike: termFairVariance,
  });
  assertClose("term-vol static variance replication", advanced.staticVarianceSwapPrice(termVariance), 0, 2e-7);

  const cpp = await createCppModule({ locateFile: (file) => path.join(__dirname, "web", file) });
  const rust = (await WebAssembly.instantiate(fs.readFileSync(path.join(__dirname, "web", "rust-pricer.wasm")), {})).instance;
  const setCpp = cpp.cwrap("qk_advanced_set_parameter", null, ["number", "number"]);
  const priceCpp = cpp.cwrap("qk_advanced_price", "number", ["number", "number"]);
  const juCpp = cpp.cwrap("qk_ju_american_price", "number", [
    "number", "number", "number", "number", "number", "number", "number",
  ]);
  const carrCpp = cpp.cwrap("qk_carr_randomization_price", "number", [
    "number", "number", "number", "number", "number", "number", "number", "number",
  ]);
  const juCases = [
    [100, 100, 0.05, 0, 0.2, 1, 0],
    [100, 100, 0.05, 0.08, 0.2, 1, 1],
  ];
  for (const inputs of juCases) {
    assertClose("Ju-Zhong Rust/C++ parity",
      rust.exports.qk_ju_american_price(...inputs), juCpp(...inputs), 1e-12);
  }
  const carrCases = [
    [100, 100, 0.05, 0, 0.2, 1, 32, 0],
    [100, 100, 0.05, 0.08, 0.2, 1, 32, 1],
  ];
  const carrParity = carrCases.map((inputs) => {
    const cppPrice = carrCpp(...inputs);
    const rustPrice = rust.exports.qk_carr_randomization_price(...inputs);
    assertClose("Carr Rust/C++ parity", rustPrice, cppPrice, 1e-11);
    return { inputs, cppPrice, rustPrice };
  });
  const crossLanguage = [];
  for (const product of Object.keys(contract.PRODUCT_CODES)) {
    const config = { ...common, product, ...overrides[product] };
    const parameters = contract.pack(config);
    parameters.forEach((value, index) => {
      setCpp(index, value);
      rust.exports.qk_advanced_set_parameter(index, value);
    });
    const cppPrice = priceCpp(config.paths, config.seed);
    const rustPrice = rust.exports.qk_advanced_price(config.paths, config.seed);
    const jsPrice = advanced.price(config, "mc").price;
    // Most contracts agree to machine precision. A selection payoff such as
    // Himalayan can flip the selected asset on nearly tied platform math, so
    // cross-runtime acceptance uses a small absolute pricing tolerance.
    assertClose(`${product}: Rust/C++ parity`, rustPrice, cppPrice, 0.05);
    assertClose(`${product}: JavaScript/C++ parity`, jsPrice, cppPrice, 0.05);
    crossLanguage.push({ product, jsPrice, cppPrice, rustPrice });
  }
  const basketCrossLanguage = [];
  for (const product of Object.keys(contract.PRODUCT_CODES).filter((name) => !["rainbow", "himalayan"].includes(name))) {
    const config = {
      ...common, product, ...overrides[product], paths: 256,
      underlyingMode: "weighted-returns", basketAssetCount: 3, basketWeights: [0.5, 0.3, 0.2],
    };
    const parameters = contract.pack(config);
    parameters.forEach((value, index) => {
      setCpp(index, value);
      rust.exports.qk_advanced_set_parameter(index, value);
    });
    const cppPrice = priceCpp(config.paths, config.seed);
    const rustPrice = rust.exports.qk_advanced_price(config.paths, config.seed);
    const jsPrice = advanced.price(config, "mc").price;
    assertClose(`${product} basket: Rust/C++ parity`, rustPrice, cppPrice, 0.05);
    assertClose(`${product} basket: JavaScript/C++ parity`, jsPrice, cppPrice, 0.05);
    basketCrossLanguage.push({ product, jsPrice, cppPrice, rustPrice });
  }

  console.log(JSON.stringify({
    payoffTests: payoffRows.length,
    payoffFamilies: Object.keys({ ...base.PAYOFF_DEFINITIONS, ...advanced.ADVANCED_PAYOFF_DEFINITIONS }),
    volatilityLimitTests: volatilityRows.length,
    asianResults,
    juAsianBenchmarks,
    carrParity,
    crossLanguage,
    basketCrossLanguage,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
