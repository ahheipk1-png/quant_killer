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

// Exotic payoff types (barrier, asian, rainbow, digital, ...) route through
// a second, parallel worker pipeline -- same engine choices plus a 5th "js"
// reference engine, but different worker files and a different request/
// response message shape (see readExoticConfig/renderExoticResult below).
// Reuses ExoticFields.languageDefinitions (exotic-fields.js) so the two
// pages never drift on worker URLs/timeouts.
const exoticEngines = Object.fromEntries(
  Object.entries(ExoticFields.languageDefinitions).map(([key, def]) => [key, {
    label: def.label,
    detail: def.detail,
    workerUrl: def.url,
    workerType: def.type,
    loadTimeoutMs: def.timeout,
  }]),
);

function isExoticPayoff(payoffType) {
  return Boolean(payoffType) && !payoffType.startsWith("vanilla-");
}

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

  if (inputs.exotic) {
    // Generic dump, not a hand-crafted per-product summary: exotic entries
    // span 18+ wildly different field sets, so this just surfaces whatever
    // was actually submitted rather than guessing a "nice" presentation.
    const skip = new Set(["exotic", "product", "method"]);
    const rows = [
      ["Engine", (exoticEngines[engineKey] || engines[engineKey])?.label || engineKey],
      ["Payoff type", ExoticFields.productLabels[inputs.product] || inputs.product],
      ["Method", ExoticFields.methodLabels[inputs.method] || inputs.method],
    ];
    for (const [key, value] of Object.entries(inputs)) {
      if (skip.has(key) || value === "" || value === undefined || typeof value === "object") continue;
      rows.push([key, String(value)]);
    }
    rows.push(["Price", formatNumber(result.price)]);
    if (result.standardError !== null && result.standardError !== undefined) {
      rows.push(
        ["Std. error", formatNumber(result.standardError)],
        ["Std. deviation", formatNumber(result.standardDeviation)],
      );
    }
    rows.push(["Runtime", `${result.elapsedMs.toFixed(1)} ms`]);
    return rows;
  }

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
  return (engines[engineKey] || exoticEngines[engineKey])?.label || engineKey;
}

function summarizeModule(root, module) {
  const dialog = root.querySelector(`.module-dialog[data-module="${module}"]`);
  const q = (name) => dialog.querySelector(`[name="${name}"]`);
  const payoffType = root.querySelector('[name="payoffType"]').value;
  const exotic = isExoticPayoff(payoffType);

  if (module === "contractual") {
    const type = dialog.querySelector('input[name="optionType"]:checked').value === "call" ? "Call" : "Put";
    const strikeMaturity = `Strike ${formatNumber(Number(q("strike").value), 2)} · `
      + `${formatNumber(Number(q("maturity").value), 4)} yr`;
    if (!exotic) {
      const exercise = q("exerciseStyle").value === "american" ? "American" : "European";
      return `${type} · ${exercise} · ${strikeMaturity}`;
    }
    return `${ExoticFields.productLabels[payoffType] || payoffType} · ${type} · ${strikeMaturity}`;
  }
  if (module === "asset") {
    return `Spot ${formatNumber(Number(q("spot").value), 2)} · `
      + `Vol ${formatNumber(Number(q("volatility").value), 2)}% · `
      + `Div ${formatNumber(Number(q("dividendYield").value), 2)}% · `
      + `Rate ${formatNumber(Number(q("rate").value), 2)}%`;
  }
  if (module === "model") {
    const method = q("method").value;
    const methodLabel = exotic ? (ExoticFields.methodLabels[method] || method) : methods[method].label;
    return `${engineLabelFor(root)} · ${methodLabel}`;
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
  const verifyLinks = root.querySelector(".verify-links");
  const engineSelect = root.querySelector('[name="engine"]');
  const methodSelect = root.querySelector('[name="method"]');
  const exerciseSelect = root.querySelector('[name="exerciseStyle"]');
  const removeButton = root.querySelector(".instrument-remove");
  const payoffTypeSelect = root.querySelector('[name="payoffType"]');
  const volatilityModelSelect = root.querySelector('[name="volatilityModel"]');
  const optionTypeToggle = root.querySelector('[data-optiontype-toggle]');
  const scheduleModeSelect = root.querySelector('.module-dialog[data-module="contractual"] [name="scheduleMode"]');
  const assetCountInput = root.querySelector('[name="assetCount"]');
  const basketAssetsList = root.querySelector('[data-basket-assets]');
  const basketAddAssetButton = root.querySelector('.basket-add-asset');
  const observationDatesList = root.querySelector('[data-observation-dates]');
  const ladderRungsList = root.querySelector('[data-ladder-rungs]');

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
  const exerciseRow = root.querySelector(".exercise-row");
  const payoffOutput = root.querySelector(".payoff-output");
  const productOutput = root.querySelector(".product-output");
  const productRow = root.querySelector(".product-row");
  const volatilityModelOutput = root.querySelector(".volatility-model-output");
  const volatilityModelRow = root.querySelector(".volatility-model-row");
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
  let pendingConfig;
  let pendingExotic = false;
  let wasExotic = false;
  let latestDistribution;
  let resizeFrame;

  function engineTable() {
    return isExoticPayoff(payoffTypeSelect.value) ? exoticEngines : engines;
  }

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

  // ===== Exotic-payoff mode: everything below is the parallel path used
  // when payoffType is not "vanilla-*". Vanilla's functions above are
  // untouched by this -- the two pipelines never call into each other.

  function availableExoticMethods(product) {
    if (engineSelect.value !== "js") return ["mc"];
    const methodsForProduct = ExoticFields.referenceMethods[product] || ["mc"];
    if (volatilityModelSelect.value === "constant") return methodsForProduct;
    return methodsForProduct.filter((method) => method === "mc" || method === "qmc");
  }

  function renderExoticVolatilityFields() {
    const container = root.querySelector(".exotic-volatility-fields");
    const defs = ExoticFields.volatilityFieldDefinitions[volatilityModelSelect.value] || [];
    container.replaceChildren(...defs.map((def) => ExoticFields.createField(def)));
  }

  // Rainbow/himalayan basket assets beyond the primary (asset 1, which
  // reuses the Underlying asset(s) dialog) -- rendered as one row per asset
  // rather than the old fixed spot2/spot3 fields, so the basket size is no
  // longer capped at 3. Native (cpp/rust/csharp) engines still only read the
  // fixed 3-asset packed contract -- see readExoticConfig()'s validation.
  function createBasketAssetRow(index) {
    const row = document.createElement("div");
    row.className = "basket-asset-row";
    row.innerHTML = `
      <span class="basket-asset-label">Asset ${index}</span>
      <label class="field">Spot
        <input name="assetSpot" type="number" min="0.0001" step="any" value="100">
      </label>
      <label class="field">Volatility
        <div class="input-wrap">
          <input name="assetVolatility" type="number" min="0.01" step="any" value="25" data-transform="percent">
          <span class="suffix">%</span>
        </div>
      </label>
      <label class="field">Dividend yield
        <div class="input-wrap">
          <input name="assetDividendYield" type="number" step="any" value="0" data-transform="percent">
          <span class="suffix">%</span>
        </div>
      </label>
      <button type="button" class="basket-remove-asset" aria-label="Remove this asset">×</button>
    `;
    return row;
  }

  function renumberBasketAssetRows() {
    [...basketAssetsList.children].forEach((row, index) => {
      row.querySelector(".basket-asset-label").textContent = `Asset ${index + 2}`;
    });
  }

  // Grows/shrinks the row list to match `count` total assets, preserving
  // existing rows' values -- switching between rainbow and himalayan (which
  // share this same container) or re-running on every updatePayoffVisibility
  // call must never silently discard what the user already typed.
  function renderBasketAssetRows(count) {
    const target = Math.max(2, Math.min(20, Math.trunc(Number(count)) || 2)) - 1;
    const rows = [...basketAssetsList.children];
    if (rows.length > target) {
      rows.slice(target).forEach((row) => row.remove());
    } else {
      for (let index = rows.length; index < target; index += 1) {
        basketAssetsList.append(createBasketAssetRow(index + 2));
      }
    }
  }

  // Generic single-value add/remove row list -- used for ladderRungs and
  // observationDates, which (unlike basket assets) have no natural upper
  // bound and no "count" field driving them; the user just adds/removes
  // rows directly. Always keeps at least one row.
  function createDynamicListRow(inputAttrs, removeLabel) {
    const row = document.createElement("div");
    row.className = "dynamic-list-row";
    const input = document.createElement("input");
    Object.entries(inputAttrs).forEach(([key, value]) => input.setAttribute(key, value));
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "dynamic-list-remove";
    removeButton.setAttribute("aria-label", removeLabel);
    removeButton.textContent = "×";
    row.append(input, removeButton);
    return row;
  }

  function wireDynamicList(listElement, addButton, inputAttrs, removeLabel) {
    addButton.addEventListener("click", () => {
      listElement.append(createDynamicListRow(inputAttrs, removeLabel));
    });
    listElement.addEventListener("click", (event) => {
      const removeButton = event.target.closest(".dynamic-list-remove");
      if (!removeButton || listElement.children.length <= 1) return;
      removeButton.closest(".dynamic-list-row").remove();
    });
  }

  // Grows/shrinks a dynamic list to `targetLength` rows, cloning the row
  // shape from its own first row -- used by copyModuleValues to match the
  // dragged-from panel's row count before copying values in by index.
  function syncDynamicListLength(listElement, targetLength) {
    const template = listElement.firstElementChild;
    if (!template) return;
    while (listElement.children.length < Math.max(1, targetLength)) {
      listElement.append(template.cloneNode(true));
    }
    while (listElement.children.length > Math.max(1, targetLength)) {
      listElement.lastElementChild.remove();
    }
  }

  function updateExoticScheduleFields() {
    const scheduleDialog = root.querySelector('.module-dialog[data-module="contractual"]');
    const mode = scheduleModeSelect.value;
    const product = payoffTypeSelect.value;
    // Bermudan uses its own "exerciseDates" count field instead of the
    // generic "monitoringSteps" -- both follow the same equal-mode-only
    // visibility rule, but never both are the current product's field.
    scheduleDialog.querySelector('[name="monitoringSteps"]').closest(".field").hidden =
      product === "bermudan" || mode !== "equal";
    scheduleDialog.querySelector('[name="exerciseDates"]').closest(".field").hidden =
      product !== "bermudan" || mode !== "equal";
    scheduleDialog.querySelector('[name="valuationDate"]').closest(".field").hidden = mode === "equal";
    scheduleDialog.querySelector('[name="endDate"]').closest(".field").hidden = mode === "equal";
    scheduleDialog.querySelector('[name="holidayCalendar"]').closest(".field").hidden = mode !== "business-monthly";
    observationDatesList.closest(".dynamic-list-group").hidden = mode !== "custom";
  }

  function updateExoticMethodFields() {
    const method = methodSelect.value;
    const isMonteCarloFamily = method === "mc" || method === "qmc";

    // Vanilla-only MC fields never apply to the exotic pipeline -- it has
    // its own paths/seed + randomizedQmc, not sampling/varianceReduction.
    ["sampling", "varianceReduction", "showDistribution"].forEach((name) => {
      const field = form.querySelector(`[name="${name}"]`)?.closest(".field, .checkbox");
      if (!field) return;
      field.hidden = true;
      field.querySelectorAll("input, select").forEach((control) => { control.disabled = true; });
    });
    ["paths", "seed"].forEach((name) => {
      const field = form.querySelector(`[name="${name}"]`).closest(".field");
      field.hidden = !isMonteCarloFamily;
      field.querySelectorAll("input, select").forEach((control) => { control.disabled = !isMonteCarloFamily; });
    });
    const randomizedQmcField = form.querySelector('[name="randomizedQmc"]').closest(".checkbox");
    randomizedQmcField.hidden = method !== "qmc";
    randomizedQmcField.querySelector("input").disabled = method !== "qmc";

    setResultSummary("—");
    distributionPanel.hidden = true;
    latestDistribution = undefined;
    errorElement.textContent = "";
    refreshSummary("model");
  }

  function updateExoticMethodOptions() {
    const product = payoffTypeSelect.value;
    const previousMethod = methodSelect.value;
    const methodList = availableExoticMethods(product);
    methodSelect.replaceChildren(...methodList.map((value) =>
      new Option(ExoticFields.methodLabels[value] || value, value)));
    if (methodList.includes(previousMethod)) methodSelect.value = previousMethod;
    updateExoticMethodFields();
  }

  function updatePayoffVisibility() {
    const payoffType = payoffTypeSelect.value;
    const exotic = isExoticPayoff(payoffType);
    const product = exotic ? payoffType : null;

    // The "Exercise style" field itself stays hidden -- payoffType now
    // fully encodes it (vanilla-european/vanilla-american) so there's no
    // second, independently-editable control to fall out of sync with it.
    if (!exotic) exerciseSelect.value = payoffType === "vanilla-american" ? "american" : "european";

    // Rows must exist before the data-payoff-only pass below so it can set
    // their disabled state correctly (a fresh row created after that pass
    // would stay enabled-but-hidden, and thus wrongly included in FormData).
    if (product === "rainbow" || product === "himalayan") {
      renderBasketAssetRows(assetCountInput.value);
    }

    root.querySelectorAll("[data-payoff-only]").forEach((element) => {
      const keys = element.dataset.payoffOnly.split(",");
      const visible = keys.length === 1 && keys[0] === "vanilla" ? !exotic
        : keys.length === 1 && keys[0] === "exotic" ? exotic
        : keys.includes(product);
      element.hidden = !visible;
      element.querySelectorAll("input, select").forEach((control) => { control.disabled = !visible; });
    });

    const SCHEDULE_PRODUCTS = new Set([
      "barrier", "double-barrier", "bermudan", "asian", "lookback", "ladder",
      "autocallable", "phoenix-autocall", "yield-seeker", "himalayan",
      "variance-swap", "volatility-swap", "variance-option", "volatility-option", "accumulator",
    ]);
    const NO_OPTION_TYPE = new Set([
      "autocallable", "phoenix-autocall", "yield-seeker", "himalayan", "compound",
      "variance-swap", "volatility-swap", "accumulator",
    ]);

    optionTypeToggle.hidden = NO_OPTION_TYPE.has(product);
    verifyLinks.hidden = exotic;

    const hasJsOption = [...engineSelect.options].some((option) => option.value === "js");
    if (exotic && !hasJsOption) {
      engineSelect.add(new Option("JavaScript · reference", "js"), engineSelect.options[0]);
    } else if (!exotic && hasJsOption) {
      if (engineSelect.value === "js") engineSelect.value = "cpp";
      [...engineSelect.options].find((option) => option.value === "js")?.remove();
    }

    if (exotic) {
      renderExoticVolatilityFields();
      updateExoticMethodOptions();
      if (SCHEDULE_PRODUCTS.has(product)) updateExoticScheduleFields();
    } else {
      updateMethodOptions();
    }

    if (exotic !== wasExotic) {
      wasExotic = exotic;
      selectEngine();
    }
  }

  function readExoticConfig() {
    const data = Object.fromEntries(new FormData(form).entries());
    data.exotic = true;
    data.product = payoffTypeSelect.value;
    data.rate = Number(data.rate) / 100;
    data.dividendYield = Number(data.dividendYield) / 100;
    data.volatility = Number(data.volatility) / 100;
    // Generic, not a hardcoded field list: every field marked
    // data-transform="percent" (the hand-written ones plus whatever
    // renderExoticVolatilityFields() generated) gets divided by 100 --
    // mirrors exotics.js's own readConfig() exactly.
    form.querySelectorAll("[data-transform='percent']").forEach((input) => {
      data[input.name] = Number(input.value) / 100;
    });
    data.randomizedQmc = Boolean(form.elements.randomizedQmc?.checked);
    data.includeInitialFixing = Boolean(form.elements.includeInitialFixing?.checked);
    data.memoryCoupon = form.elements.memoryCoupon ? form.elements.memoryCoupon.checked : true;
    data.observationDates = [...observationDatesList.querySelectorAll('[name="observationDate"]')]
      .map((el) => el.value).filter(Boolean);
    data.ladderRungs = [...ladderRungsList.querySelectorAll('[name="ladderRung"]')]
      .map((el) => Number(el.value)).filter(Number.isFinite);
    if (data.product === "ladder" && ["cpp", "rust", "csharp"].includes(engineSelect.value)
      && data.ladderRungs.length > 3) {
      throw new Error(
        `${engineTable()[engineSelect.value].label} supports at most 3 ladder rungs today -- `
        + "switch to JavaScript or Python, or remove rungs down to 3.",
      );
    }
    data.basketWeights = String(data.basketWeights || "0.5,0.3,0.2").split(",").map(Number).filter(Number.isFinite);
    if (data.product === "rainbow" || data.product === "himalayan") {
      const assetCount = Math.max(2, Math.min(20, Math.trunc(Number(data.assetCount)) || 2));
      data.assetCount = assetCount;
      const extraCount = assetCount - 1;
      data.assetSpots = [...basketAssetsList.querySelectorAll('[name="assetSpot"]')]
        .slice(0, extraCount).map((el) => Number(el.value));
      data.assetVolatilities = [...basketAssetsList.querySelectorAll('[name="assetVolatility"]')]
        .slice(0, extraCount).map((el) => Number(el.value) / 100);
      data.assetDividendYields = [...basketAssetsList.querySelectorAll('[name="assetDividendYield"]')]
        .slice(0, extraCount).map((el) => Number(el.value) / 100);
      // Backward compat for the fixed 3-asset packed contract that
      // PolyglotContract.pack() sends to the C++/Rust/C# engines -- only
      // meaningful (and only reachable) when assetCount <= 3, since the
      // check right below rejects those engines above 3 assets.
      data.spot2 = data.assetSpots[0] ?? 100;
      data.volatility2 = data.assetVolatilities[0] ?? 0.25;
      data.dividendYield2 = data.assetDividendYields[0] ?? 0;
      data.spot3 = data.assetSpots[1] ?? 100;
      data.volatility3 = data.assetVolatilities[1] ?? 0.3;
      data.dividendYield3 = data.assetDividendYields[1] ?? 0;
      if (["cpp", "rust", "csharp"].includes(engineSelect.value) && assetCount > 3) {
        throw new Error(
          `${engineTable()[engineSelect.value].label} supports at most 3 basket assets today -- `
          + "switch to JavaScript or Python, or remove assets down to 3.",
        );
      }
    }
    data.observationTimes = ExoticFields.buildObservationTimes(data);
    return data;
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
        `${engineTable()[engineSelect.value].detail} ready - ${loadMs.toFixed(0)} ms`,
        "ready",
      );
      return;
    }

    if (message.type === "error") {
      if (message.requestId !== undefined) {
        setBusy(false);
        errorElement.textContent = message.message;
        setEngineStatus(`${engineTable()[engineSelect.value].detail} ready`, "ready");
      } else {
        showEngineLoadFailure(message.message);
      }
      return;
    }

    if (message.type !== "result" || message.requestId !== requestId) return;

    setBusy(false);
    if (pendingExotic) {
      renderExoticResult(message);
      return;
    }

    const engine = engineTable()[engineSelect.value];
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

  // Exotic workers post a nested {result:{price, standardError, ...}} shape,
  // never the flat vanilla shape -- kept as a fully separate render path
  // rather than reconciled into the vanilla one (see plan: response shapes
  // are irreconcilably different). No distribution charts: no exotic
  // pricer (JS or native) returns terminal-price/payoff sample arrays.
  function renderExoticResult(message) {
    const result = message.result;
    const config = result.config;
    const engine = engineTable()[engineSelect.value];
    setEngineStatus(`${engine.detail} ready`, "ready");

    priceOutput.textContent = ExoticFields.formatNumber(result.price);
    errorOutput.textContent = result.standardError === null || result.standardError === undefined
      ? "Deterministic estimate"
      : `SE ${ExoticFields.formatNumber(result.standardError)} · payoff σ ${ExoticFields.formatNumber(result.standardDeviation)}`;
    productRow.hidden = false;
    productOutput.textContent = ExoticFields.productLabels[config.product] || config.product;
    methodOutput.textContent = ExoticFields.methodLabels[result.method] || result.method;
    exerciseRow.hidden = true;
    volatilityModelRow.hidden = false;
    volatilityModelOutput.textContent = ExoticFields.volatilityLabels[config.volatilityModel] || "—";
    payoffOutput.textContent = ExoticFields.fallbackDescriptions[config.product] || "—";
    intervalRow.hidden = true;
    stdRow.hidden = true;
    samplingRow.hidden = true;
    varianceRow.hidden = true;
    runtimeOutput.textContent = `${result.elapsedMs.toFixed(1)} ms`;
    engineOutput.textContent = engine.detail;
    // Simpler than exotics.js's own workload text for pde/adi (it reports
    // the configured spot/time grid size) -- this UI has no PDE-grid
    // fields at all yet (pde-* methods are JS-engine-only here, using the
    // pricer's built-in default grid), so a grid-dimension readout would
    // just be undefined values. A known, explicit gap, not silently hidden.
    if (result.method === "mc" || result.method === "qmc") {
      workloadOutput.textContent = `${new Intl.NumberFormat("en-US").format(result.samples)} paths`;
    } else if (result.method === "tree") {
      workloadOutput.textContent = "CRR exercise tree";
    } else if (result.method === "pde" || result.method === "adi" || result.method.startsWith("pde-")) {
      workloadOutput.textContent = "Finite-difference PDE, default grid";
    } else if (result.method === "semi-closed") {
      workloadOutput.textContent = "Semi-closed spectral series";
    } else if (result.method === "static-replication") {
      workloadOutput.textContent = "Static OTM option replication";
    } else {
      workloadOutput.textContent = "Closed-form / moment matching";
    }
    setResultSummary(ExoticFields.formatNumber(result.price, 4));
    distributionPanel.hidden = true;
    latestDistribution = undefined;

    addHistoryEntry(pendingConfig, engineSelect.value, {
      price: result.price,
      standardError: result.standardError,
      standardDeviation: result.standardDeviation,
      elapsedMs: result.elapsedMs,
    });
  }

  function handleWorkerError() {
    showEngineLoadFailure("The pricing worker could not start. Click retry to load it again.");
  }

  function selectEngine() {
    const engine = engineTable()[engineSelect.value];
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

    if (isExoticPayoff(payoffTypeSelect.value)) {
      let config;
      try {
        config = readExoticConfig();
      } catch (error) {
        errorElement.textContent = error.message || String(error);
        return;
      }
      const method = methodSelect.value;
      requestId += 1;
      pendingConfig = config;
      pendingExotic = true;
      distributionPanel.hidden = true;
      latestDistribution = undefined;
      setBusy(true);
      setEngineStatus(
        `${engineTable()[engineSelect.value].label} ${ExoticFields.methodLabels[method] || method} running`,
        "working",
      );
      if (engineSelect.value === "js") {
        worker.postMessage({ type: "price", requestId, method, config });
      } else {
        worker.postMessage({
          type: "price", requestId, method: "mc", config,
          parameters: PolyglotContract.pack(config),
          paths: Math.trunc(Number(config.paths)), seed: Math.trunc(Number(config.seed)),
        });
      }
      return;
    }
    pendingExotic = false;

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

  engineSelect.addEventListener("change", () => {
    selectEngine();
    if (isExoticPayoff(payoffTypeSelect.value)) updateExoticMethodOptions();
  });
  methodSelect.addEventListener("change", () => {
    if (isExoticPayoff(payoffTypeSelect.value)) updateExoticMethodFields();
    else updateMethodFields();
  });
  exerciseSelect.addEventListener("change", updateMethodOptions);
  payoffTypeSelect.addEventListener("change", updatePayoffVisibility);
  volatilityModelSelect.addEventListener("change", () => {
    renderExoticVolatilityFields();
    updateExoticMethodOptions();
  });
  scheduleModeSelect.addEventListener("change", updateExoticScheduleFields);

  assetCountInput.addEventListener("input", () => renderBasketAssetRows(assetCountInput.value));
  basketAddAssetButton.addEventListener("click", () => {
    const nextCount = Math.min(20, basketAssetsList.children.length + 2);
    assetCountInput.value = nextCount;
    renderBasketAssetRows(nextCount);
  });
  basketAssetsList.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".basket-remove-asset");
    if (!removeButton || basketAssetsList.children.length <= 1) return;
    removeButton.closest(".basket-asset-row").remove();
    renumberBasketAssetRows();
    assetCountInput.value = basketAssetsList.children.length + 1;
  });

  wireDynamicList(
    observationDatesList, root.querySelector('[data-add="observationDate"]'),
    { name: "observationDate", type: "date", value: "2026-09-01" }, "Remove this date",
  );
  wireDynamicList(
    ladderRungsList, root.querySelector('[data-add="ladderRung"]'),
    { name: "ladderRung", type: "number", min: "0.0001", step: "any", value: "100" }, "Remove this rung",
  );

  function wireModuleDialog(module, onRestore) {
    const trigger = root.querySelector(`.module-trigger[data-module="${module}"]`);
    const dialog = root.querySelector(`.module-dialog[data-module="${module}"]`);
    // Dynamic add/remove rows (basket assets, ladder rungs, custom dates)
    // can't be snapshotted/restored by fixed DOM position like every other
    // field here -- excluded from this generic list and handled separately
    // below (innerHTML snapshot of the whole row container) wherever this
    // module actually contains one.
    const fields = () => [...dialog.querySelectorAll("input, select")]
      .filter((field) => !field.closest("[data-dynamic-list]"));
    let snapshot = null;

    function restore() {
      if (!snapshot) return;
      restoreFieldValues(fields(), snapshot);
      onRestore?.();
    }

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
      restore();
      dialog.close();
    });

    // Escape key: the browser fires "cancel" (default action closes the
    // dialog) before "close" -- restore here so Escape behaves like Cancel.
    dialog.addEventListener("cancel", restore);

    // Clicking the ::backdrop registers as a click on the <dialog> element
    // itself (outside its content box), so this is also "click outside to
    // cancel" without any extra markup.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        restore();
        dialog.close();
      }
    });
  }

  // "contractual" holds payoffType -- reverting it on Cancel/Escape/backdrop
  // must also re-sync the toolbar/Model dialog to whatever payoff type was
  // actually restored, not the tentative one the user was previewing.
  wireModuleDialog("contractual", updatePayoffVisibility);
  ["asset", "model"].forEach((module) => wireModuleDialog(module));

  // Basket-asset rows: snapshot the whole row container on open, restore it
  // wholesale on Cancel/Escape/backdrop (see the fields() exclusion above).
  // Re-captured fresh every open, so a save doesn't need to clear it -- a
  // later cancel-after-a-failed-save correctly reverts to before that edit.
  {
    const contractualDialog = root.querySelector('.module-dialog[data-module="contractual"]');
    const contractualTrigger = root.querySelector('.module-trigger[data-module="contractual"]');
    const dynamicLists = [...contractualDialog.querySelectorAll("[data-dynamic-list]")];
    let dynamicListSnapshots = null;
    contractualTrigger.addEventListener("click", () => {
      dynamicListSnapshots = dynamicLists.map((list) => list.innerHTML);
    });
    function restoreDynamicLists() {
      if (dynamicListSnapshots === null) return;
      dynamicLists.forEach((list, index) => { list.innerHTML = dynamicListSnapshots[index]; });
    }
    contractualDialog.querySelector(".dialog-cancel").addEventListener("click", restoreDynamicLists);
    contractualDialog.addEventListener("cancel", restoreDynamicLists);
    contractualDialog.addEventListener("click", (event) => {
      if (event.target === contractualDialog) restoreDynamicLists();
    });
  }

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

  updatePayoffVisibility();
  ["contractual", "asset", "model"].forEach(refreshSummary);
  selectEngine();

  const control = {
    root,
    engineSelect,
    payoffTypeSelect,
    selectEngine,
    updateMethodOptions,
    updateMethodFields,
    updateExoticMethodOptions,
    updateExoticMethodFields,
    updatePayoffVisibility,
    renderExoticVolatilityFields,
    updateExoticScheduleFields,
    renderBasketAssetRows,
    basketAssetsList,
    observationDatesList,
    ladderRungsList,
    syncDynamicListLength,
    refreshSummary,
  };
  panels.set(panelId, control);

  if (prefillEntry?.inputs?.exotic) {
    // Generic re-population by field name -- exotic configs span too many
    // shapes (18+ products) to hand-map like the vanilla branch below.
    // form.elements[name] on a radio group returns a RadioNodeList, and
    // assigning .value to one of those checks the matching radio natively.
    payoffTypeSelect.value = prefillEntry.inputs.product;
    updatePayoffVisibility();
    // readExoticConfig() stores rate/volatility/dividendYield (and the
    // basket asset 2/3 equivalents) as decimals, but their <input> fields
    // display percent -- re-multiply on the way back in, or duplicating an
    // entry silently re-divides by 100 on the next submit.
    const percentFields = new Set([
      "rate", "dividendYield", "volatility", "volatility2", "dividendYield2", "volatility3", "dividendYield3",
    ]);
    Object.entries(prefillEntry.inputs).forEach(([name, value]) => {
      const element = form.elements[name];
      if (!element || value === undefined) return;
      if (element.type === "checkbox") element.checked = Boolean(value);
      else if (percentFields.has(name)) element.value = Number(value) * 100;
      else element.value = Array.isArray(value) ? value.join(",") : value;
    });
    // assetSpots/assetVolatilities/assetDividendYields have no single
    // matching form.elements name (they're arrays backing repeated-name
    // dynamic rows), so the generic loop above silently skips them --
    // rebuild the row count first, then populate each row explicitly.
    if (prefillEntry.inputs.product === "rainbow" || prefillEntry.inputs.product === "himalayan") {
      renderBasketAssetRows(prefillEntry.inputs.assetCount);
      const spotInputs = [...basketAssetsList.querySelectorAll('[name="assetSpot"]')];
      const volInputs = [...basketAssetsList.querySelectorAll('[name="assetVolatility"]')];
      const divInputs = [...basketAssetsList.querySelectorAll('[name="assetDividendYield"]')];
      (prefillEntry.inputs.assetSpots || []).forEach((value, index) => {
        if (spotInputs[index]) spotInputs[index].value = value;
      });
      (prefillEntry.inputs.assetVolatilities || []).forEach((value, index) => {
        if (volInputs[index]) volInputs[index].value = Number(value) * 100;
      });
      (prefillEntry.inputs.assetDividendYields || []).forEach((value, index) => {
        if (divInputs[index]) divInputs[index].value = Number(value) * 100;
      });
    }
    // observationDates/ladderRungs have the same "array, no single matching
    // form.elements name" problem as the basket arrays above.
    if (Array.isArray(prefillEntry.inputs.observationDates) && prefillEntry.inputs.observationDates.length) {
      syncDynamicListLength(observationDatesList, prefillEntry.inputs.observationDates.length);
      const dateInputs = [...observationDatesList.querySelectorAll('[name="observationDate"]')];
      prefillEntry.inputs.observationDates.forEach((value, index) => {
        if (dateInputs[index]) dateInputs[index].value = value;
      });
    }
    if (Array.isArray(prefillEntry.inputs.ladderRungs) && prefillEntry.inputs.ladderRungs.length) {
      syncDynamicListLength(ladderRungsList, prefillEntry.inputs.ladderRungs.length);
      const rungInputs = [...ladderRungsList.querySelectorAll('[name="ladderRung"]')];
      prefillEntry.inputs.ladderRungs.forEach((value, index) => {
        if (rungInputs[index]) rungInputs[index].value = value;
      });
    }
    engineSelect.value = prefillEntry.engineKey;
    updateExoticMethodOptions();
    methodSelect.value = prefillEntry.inputs.method;
    updateExoticMethodFields();
    renderExoticVolatilityFields();
    updateExoticScheduleFields();
    ["contractual", "asset", "model"].forEach(refreshSummary);
    wasExotic = true;
    selectEngine();
  } else if (prefillEntry) {
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

  const targetControl = panels.get(targetRoot.dataset.panel);
  if (!targetControl) return;

  // Name-based, not positional: source and target dialogs can render
  // different field sets once payoff type diverges (e.g. dragging "Model"
  // from a vanilla instrument onto an exotic one), so index-matching would
  // silently assign values to the wrong fields. Dynamic-list rows (basket
  // assets, ladder rungs, custom dates) are the one genuine exception --
  // excluded here and copied by row index below, since e.g.
  // `[name="assetSpot"]` alone always resolves to the target's FIRST row
  // regardless of which source row it came from.
  [...sourceDialog.querySelectorAll("input, select")].forEach((sourceField) => {
    if (!sourceField.name || sourceField.closest("[data-dynamic-list]")) return;
    // Radios share one `name` across every choice in the group --
    // `[name="x"]` alone always resolves to the same (first) radio no
    // matter which one fired, silently corrupting the target's selection.
    // Match on name+value so each source radio maps to its own target.
    const targetField = sourceField.type === "radio"
      ? targetDialog.querySelector(`input[name="${sourceField.name}"][value="${sourceField.value}"]`)
      : targetDialog.querySelector(`[name="${sourceField.name}"]`);
    if (!targetField) return;
    // A select whose source value has no matching <option> on the target
    // (e.g. an exotic-only method name, or the "js" engine when the target
    // is still vanilla) can't accept it -- leave the target's own value.
    if (targetField.tagName === "SELECT" && ![...targetField.options].some((o) => o.value === sourceField.value)) {
      return;
    }
    if (sourceField.type === "checkbox" || sourceField.type === "radio") {
      targetField.checked = sourceField.checked;
    } else {
      targetField.value = sourceField.value;
    }
  });

  if (module === "contractual") {
    // payoffType is itself a field in this dialog, so a copy can change
    // the target's payoff type -- cascade exactly like a manual edit would
    // (toolbar buttons, engine table, method list, exerciseStyle sync).
    targetControl.updatePayoffVisibility();
    targetControl.updateExoticScheduleFields();
    const sourceProduct = sourceDialog.querySelector('[name="payoffType"]')?.value;
    if (sourceProduct === "rainbow" || sourceProduct === "himalayan") {
      const sourceAssetCount = sourceDialog.querySelector('[name="assetCount"]').value;
      targetControl.renderBasketAssetRows(sourceAssetCount);
      ["assetSpot", "assetVolatility", "assetDividendYield"].forEach((name) => {
        const sourceInputs = [...sourceDialog.querySelectorAll(`[data-basket-assets] [name="${name}"]`)];
        const targetInputs = [...targetControl.basketAssetsList.querySelectorAll(`[name="${name}"]`)];
        sourceInputs.forEach((sourceInput, index) => {
          if (targetInputs[index]) targetInputs[index].value = sourceInput.value;
        });
      });
    }
    [
      ["[data-observation-dates]", "observationDate", targetControl.observationDatesList],
      ["[data-ladder-rungs]", "ladderRung", targetControl.ladderRungsList],
    ].forEach(([sourceSelector, name, targetList]) => {
      const sourceInputs = [...sourceDialog.querySelectorAll(`${sourceSelector} [name="${name}"]`)];
      targetControl.syncDynamicListLength(targetList, sourceInputs.length);
      const targetInputs = [...targetList.querySelectorAll(`[name="${name}"]`)];
      sourceInputs.forEach((sourceInput, index) => {
        if (targetInputs[index]) targetInputs[index].value = sourceInput.value;
      });
    });
  } else if (module === "model") {
    // engine now lives in the instrument header, not the Model dialog.
    const sourceRoot = document.querySelector(`[data-panel="${sourcePanelId}"]`);
    const sourceEngine = sourceRoot?.querySelector('[name="engine"]')?.value;
    const engineIsValidForTarget = sourceEngine
      && [...targetControl.engineSelect.options].some((option) => option.value === sourceEngine);
    if (engineIsValidForTarget && targetControl.engineSelect.value !== sourceEngine) {
      targetControl.engineSelect.value = sourceEngine;
      targetControl.selectEngine();
    }
    if (isExoticPayoff(targetControl.payoffTypeSelect.value)) {
      targetControl.renderExoticVolatilityFields();
      targetControl.updateExoticMethodOptions();
    } else {
      targetControl.updateMethodFields();
    }
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
