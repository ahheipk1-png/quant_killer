(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const path = require("node:path");
    module.exports = factory(
      require("./exotic-pricer.js"),
      require("./advanced-pricer.js"),
      require("./pricer.js"),
      (file) => path.join(__dirname, file),
    );
  } else {
    root.PricingRegression = factory(
      root.ExoticPricer,
      root.AdvancedPricer,
      root.createQuantKillerModule,
      (file) => file,
    );
  }
}(typeof self !== "undefined" ? self : this, function (
  ExoticPricer,
  AdvancedPricer,
  createQuantKillerModule,
  locateFile,
) {
  "use strict";

  const DEFINITIONS = {
    "pricing-identities": {
      label: "Pricing identities",
      kind: "Cross-contract regression",
      formulaLabel: "Identity",
      formula: "C - P = S e^(-qT) - K e^(-rT); V_in + V_out = V_vanilla",
      description: "Exact replication identities are checked over multiple strikes, maturities, option types, and barrier placements.",
    },
    "pricing-duality": {
      label: "European call-put duality",
      kind: "Symmetry regression",
      formulaLabel: "Duality",
      formula: "C(S,K,r,q,sigma,T) = P(K,S,q,r,sigma,T)",
      description: "The asset and strike are exchanged while the rate and dividend yield are exchanged. The transformed put must reproduce the call.",
    },
    "method-benchmarks": {
      label: "Independent-method benchmarks",
      kind: "Numerical benchmark",
      formulaLabel: "Comparison",
      formula: "closed/semi-closed form ~= PDE, tree, or Brownian-bridge Sobol QMC",
      description: "Numerically independent implementations are compared across vanilla and exotic products instead of only checking one engine against itself.",
    },
    "pde-features": {
      label: "PDE feature matrix",
      kind: "Grid and solver regression",
      formulaLabel: "Coverage",
      formula: "uniform / sinh grids; raw / cell-average payoff; Rannacher damping; boundary reductions; Asian ADI",
      description: "The browser exercises every spatial-grid selector, payoff smoothing, damping, barrier boundary reductions, and both Asian ADI axes against independent formulas, trees, or Sobol QMC.",
    },
    "american-duality": {
      label: "American call-put duality",
      kind: "C++ WebAssembly regression",
      formulaLabel: "Duality",
      formula: "C_A(S,K,r,q,sigma,T) = P_A(K,S,q,r,sigma,T)",
      description: "Every American approximation and the CRR benchmark are challenged against the exact asset/strike and rate/yield symmetry. Approximation-specific tolerances are stated in each row.",
    },
  };

  const AMERICAN_CASES = [
    { spot: 100, strike: 90, rate: 0.05, dividendYield: 0.02, volatility: 0.20, maturity: 0.50 },
    { spot: 100, strike: 100, rate: 0.03, dividendYield: 0.08, volatility: 0.30, maturity: 2.00 },
    { spot: 75, strike: 110, rate: 0.01, dividendYield: 0.06, volatility: 0.45, maturity: 1.25 },
    { spot: 140, strike: 100, rate: 0.08, dividendYield: 0.01, volatility: 0.25, maturity: 0.25 },
  ];

  const METHOD_SPECS = [
    { id: "CRR 1,000 steps", exportName: "qk_binomial_american_price", tolerance: 1e-8, extra: 1000 },
    { id: "Barone-Adesi-Whaley", exportName: "qk_baw_american_price", tolerance: 0.06 },
    { id: "Ju-Zhong", exportName: "qk_ju_american_price", tolerance: 0.025 },
    { id: "Carr randomization (32 phases)", exportName: "qk_carr_randomization_price", tolerance: 0.003, extra: 32 },
    { id: "Bjerksund-Stensland 1993", exportName: "qk_bjerksund_american_price", tolerance: 1e-10 },
    { id: "Bjerksund-Stensland 2002", exportName: "qk_bjerksund_2002_american_price", tolerance: 1e-10 },
  ];

  function mapBenchmark(row) {
    return {
      product: row.category || "method-benchmarks",
      name: row.name,
      inputs: row.inputs || {},
      expected: row.reference,
      actual: row.candidate,
      tolerance: row.tolerance,
      error: row.passed ? "" : `Absolute error ${row.absoluteError} exceeds ${row.tolerance}.`,
      passed: row.passed,
      rationale: `${row.reduction} Absolute error: ${row.absoluteError.toExponential(3)}; tolerance: ${row.tolerance}.`,
    };
  }

  function cwrapMethod(moduleInstance, spec) {
    const argumentCount = spec.extra === undefined ? 7 : 8;
    return moduleInstance.cwrap(
      spec.exportName,
      "number",
      Array(argumentCount).fill("number"),
    );
  }

  function runPdeFeatureTests() {
    if (!AdvancedPricer) throw new Error("The advanced Asian ADI engine did not load.");
    const rows = [];
    const add = (name, reference, candidate, tolerance, inputs, reduction) => {
      rows.push(mapBenchmark({
        name, reference, candidate, tolerance, inputs, reduction,
        absoluteError: Math.abs(reference - candidate),
        passed: Number.isFinite(reference) && Number.isFinite(candidate) &&
          Math.abs(reference - candidate) <= tolerance,
        category: "pde-features",
      }));
    };
    const common = {
      spot: 100, strike: 100, rate: 0.05, dividendYield: 0.01,
      volatility: 0.2, maturity: 1, decisionTime: 0.5,
      optionType: "call", paths: 8192, seed: 99173, monitoringSteps: 4,
      pdeGrid: 120, pdeTimeSteps: 180, pdeGridConcentration: 0.12,
      pdePayoffSmoothing: "cell-average", pdeRannacherSteps: 2,
    };
    const digital = ExoticPricer.normalizeConfig({
      ...common, product: "digital", cashPayoff: 10,
    });
    const digitalReference = ExoticPricer.digitalClosedForm(digital);
    ["uniform", "sinh-strike", "sinh-spot"].forEach((gridType) => add(
      `Digital PDE · ${gridType} grid`,
      digitalReference,
      ExoticPricer.pdePrice({ ...digital, pdeGridType: gridType }),
      0.08,
      { gridType, smoothing: "cell-average", rannacherSteps: 2 },
      "The selected spatial grid is compared with the cash-digital closed form.",
    ));
    add(
      "Digital PDE · unsmoothed terminal payoff",
      digitalReference,
      ExoticPricer.pdePrice({ ...digital, pdeGridType: "uniform", pdePayoffSmoothing: "none" }),
      0.40,
      { gridType: "uniform", smoothing: "none", rannacherSteps: 2 },
      "The raw discontinuous payoff remains within its deliberately wider coarse-grid tolerance.",
    );
    add(
      "Digital PDE · no Rannacher damping",
      digitalReference,
      ExoticPricer.pdePrice({ ...digital, pdeGridType: "uniform", pdeRannacherSteps: 0 }),
      0.08,
      { gridType: "uniform", smoothing: "cell-average", rannacherSteps: 0 },
      "The undamped Crank-Nicolson branch is checked independently against the closed form.",
    );

    const barrier = ExoticPricer.normalizeConfig({
      ...common, product: "barrier", barrier: 140,
      barrierDirection: "up", barrierStyle: "out",
    });
    add(
      "Barrier PDE · strike-clustered grid",
      ExoticPricer.barrierClosedForm(barrier),
      ExoticPricer.pdePrice({ ...barrier, pdeGridType: "sinh-strike" }),
      0.08,
      { product: "barrier", gridType: "sinh-strike" },
      "The nonuniform barrier PDE is compared with the continuous-monitoring formula.",
    );
    const doubleBarrier = ExoticPricer.normalizeConfig({
      ...common, product: "double-barrier", lowerBarrier: 70,
      upperBarrier: 140, barrierStyle: "out",
    });
    add(
      "Double-barrier PDE · spot-clustered grid",
      ExoticPricer.doubleBarrierSpectral(doubleBarrier),
      ExoticPricer.pdePrice({ ...doubleBarrier, pdeGridType: "sinh-spot" }),
      0.08,
      { product: "double-barrier", gridType: "sinh-spot" },
      "The nonuniform finite-difference result is compared with the spectral series.",
    );
    const bermudan = ExoticPricer.normalizeConfig({
      ...common, product: "bermudan", optionType: "put", exerciseDates: 4, treeSteps: 1000,
    });
    add(
      "Bermudan PDE · damped strike grid",
      ExoticPricer.bermudanTree(bermudan).price,
      ExoticPricer.pdePrice({ ...bermudan, pdeGridType: "sinh-strike", pdeRannacherSteps: 4 }),
      0.08,
      { product: "bermudan", gridType: "sinh-strike", rannacherSteps: 4 },
      "Exercise-date projections on a damped nonuniform grid are compared with a 1,000-step tree.",
    );

    const breached = ExoticPricer.normalizeConfig({
      ...common, product: "barrier", spot: 80, barrier: 90,
      barrierDirection: "down", barrierStyle: "out", pdeGridType: "sinh-spot",
    });
    add(
      "Breached barrier · knock-out boundary",
      0,
      ExoticPricer.price(breached, "pde").price,
      0,
      { spot: 80, barrier: 90, style: "out" },
      "An already-breached knock-out is worthless without entering the interior solve.",
    );
    add(
      "Breached barrier · knock-in boundary",
      ExoticPricer.blackScholes(breached),
      ExoticPricer.price({ ...breached, barrierStyle: "in" }, "pde").price,
      1e-12,
      { spot: 80, barrier: 90, style: "in" },
      "An already-breached knock-in reduces exactly to the matching vanilla option.",
    );

    const asian = {
      ...common, product: "asian", volatilityModel: "constant", termVolatility: 0.2,
      observationTimes: [0.13, 0.41, 0.76, 1],
      pdeSpotGrid: 72, pdeAverageGrid: 72, pdeTimeSteps: 160,
    };
    const asianReference = AdvancedPricer.price({
      ...asian, pdePayoffSmoothing: "none",
    }, "qmc").price;
    ["uniform", "sinh-strike", "sinh-spot"].forEach((gridType) => add(
      `Asian ADI · ${gridType} two-axis grid`,
      asianReference,
      AdvancedPricer.price({ ...asian, pdeGridType: gridType }, "adi").price,
      0.45,
      { gridType, spotGrid: 72, accumulatedSumGrid: 72, unevenSchedule: true },
      "The two-dimensional ADI solve is compared with Sobol QMC on the same uneven fixing schedule.",
    ));
    return rows;
  }

  async function runAmericanDualityTests() {
    if (typeof createQuantKillerModule !== "function") {
      throw new Error("The C++ WebAssembly American pricing engine did not load.");
    }
    const moduleInstance = await createQuantKillerModule({ locateFile });
    const rows = [];
    METHOD_SPECS.forEach((spec) => {
      const price = cwrapMethod(moduleInstance, spec);
      AMERICAN_CASES.forEach((inputs) => {
        const common = [
          inputs.spot,
          inputs.strike,
          inputs.rate,
          inputs.dividendYield,
          inputs.volatility,
          inputs.maturity,
        ];
        const dual = [
          inputs.strike,
          inputs.spot,
          inputs.dividendYield,
          inputs.rate,
          inputs.volatility,
          inputs.maturity,
        ];
        const callArguments = spec.extra === undefined
          ? [...common, 1]
          : [...common, spec.extra, 1];
        const putArguments = spec.extra === undefined
          ? [...dual, 0]
          : [...dual, spec.extra, 0];
        const call = price(...callArguments);
        const dualPut = price(...putArguments);
        const absoluteError = Math.abs(call - dualPut);
        rows.push({
          product: "american-duality",
          name: `${spec.id} · S=${inputs.spot}, K=${inputs.strike}, T=${inputs.maturity}y`,
          inputs: { method: spec.id, ...inputs },
          expected: dualPut,
          actual: call,
          tolerance: spec.tolerance,
          passed: Number.isFinite(call) && Number.isFinite(dualPut) && absoluteError <= spec.tolerance,
          error: Number.isFinite(absoluteError) && absoluteError <= spec.tolerance
            ? ""
            : `Duality residual ${absoluteError} exceeds ${spec.tolerance}.`,
          rationale: `Call is compared with the transformed American put. Absolute residual: ${absoluteError.toExponential(3)}; method tolerance: ${spec.tolerance}.`,
        });
      });
    });
    return rows;
  }

  async function run() {
    if (!ExoticPricer) throw new Error("The exotic pricing engine did not load.");
    const benchmarkRows = ExoticPricer.runBenchmarks().map(mapBenchmark);
    const pdeRows = runPdeFeatureTests();
    const americanRows = await runAmericanDualityTests();
    return [...benchmarkRows, ...pdeRows, ...americanRows];
  }

  return {
    DEFINITIONS,
    AMERICAN_CASES,
    METHOD_SPECS,
    run,
    runPdeFeatureTests,
    runAmericanDualityTests,
  };
}));
