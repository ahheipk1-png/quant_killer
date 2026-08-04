const fs = require("node:fs");
const path = require("node:path");
const regression = require("./web/pricing-regression.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const rows = await regression.run();
  const failures = rows.filter((row) => !row.passed);
  assert(failures.length === 0,
    `Pricing regression failures: ${failures.map((row) => row.name).join(", ")}`);

  const counts = rows.reduce((result, row) => {
    result[row.product] = (result[row.product] || 0) + 1;
    return result;
  }, {});
  assert(counts["pricing-identities"] === 14,
    `Expected 14 parity/reduction identities, received ${counts["pricing-identities"]}`);
  assert(counts["pricing-duality"] === 4,
    `Expected four European duality cases, received ${counts["pricing-duality"]}`);
  assert(counts["method-benchmarks"] === 37,
    `Expected 37 independent-method benchmarks, received ${counts["method-benchmarks"]}`);
  assert(counts["pde-features"] === 13,
    `Expected 13 PDE feature regressions, received ${counts["pde-features"]}`);
  assert(counts["american-duality"] === 24,
    `Expected 24 American duality cases, received ${counts["american-duality"]}`);

  const americanMethods = new Set(rows
    .filter((row) => row.product === "american-duality")
    .map((row) => row.inputs.method));
  assert(americanMethods.size === regression.METHOD_SPECS.length,
    "Every American implementation must participate in the duality matrix");

  const pdeRows = rows.filter((row) => row.product === "pde-features");
  const pdeGridTypes = new Set(pdeRows.map((row) => row.inputs.gridType).filter(Boolean));
  assert(["uniform", "sinh-strike", "sinh-spot"].every((grid) => pdeGridTypes.has(grid)),
    "Browser PDE regressions must exercise every spatial grid");
  assert(pdeRows.some((row) => row.inputs.smoothing === "none"),
    "Browser PDE regressions must exercise the unsmoothed payoff path");
  assert(pdeRows.some((row) => row.inputs.rannacherSteps === 0),
    "Browser PDE regressions must exercise undamped Crank-Nicolson");
  assert(pdeRows.some((row) => row.inputs.unevenSchedule),
    "Browser PDE regressions must exercise uneven-schedule Asian ADI");

  const barrierRows = rows.filter((row) => row.name.includes("barrier"));
  const barrierMaturities = [...new Set(barrierRows
    .map((row) => row.inputs.maturity)
    .filter(Number.isFinite))];
  const barrierStrikes = [...new Set(barrierRows
    .map((row) => row.inputs.strike)
    .filter(Number.isFinite))];
  assert(barrierRows.some((row) => row.inputs.optionType === "call"),
    "Barrier matrix must include calls");
  assert(barrierRows.some((row) => row.inputs.optionType === "put"),
    "Barrier matrix must include puts");
  assert(barrierMaturities.length >= 3,
    "Barrier matrix must span multiple maturities");
  assert(barrierStrikes.length >= 4,
    "Barrier matrix must span multiple strikes");

  const html = fs.readFileSync(path.join(__dirname, "web", "payoff-tests.html"), "utf8");
  assert(html.includes("pricing-regression.js"),
    "The executable HTML report must load the pricing regression suite");

  console.log(JSON.stringify({
    total: rows.length,
    counts,
    americanMethods: [...americanMethods],
    barrierMaturities,
    status: "all pricing regressions passed",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
