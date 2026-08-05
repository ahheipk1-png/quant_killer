const form = document.querySelector("#pricing-form");
const engineSelect = document.querySelector("#engine");
const methodSelect = document.querySelector("#method");
const exerciseSelect = document.querySelector("#exercise-style");
const priceButton = document.querySelector("#price-button");
const statusElement = document.querySelector("#engine-status");
const errorElement = document.querySelector("#form-error");
const resultPanel = document.querySelector("#result-panel");
const distributionPanel = document.querySelector("#distribution-panel");
const historyList = document.querySelector("#history-list");
const historyEmpty = document.querySelector("#history-empty");
const historyClearButton = document.querySelector("#history-clear");

const priceOutput = document.querySelector("#price-output");
const errorOutput = document.querySelector("#error-output");
const intervalOutput = document.querySelector("#interval-output");
const intervalRow = document.querySelector("#interval-row");
const stdOutput = document.querySelector("#std-output");
const stdRow = document.querySelector("#std-row");
const samplingOutput = document.querySelector("#sampling-output");
const samplingRow = document.querySelector("#sampling-row");
const varianceOutput = document.querySelector("#variance-output");
const varianceRow = document.querySelector("#variance-row");
const runtimeOutput = document.querySelector("#runtime-output");
const workloadOutput = document.querySelector("#workload-output");
const engineOutput = document.querySelector("#engine-output");
const methodOutput = document.querySelector("#method-output");
const exerciseOutput = document.querySelector("#exercise-output");
const payoffOutput = document.querySelector("#payoff-output");
const payoffChartTitle = document.querySelector("#payoff-chart-title");
const terminalChart = document.querySelector("#terminal-chart");
const payoffChart = document.querySelector("#payoff-chart");
const payoffFunctionChart = document.querySelector("#payoff-function-chart");

let requestId = 0;
let engineReady = false;
let worker;
let engineLoadTimer;
let engineLoadStartedAt = 0;
let pendingInputs;
let latestDistribution;
let resizeFrame;
let historyIdCounter = 0;
const historyEntries = [];

const engines = {
  cpp: {
    label: "C++",
    detail: "C++ / WebAssembly",
    workerUrl: "pricer-worker.js?v=10",
    workerType: "classic",
    loadTimeoutMs: 5000,
  },
  python: {
    label: "Python",
    detail: "Python / Pyodide",
    workerUrl: "python-worker.mjs?v=11",
    workerType: "module",
    loadTimeoutMs: 30000,
  },
  rust: {
    label: "Rust",
    detail: "Rust / WebAssembly",
    workerUrl: "rust-worker.js?v=10",
    workerType: "classic",
    loadTimeoutMs: 5000,
  },
  csharp: {
    label: "C#",
    detail: "C# / .NET WebAssembly",
    workerUrl: "csharp-worker.mjs?v=11",
    workerType: "module",
    loadTimeoutMs: 30000,
  },
};

const methods = {
  "closed-form": { label: "Black-Scholes closed form" },
  binomial: { label: "CRR binomial tree" },
  "monte-carlo": { label: "Monte Carlo simulation" },
  "barone-adesi-whaley": { label: "Barone-Adesi-Whaley" },
  "ju-zhong": { label: "Ju-Zhong quadratic (1999)" },
  "carr-randomization": { label: "Carr maturity randomization (1998)" },
  "bjerksund-stensland": { label: "Bjerksund-Stensland (1993)" },
  "bjerksund-stensland-2002": { label: "Bjerksund-Stensland (2002)" },
};

const methodOptions = {
  european: [
    ["monte-carlo", "Monte Carlo simulation"],
    ["closed-form", "Black-Scholes closed form"],
    ["binomial", "CRR binomial tree"],
  ],
  american: [
    ["barone-adesi-whaley", "Barone-Adesi-Whaley approximation"],
    ["ju-zhong", "Ju-Zhong quadratic approximation (1999)"],
    ["carr-randomization", "Peter Carr maturity randomization (1998)"],
    ["bjerksund-stensland", "Bjerksund-Stensland (1993) approximation"],
    ["bjerksund-stensland-2002", "Bjerksund-Stensland (2002) approximation"],
    ["binomial", "CRR binomial tree · early exercise"],
  ],
};

const samplingLabels = {
  pcg: "Pseudo-random PCG32",
  sobol: "Sobol QMC",
  rqmc: "Randomized Sobol · 8 shifts",
};

const varianceLabels = {
  none: "None",
  antithetic: "Antithetic variates",
  control: "Discounted-stock control variate",
  "antithetic-control": "Antithetic + control variate",
};

function setEngineStatus(label, state) {
  statusElement.textContent = label;
  statusElement.dataset.state = state;
}

function readNumber(name) {
  return Number(form.elements[name].value);
}

function formatNumber(value, digits = 6) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function setBusy(isBusy) {
  const engine = engines[engineSelect.value];
  priceButton.disabled = isBusy || !engineReady;
  priceButton.textContent = isBusy
    ? `Calculating with ${engine.label}...`
    : `Calculate with ${engine.label}`;
}

// Maps the "Pricing method" dropdown to the matching model group on the
// Source code page, so the "Verify this model" link always points at the
// code for whatever's actually selected, not a fixed default.
const SOURCE_MODEL_BY_METHOD = {
  "closed-form": "black_scholes",
  binomial: "binomial",
  "monte-carlo": "monte_carlo",
};

function updateMethodFields() {
  const method = methodSelect.value;
  document.querySelectorAll("[data-method-only]").forEach((element) => {
    const visible = element.dataset.methodOnly === method;
    element.hidden = !visible;
    element.querySelectorAll("input, select").forEach((control) => {
      control.disabled = !visible;
    });
  });
  resultPanel.hidden = true;
  distributionPanel.hidden = true;
  latestDistribution = undefined;
  errorElement.textContent = "";

  const sourceLink = document.querySelector("#verify-source-link");
  if (sourceLink) {
    const model = SOURCE_MODEL_BY_METHOD[method] ?? "black_scholes";
    sourceLink.href = `code.html?model=${model}`;
  }
}

function updateMethodOptions() {
  const previousMethod = methodSelect.value;
  const options = methodOptions[exerciseSelect.value];
  methodSelect.replaceChildren(...options.map(([value, label]) =>
    new Option(label, value)));
  if (options.some(([value]) => value === previousMethod)) {
    methodSelect.value = previousMethod;
  }
  updateMethodFields();
}

function clearEngineLoadTimer() {
  if (engineLoadTimer) {
    window.clearTimeout(engineLoadTimer);
    engineLoadTimer = undefined;
  }
}

function showEngineLoadFailure(message) {
  clearEngineLoadTimer();
  engineReady = false;
  if (worker) {
    worker.terminate();
    worker = undefined;
  }
  errorElement.textContent = message;
  setEngineStatus("Engine load failed", "error");
  priceButton.disabled = false;
  priceButton.textContent = `Retry ${engines[engineSelect.value].label} engine`;
}

function prepareCanvas(canvas) {
  const width = Math.max(240, canvas.clientWidth);
  const height = 220;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawHistogram(canvas, rawValues, color) {
  const values = Array.from(rawValues || []).filter(Number.isFinite);
  const { context, width, height } = prepareCanvas(canvas);
  const padding = { left: 38, right: 10, top: 14, bottom: 28 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  context.font = "11px ui-sans-serif, system-ui";
  context.fillStyle = "#9db0c5";
  context.strokeStyle = "#29425e";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding.left, padding.top);
  context.lineTo(padding.left, padding.top + chartHeight);
  context.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  context.stroke();

  if (!values.length) {
    context.fillText("No samples", padding.left + 10, padding.top + 24);
    return;
  }

  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) {
    minimum -= 0.5;
    maximum += 0.5;
  }
  const binCount = 32;
  const counts = new Array(binCount).fill(0);
  const scale = binCount / (maximum - minimum);
  values.forEach((value) => {
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor((value - minimum) * scale)));
    counts[bin] += 1;
  });
  const maxCount = Math.max(...counts, 1);
  const barWidth = chartWidth / binCount;

  context.fillStyle = color;
  counts.forEach((count, index) => {
    const barHeight = chartHeight * count / maxCount;
    context.fillRect(
      padding.left + index * barWidth + 1,
      padding.top + chartHeight - barHeight,
      Math.max(1, barWidth - 2),
      barHeight,
    );
  });

  context.fillStyle = "#9db0c5";
  context.textAlign = "left";
  context.fillText(formatNumber(minimum, 2), padding.left, height - 8);
  context.textAlign = "right";
  context.fillText(formatNumber(maximum, 2), width - padding.right, height - 8);
  context.fillText(String(maxCount), padding.left - 5, padding.top + 9);
}

function drawPayoffFunction(inputs, terminalPrices) {
  const { context, width, height } = prepareCanvas(payoffFunctionChart);
  const padding = { left: 38, right: 10, top: 14, bottom: 28 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const terminalMaximum = terminalPrices?.length ? Math.max(...terminalPrices) : 0;
  const xMaximum = Math.max(inputs.strike * 2, inputs.spot * 2, terminalMaximum, 1);
  const payoffAt = (terminal) => inputs.optionType === "call"
    ? Math.max(terminal - inputs.strike, 0)
    : Math.max(inputs.strike - terminal, 0);
  const yMaximum = Math.max(payoffAt(0), payoffAt(xMaximum), 1);

  context.strokeStyle = "#29425e";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding.left, padding.top);
  context.lineTo(padding.left, padding.top + chartHeight);
  context.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  context.stroke();

  context.strokeStyle = "#5ee1c2";
  context.lineWidth = 2.5;
  context.beginPath();
  for (let index = 0; index <= 120; index += 1) {
    const terminal = xMaximum * index / 120;
    const x = padding.left + chartWidth * terminal / xMaximum;
    const y = padding.top + chartHeight * (1 - payoffAt(terminal) / yMaximum);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();

  const strikeX = padding.left + chartWidth * inputs.strike / xMaximum;
  context.setLineDash([4, 4]);
  context.strokeStyle = "#ffd166";
  context.beginPath();
  context.moveTo(strikeX, padding.top);
  context.lineTo(strikeX, padding.top + chartHeight);
  context.stroke();
  context.setLineDash([]);

  context.font = "11px ui-sans-serif, system-ui";
  context.fillStyle = "#9db0c5";
  context.textAlign = "left";
  context.fillText("0", padding.left, height - 8);
  context.textAlign = "right";
  context.fillText(formatNumber(xMaximum, 2), width - padding.right, height - 8);
  context.fillStyle = "#ffd166";
  context.textAlign = "center";
  context.fillText("K", strikeX, padding.top + 11);
}

function renderDistribution() {
  if (!latestDistribution || distributionPanel.hidden) return;
  drawHistogram(terminalChart, latestDistribution.terminalPrices, "#5ee1c2");
  drawHistogram(payoffChart, latestDistribution.payoffs, "#ffd166");
  drawPayoffFunction(latestDistribution.inputs, latestDistribution.terminalPrices);
}

// --- Pricing history: compare runs side by side -------------------------
//
// Every successful price becomes a compact card. Hover shows the full
// input set via a tooltip, "Duplicate" copies those inputs back into the
// form so a variation can be priced and compared, and double-click opens
// a full-detail view in a new window (built as a Blob + object URL, so it
// needs no server -- consistent with the rest of this project).

function inputSummaryRows(entry) {
  const { inputs, engineKey, result } = entry;
  const rows = [
    ["Engine", engines[engineKey].label],
    ["Method", methods[inputs.method].label],
    ["Exercise", inputs.exerciseStyle === "american" ? "American" : "European"],
    ["Type", inputs.optionType === "call" ? "Call" : "Put"],
    ["Spot", formatNumber(inputs.spot, 2)],
    ["Strike", formatNumber(inputs.strike, 2)],
    ["Maturity", `${formatNumber(inputs.maturity, 4)} yr`],
    ["Rate", `${formatNumber(inputs.rate * 100, 2)}%`],
    ["Dividend yield", `${formatNumber(inputs.dividendYield * 100, 2)}%`],
    ["Volatility", `${formatNumber(inputs.volatility * 100, 2)}%`],
  ];
  if (inputs.method === "monte-carlo") {
    rows.push(
      ["Paths", new Intl.NumberFormat("en-US").format(inputs.paths)],
      ["Seed", String(inputs.seed)],
      ["Sampling", samplingLabels[inputs.sampling]],
      ["Variance control", varianceLabels[inputs.varianceReduction]],
    );
  } else if (inputs.method === "binomial") {
    rows.push(["Steps", new Intl.NumberFormat("en-US").format(inputs.steps)]);
  } else if (inputs.method === "carr-randomization") {
    rows.push(["Erlang phases", new Intl.NumberFormat("en-US").format(inputs.carrPhases)]);
  }
  rows.push(["Price", formatNumber(result.price)]);
  if (inputs.method === "monte-carlo") {
    rows.push(
      ["Std. error", formatNumber(result.standardError)],
      ["Std. deviation", formatNumber(result.standardDeviation)],
    );
  }
  rows.push(["Runtime", `${result.elapsedMs.toFixed(1)} ms`]);
  return rows;
}

function buildTooltip(entry) {
  const tooltip = document.createElement("div");
  tooltip.className = "chip-tooltip";
  const dl = document.createElement("dl");
  for (const [label, value] of inputSummaryRows(entry)) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }
  const hint = document.createElement("p");
  hint.className = "tooltip-hint";
  hint.textContent = "Double-click for full detail";
  tooltip.append(dl, hint);
  return tooltip;
}

function updateHistoryEmptyState() {
  historyEmpty.hidden = historyEntries.length > 0;
  historyClearButton.hidden = historyEntries.length === 0;
}

function removeHistoryEntry(id) {
  const index = historyEntries.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  historyEntries.splice(index, 1);
  const chip = historyList.querySelector(`[data-history-id="${id}"]`);
  chip?.remove();
  updateHistoryEmptyState();
}

function duplicateHistoryEntry(entry) {
  const { inputs, engineKey } = entry;
  if (engineSelect.value !== engineKey) {
    engineSelect.value = engineKey;
    selectEngine();
  }
  exerciseSelect.value = inputs.exerciseStyle;
  updateMethodOptions();
  methodSelect.value = inputs.method;
  updateMethodFields();
  form.elements.optionType.value = inputs.optionType;
  form.elements.spot.value = inputs.spot;
  form.elements.strike.value = inputs.strike;
  form.elements.maturity.value = inputs.maturity;
  form.elements.rate.value = inputs.rate * 100;
  form.elements.dividendYield.value = inputs.dividendYield * 100;
  form.elements.volatility.value = inputs.volatility * 100;
  if (inputs.method === "monte-carlo") {
    form.elements.paths.value = inputs.paths;
    form.elements.seed.value = inputs.seed;
    form.elements.sampling.value = inputs.sampling;
    form.elements.varianceReduction.value = inputs.varianceReduction;
    form.elements.showDistribution.checked = inputs.includeDistribution;
  } else if (inputs.method === "binomial") {
    form.elements.steps.value = inputs.steps;
  } else if (inputs.method === "carr-randomization") {
    form.elements.carrPhases.value = inputs.carrPhases;
  }
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openHistoryDetail(entry) {
  const rows = inputSummaryRows(entry)
    .map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
    .join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>QuantKiller - Pricing run detail</title>
<style>
  body { margin: 0; padding: 40px; background: #07111f; color: #f4f8fc;
         font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  p.meta { color: #9db0c5; margin: 0 0 28px; font-size: 0.86rem; }
  table { border-collapse: collapse; width: 100%; max-width: 520px; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #29425e; font-size: 0.92rem; }
  th { color: #9db0c5; font-weight: 600; width: 45%; }
  td { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <h1>Pricing run detail</h1>
  <p class="meta">Priced ${new Date(entry.timestamp).toLocaleString()}</p>
  <table>${rows}</table>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    win.addEventListener("unload", () => URL.revokeObjectURL(url), { once: true });
  }
}

function renderHistoryChip(entry) {
  const chip = document.createElement("div");
  chip.className = "history-chip";
  chip.dataset.historyId = String(entry.id);
  chip.setAttribute("role", "listitem");
  chip.tabIndex = 0;

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.className = "chip-duplicate";
  duplicateButton.title = "Duplicate into form";
  duplicateButton.setAttribute("aria-label", "Duplicate this run into the form");
  duplicateButton.textContent = "⧉";
  duplicateButton.addEventListener("click", (event) => {
    event.stopPropagation();
    duplicateHistoryEntry(entry);
  });

  const priceLabel = document.createElement("span");
  priceLabel.className = "chip-price";
  priceLabel.textContent = formatNumber(entry.result.price, 4);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "chip-close";
  closeButton.title = "Remove";
  closeButton.setAttribute("aria-label", "Remove this run from history");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeHistoryEntry(entry.id);
  });

  chip.addEventListener("dblclick", () => openHistoryDetail(entry));
  chip.append(duplicateButton, priceLabel, closeButton, buildTooltip(entry));
  return chip;
}

function addHistoryEntry(inputs, engineKey, result) {
  const entry = {
    id: (historyIdCounter += 1),
    inputs,
    engineKey,
    result: {
      price: result.price,
      standardError: result.standardError,
      standardDeviation: result.standardDeviation,
      elapsedMs: result.elapsedMs,
    },
    timestamp: Date.now(),
  };
  historyEntries.push(entry);
  historyList.appendChild(renderHistoryChip(entry));
  updateHistoryEmptyState();
}

historyClearButton.addEventListener("click", () => {
  historyEntries.length = 0;
  historyList.replaceChildren();
  updateHistoryEmptyState();
});

function handleWorkerMessage(event) {
  const message = event.data;

  if (message.type === "ready") {
    clearEngineLoadTimer();
    engineReady = true;
    setBusy(false);
    const loadMs = performance.now() - engineLoadStartedAt;
    setEngineStatus(
      `${engines[engineSelect.value].detail} ready - ${loadMs.toFixed(0)} ms`,
      "ready",
    );
    return;
  }

  if (message.type === "error") {
    if (message.requestId !== undefined) {
      setBusy(false);
      errorElement.textContent = message.message;
      setEngineStatus(`${engines[engineSelect.value].detail} ready`, "ready");
    } else {
      showEngineLoadFailure(message.message);
    }
    return;
  }

  if (message.type !== "result" || message.requestId !== requestId) return;

  setBusy(false);
  const engine = engines[engineSelect.value];
  const inputs = pendingInputs;
  const isMonteCarlo = inputs.method === "monte-carlo";
  setEngineStatus(`${engine.detail} ready`, "ready");

  priceOutput.textContent = formatNumber(message.price);
  const payoffFormula = inputs.optionType === "call"
    ? "max(Sₜ − K, 0)"
    : "max(K − Sₜ, 0)";
  payoffOutput.textContent = inputs.exerciseStyle === "american"
    ? `${payoffFormula} · early exercise allowed`
    : payoffFormula;

  if (isMonteCarlo) {
    const hasStatisticalInterval = inputs.sampling !== "sobol";
    const lower = message.price - 1.96 * message.standardError;
    const upper = message.price + 1.96 * message.standardError;
    const pathsPerSecond = inputs.paths / (message.elapsedMs / 1000);
    errorOutput.textContent = inputs.sampling === "sobol"
      ? `sample SE ${formatNumber(message.standardError)} · descriptive only`
      : `SE ${formatNumber(message.standardError)}`;
    intervalOutput.textContent = `${formatNumber(lower)} - ${formatNumber(upper)}`;
    intervalRow.hidden = !hasStatisticalInterval;
    stdOutput.textContent = formatNumber(message.standardDeviation);
    stdRow.hidden = false;
    samplingOutput.textContent = samplingLabels[inputs.sampling];
    samplingRow.hidden = false;
    varianceOutput.textContent = varianceLabels[inputs.varianceReduction];
    varianceRow.hidden = false;
    workloadOutput.textContent = `${new Intl.NumberFormat("en-US").format(inputs.paths)} paths - ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(pathsPerSecond)}/s`;
  } else {
    if (inputs.method === "closed-form") {
      errorOutput.textContent = "Analytic benchmark";
    } else if (inputs.method === "binomial") {
      errorOutput.textContent = `${new Intl.NumberFormat("en-US").format(inputs.steps)}-step approximation`;
    } else if (inputs.method === "carr-randomization") {
      errorOutput.textContent = "Erlang maturity randomization with two-level Richardson extrapolation";
    } else {
      errorOutput.textContent = "Semi-closed American approximation";
    }
    intervalRow.hidden = true;
    stdRow.hidden = true;
    samplingRow.hidden = true;
    varianceRow.hidden = true;
    workloadOutput.textContent = inputs.method === "closed-form"
      ? "Analytic formula"
      : inputs.method === "binomial"
        ? `${new Intl.NumberFormat("en-US").format(inputs.steps)} time steps`
        : inputs.method === "carr-randomization"
          ? `${new Intl.NumberFormat("en-US").format(inputs.carrPhases)} + ${new Intl.NumberFormat("en-US").format(2 * inputs.carrPhases)} Erlang phases`
          : "Semi-closed approximation";
  }

  runtimeOutput.textContent = `${message.elapsedMs.toFixed(1)} ms`;
  engineOutput.textContent = engine.detail;
  methodOutput.textContent = methods[inputs.method].label;
  exerciseOutput.textContent = inputs.exerciseStyle === "american" ? "American" : "European";
  resultPanel.hidden = false;
  addHistoryEntry(inputs, engineSelect.value, message);

  if (isMonteCarlo && inputs.includeDistribution && message.distribution) {
    latestDistribution = { ...message.distribution, inputs };
    payoffChartTitle.textContent = inputs.optionType === "call"
      ? "European call payoff function"
      : "European put payoff function";
    distributionPanel.hidden = false;
    window.requestAnimationFrame(renderDistribution);
  } else {
    latestDistribution = undefined;
    distributionPanel.hidden = true;
  }
}

function handleWorkerError() {
  showEngineLoadFailure("The pricing worker could not start. Click retry to load it again.");
}

function selectEngine() {
  const engine = engines[engineSelect.value];
  clearEngineLoadTimer();
  errorElement.textContent = "";
  resultPanel.hidden = true;
  distributionPanel.hidden = true;
  latestDistribution = undefined;
  engineReady = false;
  requestId += 1;

  if (worker) {
    worker.terminate();
    worker = undefined;
  }

  priceButton.disabled = true;
  priceButton.textContent = `Loading ${engine.label} engine...`;
  setEngineStatus(`Loading ${engine.detail}...`, "working");
  engineLoadStartedAt = performance.now();
  worker = new Worker(engine.workerUrl, { type: engine.workerType });
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", handleWorkerError);
  engineLoadTimer = window.setTimeout(() => {
    if (!engineReady) {
      showEngineLoadFailure(
        `The engine took longer than ${engine.loadTimeoutMs / 1000} seconds to load. Click retry instead of waiting indefinitely.`,
      );
    }
  }, engine.loadTimeoutMs);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  errorElement.textContent = "";

  if (!engineReady) {
    selectEngine();
    return;
  }
  if (!form.reportValidity()) return;

  const method = methodSelect.value;
  const inputs = {
    spot: readNumber("spot"),
    strike: readNumber("strike"),
    rate: readNumber("rate") / 100,
    dividendYield: readNumber("dividendYield") / 100,
    volatility: readNumber("volatility") / 100,
    maturity: readNumber("maturity"),
    method,
    exerciseStyle: exerciseSelect.value,
    paths: method === "monte-carlo" ? readNumber("paths") : 0,
    seed: method === "monte-carlo" ? readNumber("seed") : 0,
    steps: method === "binomial" ? readNumber("steps") : 0,
    carrPhases: method === "carr-randomization" ? readNumber("carrPhases") : 0,
    sampling: method === "monte-carlo" ? form.elements.sampling.value : "pcg",
    varianceReduction: method === "monte-carlo"
      ? form.elements.varianceReduction.value
      : "none",
    includeDistribution: method === "monte-carlo" && form.elements.showDistribution.checked,
    optionType: form.elements.optionType.value,
  };

  if (method === "monte-carlo" && (!Number.isInteger(inputs.paths) || inputs.paths < 2 || inputs.paths > 2_000_000)) {
    errorElement.textContent = "Paths must be a whole number between 2 and 2,000,000.";
    return;
  }
  if (method === "monte-carlo" && inputs.sampling === "rqmc" && inputs.paths < 8) {
    errorElement.textContent = "Randomized Sobol requires at least 8 paths for its eight shifts.";
    return;
  }
  if (method === "binomial" && (!Number.isInteger(inputs.steps) || inputs.steps < 1 || inputs.steps > 2_000)) {
    errorElement.textContent = "Binomial steps must be a whole number between 1 and 2,000.";
    return;
  }
  if (method === "carr-randomization" &&
      (!Number.isInteger(inputs.carrPhases) || inputs.carrPhases < 4 || inputs.carrPhases > 256)) {
    errorElement.textContent = "Carr Erlang phases must be a whole number between 4 and 256.";
    return;
  }
  if (
    inputs.exerciseStyle === "american"
    && method !== "binomial"
    && (inputs.rate < 0 || inputs.dividendYield < 0)
  ) {
    errorElement.textContent = "The American approximations require non-negative rates and dividend yield.";
    return;
  }

  requestId += 1;
  pendingInputs = inputs;
  resultPanel.hidden = true;
  distributionPanel.hidden = true;
  latestDistribution = undefined;
  setBusy(true);
  setEngineStatus(
    `${engines[engineSelect.value].label} ${methods[method].label} running`,
    "working",
  );
  worker.postMessage({ type: "price", requestId, inputs });
});

window.addEventListener("resize", () => {
  if (!latestDistribution || distributionPanel.hidden) return;
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(renderDistribution);
});

if (window.location.protocol === "file:") {
  setEngineStatus("Opening the required local server...", "working");
  priceButton.disabled = true;
  priceButton.textContent = "Opening local server...";
  window.location.replace("http://127.0.0.1:8000/");
} else {
  engineSelect.addEventListener("change", selectEngine);
  methodSelect.addEventListener("change", updateMethodFields);
  exerciseSelect.addEventListener("change", updateMethodOptions);
  updateMethodOptions();
  selectEngine();
}
