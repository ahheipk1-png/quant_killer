"use strict";

const form = document.querySelector("#exotic-form");
const languageSelect = document.querySelector("#language");
const productSelect = document.querySelector("#product");
const volatilitySelect = document.querySelector("#volatilityModel");
const methodSelect = document.querySelector("#method");
const productFields = document.querySelector("#product-fields");
const volatilityFields = document.querySelector("#volatility-fields");
const basketFields = document.querySelector("#basket-fields");
const underlyingSelect = document.querySelector("#underlyingMode");
const productNote = document.querySelector("#product-note");
const languageNote = document.querySelector("#language-note");
const volatilityNote = document.querySelector("#volatility-note");
const methodNote = document.querySelector("#method-note");
const optionTypeField = document.querySelector("#option-type-field");
const engineStatus = document.querySelector("#engine-status");
const priceButton = document.querySelector("#price-button");
const benchmarkButton = document.querySelector("#benchmark-button");
const volRegressionButton = document.querySelector("#vol-regression-button");
const formError = document.querySelector("#form-error");
const resultPanel = document.querySelector("#result-panel");
const benchmarkPanel = document.querySelector("#benchmark-panel");
const benchmarkBody = document.querySelector("#benchmark-body");

const {
  productLabels, fallbackDescriptions, languageDefinitions,
  volatilityLabels, volatilityNotes, methodLabels, methodNotes, referenceMethods,
  fieldsByProduct, volatilityFieldDefinitions, basketFieldDefinitions,
  createField, buildObservationTimes, formatNumber,
} = ExoticFields;

let requestId = 0;
let metadata = { methods: referenceMethods, descriptions: fallbackDescriptions };
let currentBusy = false;
const engines = new Map();

function renderVolatilityFields() {
  if (productSelect.value === "american" && volatilitySelect.value !== "constant") {
    volatilitySelect.value = "constant";
  }
  volatilityFields.replaceChildren(...volatilityFieldDefinitions[volatilitySelect.value].map((def) => createField(def)));
  volatilityNote.textContent = volatilityNotes[volatilitySelect.value];
  updateMethodOptions();
}

function renderBasketFields() {
  const method = methodSelect.value;
  const pdeSelected = method === "pde" || method === "adi" || method.startsWith("pde-");
  if (pdeSelected && underlyingSelect.value !== "single") underlyingSelect.value = "single";
  const visible = underlyingSelect.value !== "single" || ["rainbow", "himalayan"].includes(productSelect.value);
  basketFields.hidden = !visible;
  basketFields.replaceChildren(...(visible ? basketFieldDefinitions.map((def) => createField(def)) : []));
  const order = basketFields.querySelector("[data-field-name='basketOrder']");
  if (order) order.hidden = underlyingSelect.value !== "order-performance";
}

function renderProductFields() {
  const product = productSelect.value;
  productFields.replaceChildren(...fieldsByProduct[product].map((def) => createField(def, updateScheduleFields)));
  productNote.textContent = metadata.descriptions[product] || fallbackDescriptions[product];
  optionTypeField.hidden = ["autocallable", "phoenix-autocall", "yield-seeker", "himalayan", "compound",
    "variance-swap", "volatility-swap", "accumulator"].includes(product);
  updateScheduleFields();
  renderBasketFields();
  updateMethodOptions();
}

function updateScheduleFields() {
  const mode = form.elements.scheduleMode?.value || "equal";
  for (const element of productFields.querySelectorAll("[data-field-name]")) {
    const name = element.dataset.fieldName;
    if (name === "monitoringSteps" || name === "exerciseDates") element.hidden = mode !== "equal";
    if (name === "valuationDate" || name === "endDate") element.hidden = mode === "equal";
    if (name === "holidayCalendar") element.hidden = mode !== "business-monthly";
    if (name === "observationDates") element.hidden = mode !== "custom";
  }
}

function availableMethods() {
  if (languageSelect.value !== "js") return ["mc"];
  const methods = metadata.methods[productSelect.value] || referenceMethods[productSelect.value] || ["mc"];
  if (volatilitySelect.value === "constant") return methods;
  if (productSelect.value === "variance-swap" && volatilitySelect.value === "term") {
    return methods.filter((method) => ["static-replication", "mc", "qmc"].includes(method));
  }
  return methods.filter((method) => ["mc", "qmc"].includes(method));
}

function updateMethodOptions() {
  const previous = methodSelect.value;
  const methods = availableMethods();
  methodSelect.replaceChildren(...methods.map((method) => new Option(methodLabels[method] || method, method)));
  if (methods.includes(previous)) methodSelect.value = previous;
  updateMethodFields();
}

function updateMethodFields() {
  const method = methodSelect.value;
  const isPde = method === "pde" || method === "adi" || method.startsWith("pde-");
  if (isPde && underlyingSelect.value !== "single") {
    underlyingSelect.value = "single";
    renderBasketFields();
  }
  methodNote.textContent = methodNotes[method] || "";
  document.querySelectorAll("[data-numeric-field='simulation']").forEach((element) => {
    element.hidden = !["mc", "qmc"].includes(method);
  });
  document.querySelectorAll("[data-numeric-field='pde']").forEach((element) => {
    element.hidden = !isPde;
  });
  document.querySelectorAll("[data-numeric-field='american-pde']").forEach((element) => {
    element.hidden = !method.startsWith("pde-");
  });
  document.querySelectorAll("[data-numeric-field='asian-pde']").forEach((element) => {
    element.hidden = method !== "adi";
  });
  document.querySelectorAll("[data-numeric-field='qmc']").forEach((element) => {
    element.hidden = method !== "qmc";
  });
}

function readConfig() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.rate = Number(data.rate) / 100;
  data.dividendYield = Number(data.dividendYield) / 100;
  data.volatility = Number(data.volatility) / 100;
  form.querySelectorAll("[data-transform='percent']").forEach((input) => { data[input.name] = Number(input.value) / 100; });
  data.randomizedQmc = form.elements.randomizedQmc.checked;
  data.includeInitialFixing = Boolean(form.elements.includeInitialFixing?.checked);
  data.memoryCoupon = form.elements.memoryCoupon ? form.elements.memoryCoupon.checked : true;
  data.ladderRungs = String(data.ladderRungs || "").split(",").map(Number).filter(Number.isFinite);
  data.basketWeights = String(data.basketWeights || "0.5,0.3,0.2").split(",").map(Number).filter(Number.isFinite);
  data.pdeSpotGrid = Number(data.pdeGrid);
  data.observationTimes = buildObservationTimes(data);
  return data;
}

function setBusy(busy, label = "Working…") {
  currentBusy = busy;
  const ready = engines.get(languageSelect.value)?.state === "ready";
  priceButton.disabled = busy || !ready;
  benchmarkButton.disabled = busy;
  volRegressionButton.disabled = busy;
  priceButton.textContent = busy ? label : `Price with ${languageDefinitions[languageSelect.value].label}`;
}

function setStatus(text, state) {
  engineStatus.textContent = text;
  engineStatus.dataset.state = state;
}

function ensureEngine(language, retry = false) {
  const definition = languageDefinitions[language];
  let entry = engines.get(language);
  if (entry && !retry) return entry;
  if (entry?.worker) entry.worker.terminate();
  const worker = new Worker(definition.url, { type: definition.type });
  entry = { worker, state: "loading", timer: 0 };
  engines.set(language, entry);
  entry.timer = window.setTimeout(() => {
    if (entry.state !== "loading") return;
    entry.state = "error";
    if (languageSelect.value === language) {
      setStatus(`${definition.detail} did not finish loading`, "error");
      formError.textContent = `The ${definition.label} runtime exceeded ${definition.timeout / 1000} seconds. Re-select it to retry, or use C++/Rust/JavaScript immediately.`;
      setBusy(false);
    }
  }, definition.timeout);
  worker.addEventListener("message", (event) => handleWorkerMessage(language, event.data));
  worker.addEventListener("error", () => handleEngineError(language, `The ${definition.detail} worker could not start.`));
  return entry;
}

function handleEngineError(language, message) {
  const entry = engines.get(language);
  if (entry) {
    window.clearTimeout(entry.timer);
    entry.state = "error";
  }
  if (languageSelect.value === language) {
    setStatus(`${languageDefinitions[language].detail} failed to load`, "error");
    formError.textContent = `${message} Open this page through http://127.0.0.1:8000/exotics.html, not as a file.`;
    setBusy(false);
  }
}

function handleWorkerMessage(language, message) {
  const entry = engines.get(language);
  if (message.type === "ready") {
    window.clearTimeout(entry.timer);
    entry.state = "ready";
    if (language === "js" && message.methods) {
      metadata = { methods: message.methods, descriptions: message.descriptions || fallbackDescriptions };
      renderProductFields();
    }
    if (languageSelect.value === language) {
      formError.textContent = "";
      setStatus(`${languageDefinitions[language].detail} ready locally`, "ready");
      updateMethodOptions();
      setBusy(false);
    }
    return;
  }
  if (message.type === "error" && message.requestId === undefined) {
    handleEngineError(language, message.message);
    return;
  }
  if (message.requestId !== requestId) return;
  setBusy(false);
  if (message.type === "error") {
    formError.textContent = message.message;
    return;
  }
  formError.textContent = "";
  if (message.type === "result") renderResult({ ...message.result, language });
  if (message.type === "benchmarks") renderBenchmarks(message.rows, false);
  if (message.type === "volatility-regressions") renderBenchmarks(message.rows, true);
}

function activateLanguage() {
  if (productSelect.value === "american" && languageSelect.value !== "js") {
    languageSelect.value = "js";
  }
  const language = languageSelect.value;
  const definition = languageDefinitions[language];
  languageNote.textContent = definition.note;
  formError.textContent = "";
  let entry = engines.get(language);
  if (entry?.state === "error") entry = ensureEngine(language, true);
  else entry = ensureEngine(language);
  updateMethodOptions();
  if (entry.state === "ready") setStatus(`${definition.detail} ready locally`, "ready");
  else setStatus(`Loading ${definition.detail}…`, "working");
  setBusy(false);
}

function renderResult(result) {
  const config = result.config;
  document.querySelector("#price-output").textContent = formatNumber(result.price);
  document.querySelector("#uncertainty-output").textContent = result.standardError === null
    ? "Deterministic estimate"
    : `SE ${formatNumber(result.standardError)} · payoff σ ${formatNumber(result.standardDeviation)}`;
  document.querySelector("#product-output").textContent = productLabels[config.product];
  document.querySelector("#method-output").textContent = `${languageDefinitions[result.language].label} · ${methodLabels[result.method] || result.method}`;
  document.querySelector("#volatility-output").textContent = volatilityLabels[config.volatilityModel];
  document.querySelector("#underlying-output").textContent = config.underlyingMode === "single" ? "Single asset" : config.underlyingMode.replaceAll("-", " ");
  document.querySelector("#runtime-output").textContent = `${result.elapsedMs.toFixed(1)} ms`;
  document.querySelector("#payoff-output").textContent = metadata.descriptions[config.product] || fallbackDescriptions[config.product];
  let workload = "Formula evaluation";
  if (["mc", "qmc"].includes(result.method)) workload = `${new Intl.NumberFormat("en-US").format(result.samples)} paths`;
  else if (result.method === "pde" || result.method === "adi" || result.method.startsWith("pde-")) {
    workload = `${config.pdeSpotGrid || config.pdeGrid} × ${config.pdeAverageGrid || config.pdeTimeSteps} grid · ${config.pdeGridType}`;
    if (result.pdeDiagnostics?.maximumIterations) {
      workload += ` · max ${result.pdeDiagnostics.maximumIterations} iterations`;
    }
  }
  else if (result.method === "tree") workload = `${config.treeSteps} tree steps`;
  else if (result.method === "semi-closed") workload = "96 spectral modes";
  else if (result.method === "static-replication") workload = "Numerical OTM option strip";
  document.querySelector("#workload-output").textContent = workload;
  const benchmarkRow = document.querySelector("#benchmark-check-row");
  benchmarkRow.hidden = !result.benchmark;
  if (result.benchmark) {
    const bench = result.benchmark;
    document.querySelector("#benchmark-check-output").textContent =
      `${formatNumber(bench.price)} · diff ${formatNumber(bench.difference)}`
      + (bench.standardError != null ? ` · SE ${formatNumber(bench.standardError)}` : "")
      + ` · ${bench.kind}`;
  }
  resultPanel.hidden = false;
}

function renderBenchmarks(rows, volatilityRegression) {
  document.querySelector("#benchmark-title").textContent = volatilityRegression ? "Volatility-model limit regressions" : "Reduction & benchmark suite";
  document.querySelector("#benchmark-description").textContent = volatilityRegression
    ? "Each payoff is replayed with identical random numbers so nested-model limits must agree path by path."
    : "Independent methods or simplified payoffs are compared with vanilla, barrier-parity, or note reductions.";
  benchmarkBody.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    const status = document.createElement("span");
    status.className = `pass-badge${row.passed ? "" : " fail"}`;
    status.textContent = row.passed ? "PASS" : "FAIL";
    const cells = [row.name, status, formatNumber(row.reference), formatNumber(row.candidate), Number(row.absoluteError).toExponential(2),
      row.reduction || row.name.split(": ").at(-1)];
    for (const value of cells) {
      const td = document.createElement("td");
      if (value instanceof Node) td.append(value); else td.textContent = value;
      tr.append(td);
    }
    return tr;
  }));
  benchmarkPanel.hidden = false;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const language = languageSelect.value;
    const entry = engines.get(language);
    if (entry?.state !== "ready") {
      activateLanguage();
      return;
    }
    const config = readConfig();
    requestId += 1;
    setBusy(true, `Pricing with ${languageDefinitions[language].label}…`);
    if (language === "js") entry.worker.postMessage({ type: "price", requestId, method: methodSelect.value, config });
    else entry.worker.postMessage({
      type: "price", requestId, method: "mc", config,
      parameters: PolyglotContract.pack(config), paths: Math.trunc(Number(config.paths)), seed: Math.trunc(Number(config.seed)),
    });
  } catch (error) {
    formError.textContent = error.message || String(error);
    setBusy(false);
  }
});

function runReferenceSuite(type) {
  const entry = ensureEngine("js");
  if (entry.state !== "ready") {
    formError.textContent = "The JavaScript reference engine is still loading; try again in a moment.";
    return;
  }
  requestId += 1;
  setBusy(true, "Testing…");
  entry.worker.postMessage({ type, requestId, paths: 1024 });
}

benchmarkButton.addEventListener("click", () => runReferenceSuite("benchmark"));
volRegressionButton.addEventListener("click", () => runReferenceSuite("volatility-regression"));
languageSelect.addEventListener("change", activateLanguage);
productSelect.addEventListener("change", () => {
  const requiresReferencePde = productSelect.value === "american" && languageSelect.value !== "js";
  if (productSelect.value === "american" && volatilitySelect.value !== "constant") {
    volatilitySelect.value = "constant";
    renderVolatilityFields();
  }
  renderProductFields();
  if (requiresReferencePde) activateLanguage();
});
volatilitySelect.addEventListener("change", renderVolatilityFields);
underlyingSelect.addEventListener("change", renderBasketFields);
methodSelect.addEventListener("change", updateMethodFields);

renderVolatilityFields();
renderProductFields();
activateLanguage();
