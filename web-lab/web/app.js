// ===================== Shared engine/method metadata =====================

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

// Maps the "Pricing method" dropdown to the matching model group on the
// Source code page, so each instrument's "Verify this model" link always
// points at the code for whatever's actually selected.
const SOURCE_MODEL_BY_METHOD = {
  "closed-form": "black_scholes",
  binomial: "binomial",
  "monte-carlo": "monte_carlo",
};

// ===================== Shared generic helpers =====================

function formatNumber(value, digits = 6) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function readNumber(form, name) {
  return Number(form.elements[name].value);
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

function drawPayoffFunction(canvas, inputs, terminalPrices) {
  const { context, width, height } = prepareCanvas(canvas);
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

// ===================== Shared: pricing history =====================
//
// One history strip, fed by every instrument. Every successful price
// becomes a compact card: hover shows the full input set via a tooltip,
// "Duplicate" spins up a brand-new, fully pre-filled instrument (so you
// can tweak one field and compare), and double-click opens a full-detail
// view in a new window (Blob + object URL, no server involved).

const historyList = document.querySelector("#history-list");
const historyEmpty = document.querySelector("#history-empty");
const historyClearButton = document.querySelector("#history-clear");
let historyIdCounter = 0;
const historyEntries = [];

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
  duplicateButton.title = "Duplicate into a new instrument";
  duplicateButton.setAttribute("aria-label", "Duplicate this run into a new instrument");
  duplicateButton.textContent = "⧉";
  duplicateButton.addEventListener("click", (event) => {
    event.stopPropagation();
    createInstrumentPanel(entry);
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

// ===================== Instrument panels =====================
//
// The homepage starts empty. "+ Instrument" clones the <template> below:
// one row per instrument, with 3 collapsed module buttons (Contractual
// info, Underlying asset(s), Model). Every field already has a sane
// default, so Calculate works immediately -- clicking a module button
// just opens a <dialog> to review or change that module's values; Save
// commits and updates the button's summary line, Cancel (or Escape, or
// clicking the backdrop) discards the edit and restores what was there
// before the dialog opened.
//
// Any number of instruments can be open at once; each gets its own Worker
// (no sharing) so two panels never race on the same in-flight request.
// Dragging a module button from one instrument onto the matching button
// in another copies just that module's field values across.

const instrumentsList = document.querySelector("#instruments-list");
const addInstrumentButton = document.querySelector("#add-instrument-button");
const instrumentTemplate = document.querySelector("#instrument-template");
const panels = new Map();
let panelIdCounter = 0;

function engineLabelFor(root) {
  const engineKey = root.querySelector('[name="engine"]').value;
  return engines[engineKey].label;
}

function summarizeModule(root, module) {
  const dialog = root.querySelector(`.module-dialog[data-module="${module}"]`);
  const q = (name) => dialog.querySelector(`[name="${name}"]`);
  if (module === "contractual") {
    const type = dialog.querySelector('input[name="optionType"]:checked').value === "call" ? "Call" : "Put";
    const exercise = q("exerciseStyle").value === "american" ? "American" : "European";
    return `${type} · ${exercise} · Strike ${formatNumber(Number(q("strike").value), 2)} · `
      + `${formatNumber(Number(q("maturity").value), 4)} yr`;
  }
  if (module === "asset") {
    return `Spot ${formatNumber(Number(q("spot").value), 2)} · `
      + `Vol ${formatNumber(Number(q("volatility").value), 2)}% · `
      + `Div ${formatNumber(Number(q("dividendYield").value), 2)}% · `
      + `Rate ${formatNumber(Number(q("rate").value), 2)}%`;
  }
  if (module === "model") {
    return `${engineLabelFor(root)} · ${methods[q("method").value].label}`;
  }
  return "";
}

function captureFieldValues(fields) {
  return fields.map((field) => (
    field.type === "checkbox" || field.type === "radio" ? field.checked : field.value
  ));
}

function restoreFieldValues(fields, snapshot) {
  fields.forEach((field, index) => {
    if (field.type === "checkbox" || field.type === "radio") field.checked = snapshot[index];
    else field.value = snapshot[index];
  });
}

function validateFields(fields) {
  for (const field of fields) {
    if (field.disabled) continue;
    if (!field.checkValidity()) {
      field.reportValidity();
      return false;
    }
  }
  return true;
}

function createInstrumentPanel(prefillEntry) {
  const panelId = String((panelIdCounter += 1));
  const fragment = instrumentTemplate.content.cloneNode(true);
  const root = fragment.querySelector("[data-panel]");
  root.dataset.panel = panelId;
  instrumentsList.insertBefore(fragment, addInstrumentButton);

  const form = root.querySelector(".pricing-form");
  const priceButton = root.querySelector(".price-button");
  const statusElement = root.querySelector(".engine-status");
  const errorElement = root.querySelector(".form-error");
  const distributionPanel = root.querySelector(".distribution-panel");
  const resultTrigger = root.querySelector('.module-trigger[data-module="result"]');
  const resultDialog = root.querySelector('.module-dialog[data-module="result"]');
  const sourceLink = root.querySelector(".verify-source-link");
  const engineSelect = root.querySelector('[name="engine"]');
  const methodSelect = root.querySelector('[name="method"]');
  const exerciseSelect = root.querySelector('[name="exerciseStyle"]');
  const removeButton = root.querySelector(".instrument-remove");

  const priceOutput = root.querySelector(".price-output");
  const errorOutput = root.querySelector(".error-output");
  const intervalOutput = root.querySelector(".interval-output");
  const intervalRow = root.querySelector(".interval-row");
  const stdOutput = root.querySelector(".std-output");
  const stdRow = root.querySelector(".std-row");
  const samplingOutput = root.querySelector(".sampling-output");
  const samplingRow = root.querySelector(".sampling-row");
  const varianceOutput = root.querySelector(".variance-output");
  const varianceRow = root.querySelector(".variance-row");
  const runtimeOutput = root.querySelector(".runtime-output");
  const workloadOutput = root.querySelector(".workload-output");
  const engineOutput = root.querySelector(".engine-output");
  const methodOutput = root.querySelector(".method-output");
  const exerciseOutput = root.querySelector(".exercise-output");
  const payoffOutput = root.querySelector(".payoff-output");
  const payoffChartTitle = root.querySelector(".payoff-chart-title");
  const terminalChart = root.querySelector(".terminal-chart");
  const payoffChart = root.querySelector(".payoff-chart");
  const payoffFunctionChart = root.querySelector(".payoff-function-chart");

  let requestId = 0;
  let engineReady = false;
  let worker;
  let engineLoadTimer;
  let engineLoadStartedAt = 0;
  let pendingInputs;
  let latestDistribution;
  let resizeFrame;

  function setEngineStatus(label, state) {
    statusElement.textContent = label;
    statusElement.dataset.state = state;
  }

  function refreshSummary(module) {
    root.querySelector(`.module-trigger[data-module="${module}"] .module-trigger-summary`).textContent =
      summarizeModule(root, module);
  }

  function setResultSummary(text) {
    resultTrigger.querySelector(".module-trigger-summary").textContent = text;
  }

  function setBusy(isBusy) {
    priceButton.disabled = isBusy || !engineReady;
    priceButton.textContent = isBusy ? "Calculating…" : "Calculate";
  }

  function updateMethodFields() {
    const method = methodSelect.value;
    form.querySelectorAll("[data-method-only]").forEach((element) => {
      const visible = element.dataset.methodOnly === method;
      element.hidden = !visible;
      element.querySelectorAll("input, select").forEach((control) => {
        control.disabled = !visible;
      });
    });
    setResultSummary("—");
    distributionPanel.hidden = true;
    latestDistribution = undefined;
    errorElement.textContent = "";

    if (sourceLink) {
      const model = SOURCE_MODEL_BY_METHOD[method] ?? "black_scholes";
      sourceLink.href = `code.html?model=${model}`;
    }

    refreshSummary("model");
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
    priceButton.textContent = "Retry";
  }

  function renderDistribution() {
    if (!latestDistribution || distributionPanel.hidden) return;
    drawHistogram(terminalChart, latestDistribution.terminalPrices, "#5ee1c2");
    drawHistogram(payoffChart, latestDistribution.payoffs, "#ffd166");
    drawPayoffFunction(payoffFunctionChart, latestDistribution.inputs, latestDistribution.terminalPrices);
  }

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
    setResultSummary(formatNumber(message.price, 4));
    addHistoryEntry(inputs, engineSelect.value, message);

    if (isMonteCarlo && inputs.includeDistribution && message.distribution) {
      latestDistribution = { ...message.distribution, inputs };
      payoffChartTitle.textContent = inputs.optionType === "call"
        ? "European call payoff function"
        : "European put payoff function";
      distributionPanel.hidden = false;
      // Canvases inside the (still-closed) result dialog have zero layout
      // size right now -- the real draw happens once the dialog opens.
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
    setResultSummary("—");
    distributionPanel.hidden = true;
    latestDistribution = undefined;
    engineReady = false;
    requestId += 1;

    if (worker) {
      worker.terminate();
      worker = undefined;
    }

    priceButton.disabled = true;
    priceButton.textContent = "Loading…";
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
      spot: readNumber(form, "spot"),
      strike: readNumber(form, "strike"),
      rate: readNumber(form, "rate") / 100,
      dividendYield: readNumber(form, "dividendYield") / 100,
      volatility: readNumber(form, "volatility") / 100,
      maturity: readNumber(form, "maturity"),
      method,
      exerciseStyle: exerciseSelect.value,
      paths: method === "monte-carlo" ? readNumber(form, "paths") : 0,
      seed: method === "monte-carlo" ? readNumber(form, "seed") : 0,
      steps: method === "binomial" ? readNumber(form, "steps") : 0,
      carrPhases: method === "carr-randomization" ? readNumber(form, "carrPhases") : 0,
      sampling: method === "monte-carlo" ? form.elements.sampling.value : "pcg",
      varianceReduction: method === "monte-carlo"
        ? form.elements.varianceReduction.value
        : "none",
      includeDistribution: method === "monte-carlo" && form.elements.showDistribution.checked,
      optionType: form.querySelector('input[name="optionType"]:checked').value,
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
    if (!latestDistribution || distributionPanel.hidden || !resultDialog.open) return;
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(renderDistribution);
  });

  engineSelect.addEventListener("change", selectEngine);
  methodSelect.addEventListener("change", updateMethodFields);
  exerciseSelect.addEventListener("change", updateMethodOptions);

  function wireModuleDialog(module) {
    const trigger = root.querySelector(`.module-trigger[data-module="${module}"]`);
    const dialog = root.querySelector(`.module-dialog[data-module="${module}"]`);
    const fields = () => [...dialog.querySelectorAll("input, select")];
    let snapshot = null;

    trigger.addEventListener("click", () => {
      snapshot = captureFieldValues(fields());
      dialog.showModal();
    });

    dialog.querySelector(".dialog-save").addEventListener("click", () => {
      if (!validateFields(fields())) return;
      snapshot = null;
      dialog.close();
      refreshSummary(module);
    });

    dialog.querySelector(".dialog-cancel").addEventListener("click", () => {
      if (snapshot) restoreFieldValues(fields(), snapshot);
      dialog.close();
    });

    // Escape key: the browser fires "cancel" (default action closes the
    // dialog) before "close" -- restore here so Escape behaves like Cancel.
    dialog.addEventListener("cancel", () => {
      if (snapshot) restoreFieldValues(fields(), snapshot);
    });

    // Clicking the ::backdrop registers as a click on the <dialog> element
    // itself (outside its content box), so this is also "click outside to
    // cancel" without any extra markup.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        if (snapshot) restoreFieldValues(fields(), snapshot);
        dialog.close();
      }
    });
  }

  ["contractual", "asset", "model"].forEach(wireModuleDialog);

  priceButton.addEventListener("click", () => form.requestSubmit());
  resultTrigger.addEventListener("click", () => {
    resultDialog.showModal();
    if (latestDistribution) window.requestAnimationFrame(renderDistribution);
  });
  resultDialog.querySelector(".dialog-close").addEventListener("click", () => resultDialog.close());
  resultDialog.addEventListener("click", (event) => {
    if (event.target === resultDialog) resultDialog.close();
  });

  removeButton.addEventListener("click", () => {
    if (worker) worker.terminate();
    root.remove();
    panels.delete(panelId);
  });

  updateMethodOptions();
  ["contractual", "asset", "model"].forEach(refreshSummary);
  selectEngine();

  const control = {
    root,
    engineSelect,
    selectEngine,
    updateMethodOptions,
    updateMethodFields,
    refreshSummary,
  };
  panels.set(panelId, control);

  if (prefillEntry) {
    const { inputs, engineKey } = prefillEntry;
    root.querySelector(`input[name="optionType"][value="${inputs.optionType}"]`).checked = true;
    form.elements.spot.value = inputs.spot;
    form.elements.volatility.value = inputs.volatility * 100;
    form.elements.dividendYield.value = inputs.dividendYield * 100;
    form.elements.rate.value = inputs.rate * 100;
    exerciseSelect.value = inputs.exerciseStyle;
    form.elements.strike.value = inputs.strike;
    form.elements.maturity.value = inputs.maturity;
    updateMethodOptions();
    engineSelect.value = engineKey;
    methodSelect.value = inputs.method;
    updateMethodFields();
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

    ["contractual", "asset", "model"].forEach(refreshSummary);
    selectEngine();
  } else {
    // A brand-new instrument opens straight to "what are you pricing" --
    // option type is the first thing to nail down, everything else
    // already has a sane default.
    root.querySelector('.module-trigger[data-module="contractual"]').click();
  }

  root.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
  return control;
}

// ===================== Drag-and-drop module copy =====================
//
// Each module button is always visible (nothing is hidden behind a
// wizard anymore), so it doubles as both the drag source and the drop
// target for its module type. Dragging one instrument's "Model" button
// onto another instrument's "Model" button copies the underlying
// <dialog>'s field values across and refreshes the target's summary.

function copyModuleValues(sourcePanelId, module, targetRoot) {
  const sourceDialog = document.querySelector(
    `[data-panel="${sourcePanelId}"] .module-dialog[data-module="${module}"]`,
  );
  const targetDialog = targetRoot.querySelector(`.module-dialog[data-module="${module}"]`);
  if (!sourceDialog || !targetDialog) return;

  const sourceFields = [...sourceDialog.querySelectorAll("input, select")];
  const targetFields = [...targetDialog.querySelectorAll("input, select")];
  sourceFields.forEach((sourceField, index) => {
    const targetField = targetFields[index];
    if (!targetField) return;
    if (sourceField.type === "checkbox" || sourceField.type === "radio") {
      targetField.checked = sourceField.checked;
    } else {
      targetField.value = sourceField.value;
    }
  });

  const targetControl = panels.get(targetRoot.dataset.panel);
  if (!targetControl) return;
  if (module === "contractual") {
    targetControl.updateMethodOptions();
  } else if (module === "model") {
    const sourceEngine = sourceDialog.querySelector('[name="engine"]')?.value;
    if (sourceEngine && targetControl.engineSelect.value !== sourceEngine) {
      targetControl.engineSelect.value = sourceEngine;
      targetControl.selectEngine();
    }
    targetControl.updateMethodFields();
  }
  targetControl.refreshSummary(module);
}

instrumentsList.addEventListener("dragstart", (event) => {
  const trigger = event.target.closest(".module-trigger");
  if (!trigger) return;
  const panelRoot = trigger.closest("[data-panel]");
  event.dataTransfer.setData("text/plain", `${panelRoot.dataset.panel}|${trigger.dataset.module}`);
  event.dataTransfer.effectAllowed = "copy";
});

instrumentsList.addEventListener("dragover", (event) => {
  const trigger = event.target.closest(".module-trigger");
  if (!trigger || trigger.dataset.module === "result") return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  trigger.classList.add("drag-target");
});

instrumentsList.addEventListener("dragleave", (event) => {
  event.target.closest(".module-trigger")?.classList.remove("drag-target");
});

instrumentsList.addEventListener("drop", (event) => {
  const trigger = event.target.closest(".module-trigger");
  if (!trigger) return;
  event.preventDefault();
  trigger.classList.remove("drag-target");
  const [sourcePanelId, module] = event.dataTransfer.getData("text/plain").split("|");
  const targetRoot = trigger.closest("[data-panel]");
  if (sourcePanelId === targetRoot.dataset.panel || module !== trigger.dataset.module) return;
  copyModuleValues(sourcePanelId, module, targetRoot);
});

// ===================== Boot =====================

if (window.location.protocol === "file:") {
  addInstrumentButton.disabled = true;
  addInstrumentButton.textContent = "Opening local server...";
  window.location.replace("http://127.0.0.1:8000/");
} else {
  addInstrumentButton.addEventListener("click", () => createInstrumentPanel());
}
