(function () {
  "use strict";

  const CANONICAL_DECIMALS = 8;
  const LANGUAGES = [
    { id: "cpp", label: "C++", workerUrl: "advanced-cpp-worker.js?v=3", type: "classic", loadTimeout: 30000 },
    { id: "rust", label: "Rust", workerUrl: "advanced-rust-worker.js?v=3", type: "classic", loadTimeout: 30000 },
    { id: "python", label: "Python", workerUrl: "advanced-python-worker.mjs?v=4", type: "module", loadTimeout: 120000 },
    { id: "csharp", label: "C#", workerUrl: "advanced-csharp-worker.mjs?v=3", type: "module", loadTimeout: 120000 },
  ];

  const BASE_CONFIG = {
    spot: 100,
    strike: 100,
    rate: 0.03,
    dividendYield: 0.01,
    volatility: 0.20,
    termVolatility: 0.24,
    localBeta: -0.20,
    hestonKappa: 1.8,
    hestonLongRunVol: 0.22,
    hestonVolOfVol: 0.35,
    hestonRho: -0.55,
    maturity: 1,
    optionType: "call",
    monitoringSteps: 8,
    paths: 2048,
    seed: 99173,
    volatilityModel: "constant",
  };

  const CONFORMANCE_CASES = [
    {
      name: "Digital call · low strike · short maturity",
      config: { product: "digital", optionType: "call", strike: 80, cashPayoff: 10, maturity: 0.25 },
    },
    {
      name: "Digital put · high strike · long maturity",
      config: { product: "digital", optionType: "put", strike: 120, cashPayoff: 10, maturity: 2, volatilityModel: "term" },
    },
    {
      name: "Up-and-out call · local volatility",
      config: { product: "barrier", optionType: "call", strike: 90, barrier: 130, barrierDirection: "up", barrierStyle: "out", maturity: 0.5, volatilityModel: "local" },
    },
    {
      name: "Down-and-out put · constant volatility",
      config: { product: "barrier", optionType: "put", strike: 110, barrier: 70, barrierDirection: "down", barrierStyle: "out", maturity: 2 },
    },
    {
      name: "Double knock-out call · Heston",
      config: { product: "double-barrier", optionType: "call", strike: 95, lowerBarrier: 60, upperBarrier: 160, barrierStyle: "out", maturity: 0.75, volatilityModel: "heston" },
    },
    {
      name: "Double knock-out put · stochastic local volatility",
      config: { product: "double-barrier", optionType: "put", strike: 110, lowerBarrier: 55, upperBarrier: 170, barrierStyle: "out", maturity: 3, volatilityModel: "slv" },
    },
    {
      name: "Lookback call · one-year path",
      config: { product: "lookback", optionType: "call", strike: 100, maturity: 1, monitoringSteps: 12 },
    },
    {
      name: "Uneven discrete Asian put · term volatility",
      config: { product: "asian", optionType: "put", strike: 105, maturity: 1, volatilityModel: "term", includeInitialFixing: true, observationTimes: [0.08, 0.21, 0.43, 0.68, 1] },
    },
  ];

  const summaryTitle = document.querySelector("#summary-title");
  const summaryNote = document.querySelector("#summary-note");
  const passedCount = document.querySelector("#passed-count");
  const totalCount = document.querySelector("#total-count");
  const engineCount = document.querySelector("#engine-count");
  const statusList = document.querySelector("#engine-load-status");
  const tableBody = document.querySelector("#conformance-body");
  const reportError = document.querySelector("#report-error");

  let requestSequence = 0;

  function canonical(value) {
    return Number(value).toFixed(CANONICAL_DECIMALS);
  }

  function formatSpread(value) {
    return value === 0 ? "0" : value.toExponential(3);
  }

  function updateEngineStatus(language, state, detail) {
    const item = document.querySelector(`#engine-${language.id}`);
    item.dataset.state = state;
    item.querySelector("span").textContent = detail;
  }

  function createEngine(language) {
    const worker = new Worker(language.workerUrl, { type: language.type });
    const pending = new Map();
    let timeoutId;
    const ready = new Promise((resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(`${language.label} did not load within ${language.loadTimeout / 1000} seconds.`));
      }, language.loadTimeout);
      worker.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "ready") {
          window.clearTimeout(timeoutId);
          updateEngineStatus(language, "ready", "ready");
          resolve();
        } else if (message.type === "error" && message.requestId === undefined) {
          window.clearTimeout(timeoutId);
          reject(new Error(message.message));
        } else if (message.requestId !== undefined && pending.has(message.requestId)) {
          const entry = pending.get(message.requestId);
          pending.delete(message.requestId);
          window.clearTimeout(entry.timeoutId);
          if (message.type === "result") entry.resolve(message.result);
          else entry.reject(new Error(message.message || `${language.label} pricing failed.`));
        }
      });
      worker.addEventListener("error", (event) => reject(new Error(
        event.message || `${language.label} worker failed to start.`,
      )));
    });
    return {
      language,
      worker,
      ready,
      price(config) {
        requestSequence += 1;
        const requestId = requestSequence;
        return new Promise((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            pending.delete(requestId);
            reject(new Error(`${language.label} pricing request timed out.`));
          }, 60000);
          pending.set(requestId, { resolve, reject, timeoutId });
          worker.postMessage({
            type: "price",
            requestId,
            method: "mc",
            config,
            parameters: PolyglotContract.pack(config),
            paths: config.paths,
            seed: config.seed,
          });
        });
      },
    };
  }

  function normalizeCase(testCase) {
    const maturity = Number(testCase.config.maturity ?? BASE_CONFIG.maturity);
    return AdvancedPricer.normalizeConfig({
      ...BASE_CONFIG,
      ...testCase.config,
      decisionTime: Math.max(Math.min(maturity * 0.5, maturity - 1e-6), 1e-6),
    });
  }

  function renderRow(testCase, config, results) {
    const values = LANGUAGES.map((language) => results[language.id].price);
    const standardErrors = LANGUAGES.map((language) => results[language.id].standardError);
    const standardDeviations = LANGUAGES.map((language) => results[language.id].standardDeviation);
    const priceCanonical = values.map(canonical);
    const errorCanonical = standardErrors.map(canonical);
    const deviationCanonical = standardDeviations.map(canonical);
    const passed = new Set(priceCanonical).size === 1
      && new Set(errorCanonical).size === 1
      && new Set(deviationCanonical).size === 1;
    const maxSpread = Math.max(...values) - Math.min(...values);
    const row = document.createElement("tr");
    const cells = [
      testCase.name,
      `${config.product}; ${config.optionType}; K=${config.strike}; T=${config.maturity}`,
      ...priceCanonical,
      formatSpread(maxSpread),
    ];
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index >= 2) cell.className = "numeric-cell";
      row.appendChild(cell);
    });
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `pass-badge${passed ? "" : " fail"}`;
    badge.textContent = passed ? "PASS" : "FAIL";
    statusCell.appendChild(badge);
    row.appendChild(statusCell);
    tableBody.appendChild(row);
    return {
      name: testCase.name,
      config,
      results,
      canonical: {
        price: priceCanonical,
        standardError: errorCanonical,
        standardDeviation: deviationCanonical,
      },
      maxSpread,
      passed,
    };
  }

  async function run() {
    if (!window.PolyglotContract || !window.AdvancedPricer) {
      throw new Error("The shared pricing contract did not load.");
    }
    const engines = LANGUAGES.map((language) => createEngine(language));
    await Promise.all(engines.map(async (engine) => {
      updateEngineStatus(engine.language, "working", "loading...");
      try {
        await engine.ready;
      } catch (error) {
        updateEngineStatus(engine.language, "error", "failed");
        throw error;
      }
    }));

    const rows = [];
    for (const testCase of CONFORMANCE_CASES) {
      const config = normalizeCase(testCase);
      const languageResults = await Promise.all(engines.map((engine) => engine.price(config)));
      const results = Object.fromEntries(engines.map((engine, index) => [
        engine.language.id,
        languageResults[index],
      ]));
      rows.push(renderRow(testCase, config, results));
    }
    engines.forEach((engine) => engine.worker.terminate());
    return rows;
  }

  window.PolyglotConformance = {
    CANONICAL_DECIMALS,
    LANGUAGES,
    CONFORMANCE_CASES,
  };
  window.polyglotConformanceResult = { state: "running", rows: [] };
  engineCount.textContent = String(LANGUAGES.length);
  totalCount.textContent = String(CONFORMANCE_CASES.length);

  run().then((rows) => {
    const passed = rows.filter((row) => row.passed).length;
    passedCount.textContent = String(passed);
    summaryTitle.textContent = passed === rows.length
      ? "All four languages agree exactly."
      : `${rows.length - passed} cross-language case${rows.length - passed === 1 ? "" : "s"} failed.`;
    summaryNote.textContent = passed === rows.length
      ? `C++, Rust, Python, and C# produced identical price, standard-error, and standard-deviation strings at ${CANONICAL_DECIMALS} decimal places.`
      : "Inspect the failed row to identify the engine whose canonical result diverged.";
    const state = passed === rows.length ? "passed" : "failed";
    document.documentElement.dataset.testState = state;
    window.polyglotConformanceResult = { state, rows };
  }).catch((error) => {
    summaryTitle.textContent = "The four-language test could not finish.";
    summaryNote.textContent = "Reload through the local server and retry.";
    reportError.textContent = error instanceof Error ? error.message : String(error);
    document.documentElement.dataset.testState = "failed";
    window.polyglotConformanceResult = { state: "failed", rows: [], error: reportError.textContent };
  });
}());
