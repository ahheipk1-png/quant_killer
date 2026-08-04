const pricer = require("./web/exotic-pricer.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const overrides = {
  digital: { cashPayoff: 10 },
  barrier: {
    barrier: 130,
    barrierDirection: "up",
    barrierStyle: "out",
    monitoringSteps: 6,
  },
  "double-barrier": {
    lowerBarrier: 70,
    upperBarrier: 140,
    barrierStyle: "out",
    monitoringSteps: 6,
  },
  bermudan: { optionType: "put", exerciseDates: 4, treeSteps: 300 },
  rainbow: {
    spot2: 95,
    volatility2: 0.25,
    dividendYield2: 0.01,
    correlation: 0.4,
    rainbowStyle: "best",
  },
  autocallable: {
    notional: 100,
    coupon: 0.02,
    autocallBarrier: 1.0,
    protectionBarrier: 0.7,
    monitoringSteps: 4,
  },
  himalayan: {
    assetCount: 3,
    observations: 3,
    spot2: 100,
    spot3: 105,
    volatility2: 0.25,
    volatility3: 0.3,
    correlation: 0.3,
    notional: 100,
    returnStrike: 0.0,
  },
  lookback: { monitoringSteps: 6 },
  ladder: { monitoringSteps: 6, ladderRungs: [110, 120, 130] },
  compound: { decisionTime: 0.5, compoundStrike: 5 },
};

const methodResults = [];
for (const [product, methods] of Object.entries(pricer.PRODUCT_METHODS)) {
  for (const method of methods) {
    const result = pricer.price({
      product,
      spot: 100,
      strike: 100,
      rate: 0.05,
      dividendYield: 0.0,
      volatility: 0.2,
      maturity: 1.0,
      optionType: "call",
      paths: 4096,
      seed: 42,
      randomizedQmc: false,
      monitoringSteps: 6,
      pdeGrid: 140,
      pdeTimeSteps: 240,
      ...overrides[product],
    }, method);
    assert(Number.isFinite(result.price), `${product}/${method} returned a non-finite price`);
    assert(result.price >= -1e-10, `${product}/${method} returned a negative price`);
    methodResults.push({ product, method, price: result.price });
  }
}

const benchmarks = pricer.runBenchmarks();
assert(benchmarks.length >= 15, "Expected the full exotic benchmark suite");
const failures = benchmarks.filter((row) => !row.passed);
assert(failures.length === 0, `Benchmark failures: ${failures.map((row) => row.name).join(", ")}`);

const payoffTests = pricer.runPayoffUnitTests();
assert(payoffTests.length >= 34, "Expected unit coverage for every payoff family");
const payoffFailures = payoffTests.filter((row) => !row.passed);
assert(payoffFailures.length === 0,
  `Payoff unit-test failures: ${payoffFailures.map((row) => row.name).join(", ")}`);

console.log(JSON.stringify({
  pricedMethods: methodResults.length,
  benchmarkTests: benchmarks.length,
  payoffUnitTests: payoffTests.length,
  payoffFamilies: Object.keys(pricer.PAYOFF_DEFINITIONS),
  products: Object.keys(pricer.PRODUCT_METHODS),
  methodResults,
  benchmarkSummary: benchmarks.map(({ name, absoluteError, tolerance, passed }) => ({
    name, absoluteError, tolerance, passed,
  })),
}, null, 2));
