const fs = require("node:fs");
const path = require("node:path");
const vol = require("./web/volatility-models.js");

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
  try { evaluate(); } catch (caught) { error = caught; }
  assert(error instanceof Error, `${name}: expected an exception`);
  assert(pattern.test(error.message), `${name}: unexpected message ${error.message}`);
}

const market = { spot: 100, rate: 0.04, dividendYield: 0.01 };

// Robust price-to-vol inversion over calls, puts, strikes, maturities, and bounds.
const inversionCases = [
  { strike: 60, maturity: 0.5, volatility: 0.25, optionType: "call" },
  { strike: 80, maturity: 0.5, volatility: 0.22, optionType: "put" },
  { strike: 100, maturity: 1, volatility: 0.35, optionType: "call" },
  { strike: 125, maturity: 2, volatility: 0.55, optionType: "put" },
  { strike: 200, maturity: 4, volatility: 0.8, optionType: "call" },
];
for (const definition of inversionCases) {
  const contract = { ...market, ...definition };
  const price = vol.blackScholesPrice(contract, definition.volatility, definition.optionType);
  const result = vol.impliedVolatility(contract, price, definition.optionType);
  assert(result.converged, `IV inversion did not converge for ${JSON.stringify(definition)}`);
  assertClose(`IV inversion ${definition.optionType}/K=${definition.strike}`,
    result.volatility, definition.volatility, 2e-9);
  assertClose("IV repricing residual", result.residual, 0, 1e-8);
}
const boundContract = { ...market, strike: 100, maturity: 1 };
const bounds = vol.blackScholesBounds(boundContract, "call");
assertClose("lower-bound implied volatility",
  vol.impliedVolatility(boundContract, bounds.lower, "call").volatility, 0, 0);
assertThrows("price below arbitrage bound",
  () => vol.impliedVolatility(boundContract, bounds.lower - 1, "call"), /arbitrage bounds/i);
assertThrows("price above arbitrage bound",
  () => vol.impliedVolatility(boundContract, bounds.upper + 1, "call"), /arbitrage bounds/i);

const priceCsv = `maturity,strike,price,type
1,90,${vol.blackScholesPrice({ ...market, strike: 90, maturity: 1 }, 0.31, "call")},call
1,110,${vol.blackScholesPrice({ ...market, strike: 110, maturity: 1 }, 0.27, "put")},put`;
const priceQuotes = vol.parseMarketQuotes(priceCsv, market);
assertClose("call-price CSV inversion", priceQuotes[0].impliedVolatility, 0.31, 2e-9);
assertClose("put-price CSV inversion", priceQuotes[1].impliedVolatility, 0.27, 2e-9);
const percentQuotes = vol.parseMarketQuotes("maturity,strike,iv\n1,100,22", market);
assertClose("percent quote normalization", percentQuotes[0].impliedVolatility, 0.22, 0);
const bidAskQuotes = vol.parseMarketQuotes(
  "maturity,strike,bidiv,askiv\n1,100,21,23", market,
);
assertClose("bid/ask midpoint quote", bidAskQuotes[0].impliedVolatility, 0.22, 1e-14);
assertClose("bid quote normalization", bidAskQuotes[0].bidVolatility, 0.21, 1e-14);
assertClose("ask quote normalization", bidAskQuotes[0].askVolatility, 0.23, 1e-14);

// Maturity interpolation, extrapolation, forward variance, and calendar repair.
const pillars = [
  { maturity: 0.25, totalVariance: 0.012, volatility: Math.sqrt(0.012 / 0.25) },
  { maturity: 1, totalVariance: 0.05, volatility: Math.sqrt(0.05) },
  { maturity: 2, totalVariance: 0.11, volatility: Math.sqrt(0.055) },
];
for (const method of Object.keys(vol.TERM_METHODS)) {
  const curve = vol.buildTermStructure(pillars, method, true);
  pillars.forEach((pillar) => assertClose(`${method} pillar ${pillar.maturity}`,
    curve.totalVariance(pillar.maturity), pillar.totalVariance, 1e-12));
  assert(curve.totalVariance(0.1) >= 0, `${method}: negative short extrapolation`);
  assert(curve.totalVariance(3) >= curve.totalVariance(2), `${method}: decreasing long extrapolation`);
}
const linearTerm = vol.buildTermStructure(pillars, "linear-total-variance", false);
assertClose("middle forward variance", linearTerm.forwardVariances[1],
  (0.05 - 0.012) / 0.75, 1e-12);
const repairedTerm = vol.buildTermStructure([
  { maturity: 0.5, totalVariance: 0.04, volatility: Math.sqrt(0.08) },
  { maturity: 1, totalVariance: 0.03, volatility: Math.sqrt(0.03) },
  { maturity: 2, totalVariance: 0.09, volatility: Math.sqrt(0.045) },
], "pchip-total-variance", true);
assert(repairedTerm.repaired, "Calendar repair flag was not set");
for (let index = 1; index < repairedTerm.totalVariances.length; index += 1) {
  assert(repairedTerm.totalVariances[index] >= repairedTerm.totalVariances[index - 1],
    "Calendar repair did not make total variance nondecreasing");
}

// SVI raw/natural/jump-wings representations, derivatives, and synthetic fit.
const rawSvi = { a: 0.018, b: 0.22, rho: -0.42, m: 0.025, sigma: 0.16 };
const naturalSvi = vol.rawToNaturalSvi(rawSvi);
for (const k of [-0.6, -0.25, 0, 0.18, 0.55]) {
  assertClose(`raw/natural SVI k=${k}`, vol.naturalSviTotalVariance(k, naturalSvi),
    vol.rawSviTotalVariance(k, rawSvi), 2e-14);
  const h = 1e-5;
  const derivatives = vol.rawSviDerivatives(k, rawSvi);
  const numericalFirst = (vol.rawSviTotalVariance(k + h, rawSvi) -
    vol.rawSviTotalVariance(k - h, rawSvi)) / (2 * h);
  const numericalSecond = (vol.rawSviTotalVariance(k + h, rawSvi) -
    2 * vol.rawSviTotalVariance(k, rawSvi) + vol.rawSviTotalVariance(k - h, rawSvi)) / h ** 2;
  assertClose(`SVI first derivative k=${k}`, derivatives.first, numericalFirst, 2e-9);
  assertClose(`SVI second derivative k=${k}`, derivatives.second, numericalSecond, 2e-6);
}
const jumpWings = vol.rawToJumpWings(rawSvi, 1.5);
assert(jumpWings.p > 0 && jumpWings.c > 0 && jumpWings.v > 0 && jumpWings.vTilde > 0,
  "Jump-wings parameters must have positive wing/variance quantities");
const syntheticSvi = [-0.5, -0.32, -0.18, -0.05, 0.08, 0.22, 0.38, 0.55].map((k) => ({
  maturity: 1.5, logMoneyness: k, strike: 100 * Math.exp(k), weight: 1,
  totalVariance: vol.rawSviTotalVariance(k, rawSvi),
  impliedVolatility: Math.sqrt(vol.rawSviTotalVariance(k, rawSvi) / 1.5),
}));
const rawFit = vol.fitRawSvi(syntheticSvi, { maximumIterations: 1200 });
assert(rawFit.rmse < 5e-6, `Synthetic SVI RMSE too large: ${rawFit.rmse}`);
syntheticSvi.forEach((point) => assertClose("fitted SVI quote",
  rawFit.totalVariance(point.logMoneyness), point.totalVariance, 2e-5));

// SSVI identity and global synthetic calibration.
const ssviParameters = { rho: -0.5, eta: 0.75, gamma: 0.45 };
const thetaNodes = [{ maturity: 0.5, theta: 0.025 }, { maturity: 1, theta: 0.052 },
  { maturity: 2, theta: 0.112 }];
const syntheticSsvi = [];
thetaNodes.forEach((node) => [-0.35, -0.18, 0, 0.16, 0.34].forEach((k) => {
  const totalVariance = vol.ssviTotalVariance(k, node.theta, ssviParameters);
  const forward = market.spot * Math.exp((market.rate - market.dividendYield) * node.maturity);
  syntheticSsvi.push({ maturity: node.maturity, logMoneyness: k,
    strike: forward * Math.exp(k), forward, totalVariance,
    impliedVolatility: Math.sqrt(totalVariance / node.maturity), weight: 1 });
}));
for (const node of thetaNodes) assertClose("SSVI ATM identity",
  vol.ssviTotalVariance(0, node.theta, ssviParameters), node.theta, 1e-14);
const ssviFit = vol.fitSsvi(syntheticSsvi, { maximumIterations: 1000 });
assert(ssviFit.rmse < 2e-5, `Synthetic SSVI RMSE too large: ${ssviFit.rmse}`);

// CVI cubic B-spline identities in normalized log-moneyness.
const cviKnots = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
for (const z of [-5, -4, -2.5, 0, 1.75, 4, 5]) {
  assertClose(`CVI basis partition z=${z}`,
    vol.cviBasisVector(z, cviKnots).reduce((sum, value) => sum + value, 0), 1, 2e-12);
  assertClose(`CVI derivative partition z=${z}`,
    vol.cviBasisVector(z, cviKnots, 1).reduce((sum, value) => sum + value, 0), 0, 2e-12);
}

// SABR continuity, parameter fitting, and fixed-beta recovery.
const sabrParameters = { alpha: 0.23, beta: 0.65, rho: -0.38, nu: 0.72 };
const sabrAtm = vol.sabrLognormalVolatility(100, 100, 1.25, sabrParameters);
const sabrNearAtm = vol.sabrLognormalVolatility(100, 100 * Math.exp(1e-8), 1.25, sabrParameters);
assertClose("SABR ATM continuity", sabrNearAtm, sabrAtm, 1e-8);
const syntheticSabr = [65, 76, 87, 96, 100, 106, 118, 134, 155].map((strike) => {
  const impliedVolatility = vol.sabrLognormalVolatility(100, strike, 1.25, sabrParameters);
  return { maturity: 1.25, strike, logMoneyness: Math.log(strike / 100),
    impliedVolatility, totalVariance: impliedVolatility ** 2 * 1.25, weight: 1 };
});
const sabrFit = vol.fitSabr(syntheticSabr, 100, 0.65, { maximumIterations: 1000 });
assert(sabrFit.rmse < 3e-6, `Synthetic SABR RMSE too large: ${sabrFit.rmse}`);
assertClose("SABR alpha recovery", sabrFit.parameters.alpha, sabrParameters.alpha, 0.002);
assertClose("SABR rho recovery", sabrFit.parameters.rho, sabrParameters.rho, 0.015);
assertClose("SABR nu recovery", sabrFit.parameters.nu, sabrParameters.nu, 0.02);

// Vanna-Volga exact anchors and separate constrained convex call interpolation.
const anchorVols = [0.31, 0.235, 0.215];
const vvPoints = [80, 100, 125].map((strike, index) => ({
  maturity: 1, strike, forward: 100, logMoneyness: Math.log(strike / 100),
  impliedVolatility: anchorVols[index], totalVariance: anchorVols[index] ** 2, weight: 1,
}));
const vv = vol.buildVannaVolgaSmile(vvPoints, { ...market, forward: 100, maturity: 1 });
vvPoints.forEach((point) => assertClose(`VV anchor K=${point.strike}`,
  vv.volatility(point.strike), point.impliedVolatility, 2e-9));
const convex = vol.buildConvexCallSmile(vvPoints, { ...market, forward: 100, maturity: 1 });
for (let index = 1; index < convex.slopes.length; index += 1) {
  assert(convex.slopes[index] >= convex.slopes[index - 1] - 1e-14,
    "Constrained call slopes are not nondecreasing");
}
convex.slopes.forEach((slope) => assert(slope <= 1e-14 &&
  slope >= -Math.exp(-market.rate) - 1e-14, "Constrained call slope violates bounds"));
for (const strike of [70, 90, 110, 140]) {
  const price = convex.price(strike);
  const priceBounds = vol.blackScholesBounds({ ...market, strike, maturity: 1 }, "call");
  assert(price >= priceBounds.lower - 1e-12 && price <= priceBounds.upper + 1e-12,
    `Constrained call price violates bounds at ${strike}`);
}

// Dumas polynomial exact synthetic recovery.
const coefficients = [0.21, -0.055, 0.1, 0.012, -0.018, 0.003];
const dumasPoints = [];
[0.25, 0.5, 1, 2].forEach((maturity) => [-0.3, -0.12, 0.05, 0.22].forEach((k) => {
  const impliedVolatility = vol.dumasFeatures(k, maturity).reduce((sum, value, index) =>
    sum + value * coefficients[index], 0);
  dumasPoints.push({ maturity, logMoneyness: k, impliedVolatility,
    totalVariance: impliedVolatility ** 2 * maturity, weight: 1 });
}));
const dumasFit = vol.fitDumas(dumasPoints);
assert(dumasFit.rmse < 1e-9, `Dumas recovery RMSE too large: ${dumasFit.rmse}`);

// Full public surface contract under every fitting method.
const sampleCsv = `maturity,strike,iv,weight
0.25,80,0.310,0.7
0.25,90,0.270,1
0.25,100,0.235,1.4
0.25,110,0.220,1
0.25,120,0.215,0.7
0.50,80,0.290,0.7
0.50,90,0.255,1
0.50,100,0.225,1.4
0.50,110,0.212,1
0.50,120,0.210,0.7
1.00,80,0.270,0.7
1.00,90,0.245,1
1.00,100,0.220,1.4
1.00,110,0.210,1
1.00,120,0.208,0.7
2.00,80,0.250,0.7
2.00,90,0.235,1
2.00,100,0.215,1.4
2.00,110,0.208,1
2.00,120,0.207,0.7`;
const surfaceResults = {};
const surfaceObjects = {};
for (const method of Object.keys(vol.FIT_METHODS)) {
  const surface = vol.calibrateSurface(sampleCsv, {
    ...market, method, termMethod: "pchip-total-variance", sabrBeta: 0.5,
    diagnosticOptions: { strikeSamples: 41, maturitySamples: 8 },
  });
  assert(Number.isFinite(surface.rmse) && surface.rmse < 0.08,
    `${method}: unreasonable quote RMSE ${surface.rmse}`);
  assert(Number.isFinite(surface.volatility(0.75, 105)) && surface.volatility(0.75, 105) > 0,
    `${method}: invalid interpolated volatility`);
  assert(surface.fitRows.length === 20 && surface.maturities.length === 4,
    `${method}: incorrect fit matrix shape`);
  surfaceResults[method] = {
    rmse: surface.rmse,
    maximumError: surface.maximumError,
    targetVolatility: surface.volatility(0.75, 105),
    diagnostics: surface.diagnostics,
  };
  surfaceObjects[method] = surface;
}
assert(surfaceObjects.cvi.globalFit.solver.converged,
  `CVI QP did not meet feasibility tolerance: ${surfaceObjects.cvi.globalFit.solver.maximumViolation}`);
assert(surfaceObjects.cvi.diagnostics.passed,
  `CVI surface failed static-arbitrage diagnostics: ${JSON.stringify(surfaceObjects.cvi.diagnostics)}`);
assert(surfaceObjects.cvi.globalFit.parameters.butterflyConstraintCount > 0,
  "CVI did not install linearized butterfly constraints");
assert(surfaceObjects.cvi.globalFit.parameters.termMethod === "linear-total-variance",
  "CVI must evaluate the same affine total-variance interpolation used by its joint-expiry constraints");

// Static-arbitrage diagnostics and Dupire local-vol reductions.
const flatSurface = {
  market: { spot: 100, rate: 0.03, dividendYield: 0.01 },
  maturities: [0.25, 2],
  totalVariance: (maturity) => 0.24 ** 2 * maturity,
};
const flatDiagnostics = vol.arbitrageDiagnostics(flatSurface, {
  strikeSamples: 21, maturitySamples: 6,
});
assert(flatDiagnostics.passed, `Flat surface failed diagnostics: ${JSON.stringify(flatDiagnostics)}`);
for (const maturity of [0.1, 0.5, 1.5]) {
  for (const k of [-0.2, 0, 0.2]) {
    const forward = 100 * Math.exp(0.02 * maturity);
    assertClose(`flat Dupire T=${maturity}/k=${k}`,
      vol.dupireLocalVolatility(flatSurface, maturity, forward * Math.exp(k)).volatility,
      0.24, 2e-8);
  }
}
const termSurface = {
  market: flatSurface.market, maturities: [0.25, 2],
  totalVariance: (maturity) => 0.04 * maturity + 0.01 * maturity ** 2,
};
assertClose("term Dupire forward volatility",
  vol.dupireLocalVolatility(termSurface, 1, 100 * Math.exp(0.02)).volatility,
  Math.sqrt(0.06), 3e-8);
const badCalendar = {
  market: flatSurface.market, maturities: [0.25, 2],
  totalVariance: (maturity) => 0.1 - 0.02 * maturity,
};
assert(vol.arbitrageDiagnostics(badCalendar, { strikeSamples: 11, maturitySamples: 5 })
  .calendarViolations > 0, "Calendar-arbitrage diagnostic did not flag decreasing variance");
const badButterfly = {
  market: flatSurface.market, maturities: [0.25, 2],
  totalVariance: (maturity, k) => 0.2 * maturity - 2 * k ** 2,
};
assert(vol.arbitrageDiagnostics(badButterfly, { strikeSamples: 21, maturitySamples: 5 })
  .butterflyViolations > 0, "Butterfly diagnostic did not flag negative density");

// Dense Dupire round trip: 12 expiries x 25 log-moneyness points = 300 option prices.
const roundTripMaturities = Array.from({ length: 12 }, (_, index) =>
  1 / 12 + (2 - 1 / 12) * index / 11);
const roundTripMoneyness = Array.from({ length: 25 }, (_, index) => -0.3 + 0.6 * index / 24);
const roundTripParameters = { rho: -0.35, eta: 0.65, gamma: 0.45 };
const roundTripSurface = {
  market: { spot: 100, rate: 0.03, dividendYield: 0.01 },
  maturities: roundTripMaturities,
  totalVariance: (maturity, k) => vol.ssviTotalVariance(
    k, 0.04 * maturity, roundTripParameters,
  ),
};
const roundTrip = vol.localVolatilityRoundTrip(roundTripSurface, {
  maturities: roundTripMaturities, logMoneyness: roundTripMoneyness,
  strikePoints: 1101, timeSteps: 1100,
});
assert(roundTrip.rows.length === 300, `Expected 300 round-trip prices, received ${roundTrip.rows.length}`);
roundTrip.rows.forEach((row) => assert(Math.abs(row.priceError) < 0.015,
  `Local-vol round trip exceeded 1.5 cents at T=${row.maturity}, k=${row.logMoneyness}: ${row.priceError}`));
assert(roundTrip.priceRmse < 0.004,
  `Local-vol round-trip price RMSE too large: ${roundTrip.priceRmse}`);
assert(roundTrip.maximumPriceError < 0.015,
  `Local-vol round-trip maximum price error too large: ${roundTrip.maximumPriceError}`);
assert(roundTrip.impliedVolatilityRmse < 0.0012,
  `Local-vol round-trip IV RMSE too large: ${roundTrip.impliedVolatilityRmse}`);

// SLV seeded calibration, deterministic variance reduction, and leverage identity.
const slvOptions = {
  spot: 100, maturity: 0.75, rate: 0.03, dividendYield: 0.01,
  timeSteps: 6, particles: 512, seed: 99173,
  kappa: 2, theta: 0.04, initialVariance: 0.04, volOfVol: 0, rho: -0.6,
  damping: 1,
};
const deterministicSlv = vol.calibrateSlvLeverage(() => 0.2, slvOptions);
deterministicSlv.leverage.forEach((row) => row.forEach((value) =>
  assertClose("SLV unit leverage", value, 1, 2e-12)));
const stochasticOptions = { ...slvOptions, volOfVol: 0.35, particles: 768, damping: 1 };
const localTarget = (time, spot) => 0.2 * clampForTest((spot / 100) ** -0.15, 0.75, 1.35) *
  (1 + 0.04 * time);
function clampForTest(value, lower, upper) { return Math.min(Math.max(value, lower), upper); }
const stochasticSlv = vol.calibrateSlvLeverage(localTarget, stochasticOptions);
const repeatedSlv = vol.calibrateSlvLeverage(localTarget, stochasticOptions);
assert(JSON.stringify(stochasticSlv.leverage) === JSON.stringify(repeatedSlv.leverage),
  "Seeded SLV calibration is not reproducible");
assert(stochasticSlv.maximumReproductionError < 0.05,
  `SLV reproduction error too large: ${stochasticSlv.maximumReproductionError}`);
assert(stochasticSlv.leverage.flat().every((value) => Number.isFinite(value) && value >= 0.1 && value <= 5),
  "SLV leverage escaped configured bounds");

// Browser-visible unit rows and UI integration.
const browserRows = vol.runVolatilityUnitTests();
assert(browserRows.length === 15, `Expected 15 browser volatility tests, received ${browserRows.length}`);
assert(browserRows.every((row) => row.passed),
  `Browser volatility failures: ${browserRows.filter((row) => !row.passed).map((row) => row.name)}`);
const webFile = (name) => fs.readFileSync(path.join(__dirname, "web", name), "utf8");
const html = webFile("volatility.html");
for (const required of ["volatility-models.js?v=3", "volatility-lab.js?v=3", "fitMethod",
  "termMethod", "cviKnots", "cviRegularization", "quotes", "smile-chart",
  "local-vol-table-body", "calibrate-slv"]) {
  assert(html.includes(required), `Volatility page is missing ${required}`);
}
for (const method of Object.keys(vol.FIT_METHODS)) {
  assert(html.includes(`value="${method}"`), `Volatility page is missing fitter ${method}`);
}
const controller = webFile("volatility-lab.js");
for (const required of ["calibrateSurface", "dupireLocalVolatility", "buildLocalVolatilityGrid",
  "calibrateSlvLeverage"]) {
  assert(controller.includes(required), `Volatility controller is missing ${required}`);
}
for (const page of ["index.html", "exotics.html", "portfolio.html", "path-lab.html",
  "payoff-tests.html", "polyglot-conformance.html"]) {
  assert(webFile(page).includes('href="volatility.html"'), `${page} is missing volatility lab navigation`);
}
const payoffReportHtml = webFile("payoff-tests.html");
const payoffReportController = webFile("payoff-tests.js");
assert(payoffReportHtml.includes("volatility-models.js?v=3"),
  "Browser report does not load the volatility calibration engine");
for (const required of ["VOLATILITY_TEST_DEFINITION", "runVolatilityUnitTests"]) {
  assert(payoffReportController.includes(required),
    `Browser report is missing volatility integration ${required}`);
}

console.log(JSON.stringify({
  assertions,
  impliedVolatilityCases: inversionCases.length,
  fittingMethods: Object.keys(vol.FIT_METHODS),
  surfaceResults,
  roundTrip: {
    prices: roundTrip.rows.length,
    expiries: roundTrip.maturities.length,
    moneynessPoints: roundTrip.logMoneyness.length,
    priceRmse: roundTrip.priceRmse,
    maximumPriceError: roundTrip.maximumPriceError,
    impliedVolatilityRmse: roundTrip.impliedVolatilityRmse,
    maximumImpliedVolatilityError: roundTrip.maximumImpliedVolatilityError,
  },
  slv: {
    deterministicMaximumError: deterministicSlv.maximumReproductionError,
    stochasticMaximumError: stochasticSlv.maximumReproductionError,
    particles: stochasticSlv.particles,
  },
  browserUnitTests: browserRows.length,
  status: "all implied-volatility, surface-fitting, local-volatility, and SLV tests passed",
}, null, 2));
