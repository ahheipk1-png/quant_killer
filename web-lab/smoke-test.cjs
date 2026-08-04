const path = require("node:path");
const createQuantKillerModule = require("./web/pricer.js");

const expected = {
  pcgAntithetic: [10.433278940162882, 0.02325794328095759, 7.354807445883545],
  sobolControl: [10.450299247497739, 0.017738921191322598, 5.609539419880691],
  rqmcCombined: [10.450149345129944, 0.0001773061044310609, 1.9475036448262204],
  closedFormPrice: 10.45058357218555,
  binomialPrice: 10.446585136447538,
  firstRandomizedSobolTerminal: 122.32850838833988,
  americanPut: [6.097615381626399, 5.982973972623789, 6.045010197829406, 6.089989952551852],
  dividendAmericanCall: [6.573533485909398, 6.462414740115705, 6.5136818051354695, 6.541642897137264],
  juAmerican: [6.069748272883007, 6.520420308974371],
  carrAmerican: [6.089836716138626, 6.542047742671842],
  publishedTablePut: 4.743898906679767,
};

function assertClose(name, actual, expectedValue, tolerance = 1e-10) {
  if (Math.abs(actual - expectedValue) > tolerance) {
    throw new Error(`${name}: expected ${expectedValue}, received ${actual}`);
  }
}

async function main() {
  const module = await createQuantKillerModule({
    locateFile: (file) => path.join(__dirname, "web", file),
  });
  const priceOption = module.cwrap("qk_mc_european_price", "number", [
    "number", "number", "number", "number", "number", "number",
    "number", "number", "number", "number", "number",
  ]);
  const getStandardError = module.cwrap("qk_mc_last_std_error", "number", []);
  const getStandardDeviation = module.cwrap("qk_mc_last_std_dev", "number", []);
  const generateDistribution = module.cwrap("qk_mc_generate_distribution", "number", [
    "number", "number", "number", "number", "number", "number",
    "number", "number", "number", "number",
  ]);
  const distributionTerminalAt = module.cwrap(
    "qk_mc_distribution_terminal", "number", ["number"],
  );
  const closedFormPrice = module.cwrap("qk_bs_european_price", "number", [
    "number", "number", "number", "number", "number", "number", "number",
  ]);
  const binomialPrice = module.cwrap("qk_binomial_european_price", "number", [
    "number", "number", "number", "number", "number", "number", "number", "number",
  ]);
  const bawPrice = module.cwrap("qk_baw_american_price", "number", [
    "number", "number", "number", "number", "number", "number", "number",
  ]);
  const bjerksundPrice = module.cwrap("qk_bjerksund_american_price", "number", [
    "number", "number", "number", "number", "number", "number", "number",
  ]);
  const juPrice = module.cwrap("qk_ju_american_price", "number", [
    "number", "number", "number", "number", "number", "number", "number",
  ]);
  const carrPrice = module.cwrap("qk_carr_randomization_price", "number", [
    "number", "number", "number", "number", "number", "number", "number", "number",
  ]);
  const bjerksund2002Price = module.cwrap("qk_bjerksund_2002_american_price", "number", [
    "number", "number", "number", "number", "number", "number", "number",
  ]);
  const americanTreePrice = module.cwrap("qk_binomial_american_price", "number", [
    "number", "number", "number", "number", "number", "number", "number", "number",
  ]);

  const common = [100, 100, 0.05, 0, 0.2, 1];
  const runMonteCarlo = (samplingMode, varianceMode) => {
    const price = priceOption(...common, 100_000, 42, 1, samplingMode, varianceMode);
    return [price, getStandardError(), getStandardDeviation()];
  };
  const actual = {
    pcgAntithetic: runMonteCarlo(0, 1),
    sobolControl: runMonteCarlo(1, 2),
    rqmcCombined: runMonteCarlo(2, 3),
    closedFormPrice: closedFormPrice(...common, 1),
    binomialPrice: binomialPrice(...common, 500, 1),
    americanPut: [
      bawPrice(...common, 0),
      bjerksundPrice(...common, 0),
      bjerksund2002Price(...common, 0),
      americanTreePrice(...common, 2000, 0),
    ],
    dividendAmericanCall: [
      bawPrice(100, 100, 0.05, 0.08, 0.2, 1, 1),
      bjerksundPrice(100, 100, 0.05, 0.08, 0.2, 1, 1),
      bjerksund2002Price(100, 100, 0.05, 0.08, 0.2, 1, 1),
      americanTreePrice(100, 100, 0.05, 0.08, 0.2, 1, 2000, 1),
    ],
    juAmerican: [
      juPrice(...common, 0),
      juPrice(100, 100, 0.05, 0.08, 0.2, 1, 1),
    ],
    carrAmerican: [
      carrPrice(...common, 32, 0),
      carrPrice(100, 100, 0.05, 0.08, 0.2, 1, 32, 1),
    ],
    publishedTablePut: bjerksund2002Price(100, 100, 0.08, 0.04, 0.2, 0.5, 0),
  };
  const carrTreeCases = [
    [90, 100, 0.05, 0, 0.25, 2, 0],
    [110, 100, 0.03, 0.01, 0.3, 0.5, 0],
    [100, 100, 0.04, 0.1, 0.25, 2, 1],
    [90, 100, 0.02, 0.06, 0.35, 0.75, 1],
  ];
  actual.carrTreeBenchmarks = carrTreeCases.map((inputs) => {
    const carr = carrPrice(...inputs.slice(0, 6), 32, inputs[6]);
    const tree = americanTreePrice(...inputs.slice(0, 6), 2000, inputs[6]);
    if (Math.abs(carr - tree) > 0.005) {
      throw new Error(`Carr/tree benchmark failed: Carr ${carr}, tree ${tree}`);
    }
    return { inputs, carr, tree, difference: carr - tree };
  });
  generateDistribution(...common, 5, 42, 1, 2);
  actual.firstRandomizedSobolTerminal = distributionTerminalAt(0);

  for (const key of ["pcgAntithetic", "sobolControl", "rqmcCombined"]) {
    expected[key].forEach((value, index) => assertClose(`${key}[${index}]`, actual[key][index], value));
  }
  for (const key of ["americanPut", "dividendAmericanCall", "juAmerican", "carrAmerican"]) {
    expected[key].forEach((value, index) => assertClose(`${key}[${index}]`, actual[key][index], value));
  }
  for (const key of ["closedFormPrice", "binomialPrice", "firstRandomizedSobolTerminal", "publishedTablePut"]) {
    assertClose(key, actual[key], expected[key]);
  }

  console.log(JSON.stringify({ ...actual, expectedSource: "QuantKiller Python reference" }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
