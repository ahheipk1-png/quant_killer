const fs = require("node:fs");
const path = require("node:path");
const base = require("./web/exotic-pricer.js");
const advanced = require("./web/advanced-pricer.js");

let assertions = 0;

function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function assertClose(name, actual, expected, tolerance) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${name}: expected ${expected}, received ${actual}, tolerance ${tolerance}`);
}

function assertThrows(name, evaluate, pattern) {
  let error = null;
  try {
    evaluate();
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof Error, `${name}: expected an exception`);
  assert(pattern.test(error.message), `${name}: unexpected message "${error.message}"`);
}

function assertDiagnostics(name, diagnostics, expected) {
  assert(diagnostics && typeof diagnostics === "object", `${name}: missing PDE diagnostics`);
  assert(diagnostics.solver === expected.solver,
    `${name}: expected solver ${expected.solver}, received ${diagnostics.solver}`);
  assert(diagnostics.gridType === expected.gridType,
    `${name}: expected grid ${expected.gridType}, received ${diagnostics.gridType}`);
  assert(diagnostics.payoffSmoothing === expected.smoothing,
    `${name}: expected smoothing ${expected.smoothing}, received ${diagnostics.payoffSmoothing}`);
  assert(diagnostics.rannacherSteps === expected.rannacher,
    `${name}: expected ${expected.rannacher} Rannacher intervals`);
  assert(diagnostics.converged, `${name}: solver did not converge`);
  assert(Number.isInteger(diagnostics.totalIterations) && diagnostics.totalIterations >= 0,
    `${name}: invalid total iteration count`);
  assert(Number.isInteger(diagnostics.maximumIterations) && diagnostics.maximumIterations >= 0,
    `${name}: invalid maximum iteration count`);
}

const common = {
  spot: 100, strike: 100, rate: 0.05, dividendYield: 0.01,
  volatility: 0.2, maturity: 1, decisionTime: 0.5,
  optionType: "call", paths: 100, monitoringSteps: 4,
  pdeGrid: 96, pdeTimeSteps: 160, pdeGridConcentration: 0.12,
  pdePayoffSmoothing: "cell-average", pdeRannacherSteps: 2,
  pdeTolerance: 1e-8, pdeMaxIterations: 10000, pdeSorOmega: 1.2, pdePenalty: 1e6,
};

// Grid construction, interpolation, unequal-spacing stencils, and terminal smoothing.
const grids = {
  uniform: base.buildSpatialGrid(0, 400, 80, "uniform", 100, 0.12),
  "sinh-strike": base.buildSpatialGrid(0, 400, 80, "sinh-strike", 100, 0.12),
  "sinh-spot": base.buildSpatialGrid(0, 400, 80, "sinh-spot", 120, 0.12),
};
for (const [name, grid] of Object.entries(grids)) {
  assert(grid[0] === 0 && grid.at(-1) === 400, `${name}: boundaries were not preserved`);
  for (let index = 1; index < grid.length; index += 1) {
    assert(grid[index] > grid[index - 1], `${name}: grid must be strictly increasing`);
  }
}
assertClose("uniform spacing", grids.uniform[2] - grids.uniform[1],
  grids.uniform[1] - grids.uniform[0], 1e-12);
assert(Math.abs((grids["sinh-strike"][2] - grids["sinh-strike"][1]) -
  (grids["sinh-strike"][1] - grids["sinh-strike"][0])) > 1e-6,
"Sinh strike grid must be nonuniform");
assert(Math.abs((grids["sinh-spot"][2] - grids["sinh-spot"][1]) -
  (grids["sinh-spot"][1] - grids["sinh-spot"][0])) > 1e-6,
"Sinh spot grid must be nonuniform");
const linearValues = Float64Array.from(grids["sinh-strike"], (value) => 2 * value + 3);
assertClose("nonuniform linear interpolation",
  base.interpolateOnGrid(grids["sinh-strike"], linearValues, 117.25), 237.5, 1e-11);

const stencilGrid = Float64Array.from([60, 90, 100, 130, 200]);
const stencilConfig = { volatility: 0.2, rate: 0.05, dividendYield: 0.01 };
const stencil = base.finiteDifferenceCoefficients(stencilConfig, stencilGrid, 2);
const applyStencil = (fn) => stencil.lower * fn(90) + stencil.diagonal * fn(100) +
  stencil.upper * fn(130);
assertClose("unequal-grid operator on a constant", applyStencil(() => 1), -0.05, 1e-12);
assertClose("unequal-grid operator on spot", applyStencil((spot) => spot), -1, 1e-11);
assertClose("unequal-grid operator on spot squared", applyStencil((spot) => spot ** 2),
  (0.2 ** 2 + 0.05 - 2 * 0.01) * 100 ** 2, 1e-9);
assertClose("cell-averaged digital call", base.averageTerminalPayoff({
  product: "digital", optionType: "call", strike: 100, cashPayoff: 10,
}, 90, 110), 5, 1e-12);
assertClose("cell-averaged digital put", base.averageTerminalPayoff({
  product: "digital", optionType: "put", strike: 100, cashPayoff: 10,
}, 90, 110), 5, 1e-12);
assertClose("cell-averaged vanilla call", base.averageTerminalPayoff({
  product: "vanilla", optionType: "call", strike: 100,
}, 90, 110), 2.5, 1e-12);
assertClose("cell-averaged vanilla put", base.averageTerminalPayoff({
  product: "vanilla", optionType: "put", strike: 100,
}, 90, 110), 2.5, 1e-12);

// Every new public validation path must reject bad controls with an actionable message.
const invalidCases = [
  ["unknown grid", { pdeGridType: "log" }, /grid type/i],
  ["low concentration", { pdeGridConcentration: 0.009 }, /concentration/i],
  ["high concentration", { pdeGridConcentration: 1.01 }, /concentration/i],
  ["unknown smoothing", { pdePayoffSmoothing: "spline" }, /smoothing/i],
  ["negative Rannacher", { pdeRannacherSteps: -1 }, /Rannacher/i],
  ["excess Rannacher", { pdeRannacherSteps: 9 }, /Rannacher/i],
  ["zero SOR omega", { pdeSorOmega: 0 }, /iteration controls/i],
  ["SOR omega two", { pdeSorOmega: 2 }, /iteration controls/i],
  ["zero tolerance", { pdeTolerance: 0 }, /iteration controls/i],
  ["zero maximum iterations", { pdeMaxIterations: 0 }, /iteration controls/i],
  ["zero penalty", { pdePenalty: 0 }, /iteration controls/i],
  ["small spot grid", { pdeGrid: 19 }, /grid\/time dimensions/i],
  ["large spot grid", { pdeGrid: 2001 }, /grid\/time dimensions/i],
  ["few time steps", { pdeTimeSteps: 9 }, /grid\/time dimensions/i],
  ["many time steps", { pdeTimeSteps: 10001 }, /grid\/time dimensions/i],
];
for (const [name, override, pattern] of invalidCases) {
  assertThrows(name, () => base.normalizeConfig({ ...common, ...override }), pattern);
}
assertThrows("unknown American solver", () => base.pdeSolve(base.normalizeConfig({
  ...common, product: "american",
}), "policy-iteration"), /solver must be projection, psor, or penalty/i);
assert(base.normalizeConfig({ ...common, product: "digital", pdePayoffSmoothing: undefined })
  .pdePayoffSmoothing === "cell-average", "Digital smoothing default must be cell-average");
assert(base.normalizeConfig({ ...common, product: "barrier", pdePayoffSmoothing: undefined })
  .pdePayoffSmoothing === "none", "Continuous payoff smoothing default must be none");

// American calls and puts: every solver on every spatial grid, with independent CRR references.
const americanCases = [
  { name: "ATM put", optionType: "put", spot: 100, strike: 100, rate: 0.05,
    dividendYield: 0, volatility: 0.2, maturity: 1 },
  { name: "ITM long put", optionType: "put", spot: 80, strike: 100, rate: 0.03,
    dividendYield: 0.01, volatility: 0.3, maturity: 2 },
  { name: "dividend call", optionType: "call", spot: 100, strike: 95, rate: 0.02,
    dividendYield: 0.08, volatility: 0.25, maturity: 1.5 },
  { name: "no-dividend call", optionType: "call", spot: 120, strike: 100, rate: 0.05,
    dividendYield: 0, volatility: 0.2, maturity: 0.5 },
];
const americanResults = [];
for (const definition of americanCases) {
  const config = base.normalizeConfig({
    ...common, ...definition, product: "american", decisionTime: definition.maturity * 0.5,
  });
  const treeConfig = base.normalizeConfig({
    ...config, product: "bermudan", exerciseDates: 16, treeSteps: 1200,
  });
  const tree = base.bermudanTree({ ...treeConfig, exerciseDates: treeConfig.treeSteps }).price;
  const european = base.blackScholes(config);
  for (const method of base.PRODUCT_METHODS.american) {
    const solver = method.slice(4);
    for (const gridType of Object.keys(grids)) {
      const result = base.price({ ...config, pdeGridType: gridType }, method);
      const label = `${definition.name}/${solver}/${gridType}`;
      assertDiagnostics(label, result.pdeDiagnostics, {
        solver, gridType, smoothing: "cell-average", rannacher: 2,
      });
      assert(result.pdeDiagnostics.totalIterations > 0, `${label}: no solver work reported`);
      assert(result.price + 1e-8 >= base.vanillaPayoff(
        definition.spot, definition.strike, definition.optionType,
      ), `${label}: American value is below intrinsic`);
      assert(result.price + 0.03 >= european, `${label}: American value is below European value`);
      assertClose(`${label} vs 1,200-step CRR`, result.price, tree, 0.16);
      americanResults.push({ case: definition.name, solver, gridType, price: result.price, tree });
    }
  }
}

const noDividendCall = base.normalizeConfig({
  ...common, product: "american", optionType: "call", dividendYield: 0,
});
for (const method of base.PRODUCT_METHODS.american) {
  assertClose(`${method} no-dividend call reduction`,
    base.price({ ...noDividendCall, pdeGridType: "sinh-strike" }, method).price,
    base.blackScholes(noDividendCall), 0.025);
}

// Every one-factor PDE payoff under the full grid x smoothing x Rannacher matrix.
const oneFactorCases = [
  { name: "digital call", product: "digital", optionType: "call", cashPayoff: 10,
    reference: (config) => base.digitalClosedForm(config), tolerance: 0.80 },
  { name: "digital put", product: "digital", optionType: "put", cashPayoff: 10,
    reference: (config) => base.digitalClosedForm(config), tolerance: 0.80 },
  { name: "up-and-out call", product: "barrier", optionType: "call", strike: 95,
    barrier: 145, barrierDirection: "up", barrierStyle: "out",
    reference: (config) => base.barrierClosedForm(config), tolerance: 0.22 },
  { name: "down-and-out put", product: "barrier", optionType: "put", strike: 105,
    barrier: 60, barrierDirection: "down", barrierStyle: "out",
    reference: (config) => base.barrierClosedForm(config), tolerance: 0.22 },
  { name: "double-out call", product: "double-barrier", optionType: "call", strike: 95,
    lowerBarrier: 55, upperBarrier: 155, barrierStyle: "out",
    reference: (config) => base.doubleBarrierSpectral(config), tolerance: 0.25 },
  { name: "double-out put", product: "double-barrier", optionType: "put", strike: 105,
    lowerBarrier: 55, upperBarrier: 155, barrierStyle: "out",
    reference: (config) => base.doubleBarrierSpectral(config), tolerance: 0.25 },
  { name: "Bermudan call", product: "bermudan", optionType: "call", exerciseDates: 4,
    treeSteps: 1000, reference: (config) => base.bermudanTree(config).price, tolerance: 0.25 },
  { name: "Bermudan put", product: "bermudan", optionType: "put", exerciseDates: 4,
    treeSteps: 1000, reference: (config) => base.bermudanTree(config).price, tolerance: 0.25 },
];
const oneFactorResults = [];
for (const definition of oneFactorCases) {
  const config = base.normalizeConfig({
    ...common, ...definition, pdeGrid: 64, pdeTimeSteps: 96,
  });
  const reference = definition.reference(config);
  for (const gridType of Object.keys(grids)) {
    for (const smoothing of ["none", "cell-average"]) {
      for (const rannacher of [0, 2, 4]) {
        const solved = base.pdeSolve({
          ...config, pdeGridType: gridType, pdePayoffSmoothing: smoothing,
          pdeRannacherSteps: rannacher,
        });
        const label = `${definition.name}/${gridType}/${smoothing}/R${rannacher}`;
        assertDiagnostics(label, solved.diagnostics, {
          solver: "linear-thomas", gridType, smoothing, rannacher,
        });
        assert(Number.isFinite(solved.price) && solved.price >= -1e-8,
          `${label}: invalid non-negative option value ${solved.price}`);
        assertClose(`${label} vs independent reference`, solved.price, reference, definition.tolerance);
        oneFactorResults.push({ product: definition.name, gridType, smoothing, rannacher,
          price: solved.price, reference });
      }
    }
  }
}

// Prove that the selectors actually change the numerical path on a deliberately coarse grid.
const selectorConfig = base.normalizeConfig({
  ...common, product: "digital", pdeGrid: 43, pdeTimeSteps: 48,
  pdeGridType: "uniform", pdePayoffSmoothing: "none", pdeRannacherSteps: 0,
});
const rawPrice = base.pdePrice(selectorConfig);
const smoothedPrice = base.pdePrice({ ...selectorConfig, pdePayoffSmoothing: "cell-average" });
const dampedPrice = base.pdePrice({ ...selectorConfig, pdeRannacherSteps: 4 });
const clusteredPrice = base.pdePrice({ ...selectorConfig, pdeGridType: "sinh-strike" });
assert(Math.abs(rawPrice - smoothedPrice) > 1e-8, "Payoff smoothing selector did not change the solve");
assert(Math.abs(rawPrice - dampedPrice) > 1e-8, "Rannacher selector did not change the solve");
assert(Math.abs(rawPrice - clusteredPrice) > 1e-8, "Spatial-grid selector did not change the solve");

// Already-breached single and double barriers use the exact boundary reductions.
const boundaryCases = [
  { name: "down barrier", product: "barrier", spot: 80, barrier: 90,
    barrierDirection: "down" },
  { name: "up barrier", product: "barrier", spot: 150, barrier: 140,
    barrierDirection: "up" },
  { name: "double lower barrier", product: "double-barrier", spot: 60,
    lowerBarrier: 70, upperBarrier: 140 },
  { name: "double upper barrier", product: "double-barrier", spot: 150,
    lowerBarrier: 70, upperBarrier: 140 },
];
for (const definition of boundaryCases) {
  const outConfig = base.normalizeConfig({
    ...common, ...definition, barrierStyle: "out", pdeGridType: "sinh-spot",
  });
  const outResult = base.price(outConfig, "pde");
  assertClose(`${definition.name} knock-out boundary`, outResult.price, 0, 0);
  assertDiagnostics(`${definition.name} knock-out diagnostics`, outResult.pdeDiagnostics, {
    solver: "boundary-hit", gridType: "sinh-spot", smoothing: "cell-average", rannacher: 2,
  });
  const inResult = base.price({ ...outConfig, barrierStyle: "in" }, "pde");
  assertClose(`${definition.name} knock-in boundary`, inResult.price,
    base.blackScholes(outConfig), 1e-12);
  assertDiagnostics(`${definition.name} knock-in diagnostics`, inResult.pdeDiagnostics, {
    solver: "boundary-hit", gridType: "sinh-spot", smoothing: "cell-average", rannacher: 2,
  });
}

// Asian ADI: both axes, all spatial grids, smoothing choices, damping choices,
// an uneven observation schedule, and both option directions.
const asianCommon = {
  ...common, product: "asian", volatilityModel: "constant", termVolatility: 0.2,
  observationTimes: [0.13, 0.41, 0.76, 1], monitoringSteps: 4,
  paths: 8192, seed: 99173, pdeSpotGrid: 72, pdeAverageGrid: 72, pdeTimeSteps: 160,
};
const asianResults = [];
for (const optionType of ["call", "put"]) {
  const reference = advanced.price({
    ...asianCommon, optionType, pdePayoffSmoothing: "none",
  }, "qmc").price;
  for (const gridType of Object.keys(grids)) {
    for (const smoothing of ["none", "cell-average"]) {
      for (const rannacher of [0, 2, 4]) {
        const result = advanced.price({
          ...asianCommon, optionType, pdeGridType: gridType,
          pdePayoffSmoothing: smoothing, pdeRannacherSteps: rannacher,
        }, "adi");
        const label = `Asian ${optionType}/${gridType}/${smoothing}/R${rannacher}`;
        assert(Number.isFinite(result.price) && result.price >= -1e-8,
          `${label}: invalid price ${result.price}`);
        assertClose(`${label} vs uneven-schedule Sobol QMC`, result.price, reference, 0.55);
        asianResults.push({ optionType, gridType, smoothing, rannacher,
          price: result.price, reference });
      }
    }
  }
}
const asianRaw = advanced.price({
  ...asianCommon, pdeGridType: "uniform", pdePayoffSmoothing: "none", pdeRannacherSteps: 0,
}, "adi").price;
const asianSmoothed = advanced.price({
  ...asianCommon, pdeGridType: "uniform", pdePayoffSmoothing: "cell-average", pdeRannacherSteps: 0,
}, "adi").price;
const asianDamped = advanced.price({
  ...asianCommon, pdeGridType: "uniform", pdePayoffSmoothing: "none", pdeRannacherSteps: 4,
}, "adi").price;
assert(Math.abs(asianRaw - asianSmoothed) > 1e-10,
  "Asian payoff smoothing selector did not change the ADI solve");
assert(Math.abs(asianRaw - asianDamped) > 1e-10,
  "Asian Rannacher selector did not change the ADI solve");

// Static integration checks prevent the tested controls from disappearing between UI and workers.
const webFile = (name) => fs.readFileSync(path.join(__dirname, "web", name), "utf8");
const exoticsHtml = webFile("exotics.html");
for (const id of ["pdeGrid", "pdeGridType", "pdeGridConcentration", "pdePayoffSmoothing",
  "pdeRannacherSteps", "pdeAverageGrid", "pdeSorOmega", "pdeTolerance",
  "pdeMaxIterations", "pdePenalty"]) {
  assert(exoticsHtml.includes(`id="${id}"`), `Exotic UI is missing #${id}`);
}
for (const value of ["american", "uniform", "sinh-strike", "sinh-spot", "none", "cell-average"]) {
  assert(exoticsHtml.includes(`value="${value}"`), `Exotic UI is missing ${value}`);
}
const exoticsJs = webFile("exotics.js");
for (const token of ["pde-projection", "pde-psor", "pde-penalty", "american-pde",
  "pdeGridType", "new FormData(form)"]) {
  assert(exoticsJs.includes(token), `Exotic controller is missing ${token}`);
}
const exoticWorker = webFile("exotic-worker.js");
assert(exoticWorker.includes('importScripts("exotic-pricer.js?v=6")'),
  "Exotic worker is not pinned to the current base PDE engine");
assert(exoticWorker.includes('importScripts("advanced-pricer.js?v=5")'),
  "Exotic worker is not pinned to the current Asian ADI engine");
const portfolio = webFile("portfolio.js");
for (const token of ["american", "pde-projection", "pde-psor", "pde-penalty"]) {
  assert(portfolio.includes(token), `Portfolio UI is missing ${token}`);
}
const payoffHtml = webFile("payoff-tests.html");
assert(payoffHtml.includes("exotic-pricer.js?v=6") && payoffHtml.includes("advanced-pricer.js?v=5"),
  "Browser test report is not loading the current PDE engines");
assert(payoffHtml.includes("pricing-regression.js"),
  "Browser test report is not loading pricing regressions");

console.log(JSON.stringify({
  assertions,
  matrices: {
    american: americanResults.length,
    oneFactor: oneFactorResults.length,
    asianAdi: asianResults.length,
    invalidControls: invalidCases.length + 1,
    boundaryReductions: boundaryCases.length * 2,
  },
  selectorPrices: { rawPrice, smoothedPrice, dampedPrice, clusteredPrice,
    asianRaw, asianSmoothed, asianDamped },
  status: "all PDE feature, validation, integration, and numerical regression tests passed",
}, null, 2));
