"use strict";

const form = document.querySelector("#path-form");
const runButton = document.querySelector("#run-button");
const errorBox = document.querySelector("#form-error");
const statusBox = document.querySelector("#engine-status");
const emptyState = document.querySelector("#empty-state");
const analysis = document.querySelector("#analysis");
const stepSlider = document.querySelector("#step-slider");
const metricSelect = document.querySelector("#metric");
const thresholdInput = document.querySelector("#threshold");
const binsInput = document.querySelector("#histogram-bins");
const volatilityModel = document.querySelector("#volatilityModel");
const underlyingMode = document.querySelector("#underlyingMode");
const assetCount = document.querySelector("#basketAssetCount");
const seriesSelect = document.querySelector("#series");
const samplingSelect = document.querySelector("#sampling");
const worker = new Worker("path-distribution-worker.js?v=3");

const samplingNotes = {
  mc: "Independent PCG32 pseudorandom draws. Change the seed for a fresh sample.",
  qmc: "A deterministic Sobol digital net. The seed does not change the sequence.",
  rqmc: "Sobol points with a seeded digital shift, retaining QMC structure while permitting independent replications.",
};

const volatilityNotes = {
  constant: "One fixed annualized volatility throughout the path.",
  term: "Volatility interpolates linearly from the initial value to the ending term value.",
  local: "Term volatility multiplied by a bounded power leverage function of spot.",
  heston: "Full-truncation Euler variance with mean reversion, vol-of-vol, and spot/variance correlation.",
  slv: "Heston stochastic variance multiplied by the same local-volatility leverage function.",
};

let currentResult = null;
let currentRequest = 0;
let timeoutHandle = null;

function numberValue(id) {
  return Number(document.querySelector(`#${id}`).value);
}

function percentValue(id) {
  return numberValue(id) / 100;
}

function parseWeights() {
  const weights = document.querySelector("#basketWeights").value
    .split(",").map((value) => Number(value.trim())).filter(Number.isFinite);
  const count = numberValue("basketAssetCount");
  if (weights.length < count) throw new Error(`Enter at least ${count} comma-separated basket weights.`);
  return weights;
}

function readConfig() {
  const config = {
    sampling: samplingSelect.value,
    volatilityModel: volatilityModel.value,
    paths: numberValue("paths"),
    timeSteps: numberValue("timeSteps"),
    maturity: numberValue("maturity"),
    seed: numberValue("seed"),
    spot: numberValue("spot"),
    rate: percentValue("rate"),
    dividendYield: percentValue("dividendYield"),
    volatility: percentValue("volatility"),
    underlyingMode: underlyingMode.value,
    basketAssetCount: numberValue("basketAssetCount"),
    series: underlyingMode.value === "single" ? "underlying" : seriesSelect.value,
    basketWeights: parseWeights(),
    basketOrder: numberValue("basketOrder"),
    correlation: numberValue("correlation"),
    spot2: numberValue("spot2"),
    volatility2: percentValue("volatility2"),
    dividendYield2: percentValue("dividendYield2"),
    spot3: numberValue("spot3"),
    volatility3: percentValue("volatility3"),
    dividendYield3: percentValue("dividendYield3"),
    termVolatility: percentValue("termVolatility"),
    localBeta: numberValue("localBeta"),
    hestonKappa: numberValue("hestonKappa"),
    hestonLongRunVol: percentValue("hestonLongRunVol"),
    hestonVolOfVol: numberValue("hestonVolOfVol"),
    hestonRho: numberValue("hestonRho"),
  };
  if (!Object.values(config).every((value) => typeof value !== "number" || Number.isFinite(value))) {
    throw new Error("Every numeric input must be finite.");
  }
  if (!(config.maturity > 0 && config.spot > 0 && config.volatility > 0)) {
    throw new Error("Horizon, spot, and initial volatility must be positive.");
  }
  return config;
}

function updateVisibleFields() {
  const basket = underlyingMode.value !== "single";
  document.querySelectorAll(".basket-field").forEach((element) => { element.hidden = !basket; });
  const threeAssets = basket && assetCount.value === "3";
  document.querySelectorAll(".asset-three-field").forEach((element) => { element.hidden = !threeAssets; });
  document.querySelectorAll(".order-field").forEach((element) => {
    element.hidden = !basket || underlyingMode.value !== "order-performance";
  });
  [...seriesSelect.options].forEach((option) => {
    option.disabled = option.value === "asset-3" && !threeAssets;
  });
  if (!threeAssets && seriesSelect.value === "asset-3") seriesSelect.value = "underlying";

  const model = volatilityModel.value;
  const showTerm = ["term", "local", "slv"].includes(model);
  const showLocal = ["local", "slv"].includes(model);
  const showHeston = ["heston", "slv"].includes(model);
  document.querySelectorAll(".term-field").forEach((element) => { element.hidden = !showTerm; });
  document.querySelectorAll(".local-field").forEach((element) => { element.hidden = !showLocal; });
  document.querySelectorAll(".heston-field").forEach((element) => { element.hidden = !showHeston; });
  const hasParameters = showTerm || showLocal || showHeston;
  document.querySelectorAll(".section-title.volatility-parameter").forEach((element) => {
    element.hidden = !hasParameters;
  });
  document.querySelector("#sampling-note").textContent = samplingNotes[samplingSelect.value];
  document.querySelector("#volatility-note").textContent = volatilityNotes[model];
}

function setBusy(busy) {
  runButton.disabled = busy;
  runButton.textContent = busy ? "Simulating..." : "Simulate paths";
  statusBox.dataset.state = busy ? "working" : "ready";
  if (busy) statusBox.textContent = "Simulating paths and quantile bands...";
}

function formatNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return "-";
  const magnitude = Math.abs(value);
  if ((magnitude > 0 && magnitude < 0.0001) || magnitude >= 1000000) return value.toExponential(4);
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function metricValue(level, metric, initialValue) {
  if (metric === "simple-return") return level / initialValue - 1;
  if (metric === "log-return") return Math.log(level / initialValue);
  return level;
}

function metricLabel(metric) {
  if (metric === "simple-return") return "simple return";
  if (metric === "log-return") return "log return";
  return "underlying level";
}

function currentSlice() {
  const step = Number(stepSlider.value);
  const start = step * currentResult.pathCount;
  const raw = currentResult.levels.subarray(start, start + currentResult.pathCount);
  const metric = metricSelect.value;
  return Float64Array.from(raw, (value) => metricValue(value, metric, currentResult.initialValue));
}

function quantile(sorted, probability) {
  const position = probability * (sorted.length - 1);
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[Math.min(lower + 1, sorted.length - 1)] * weight;
}

function summarize(values) {
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let second = 0;
  let third = 0;
  let fourth = 0;
  for (const value of values) {
    const deviation = value - mean;
    const square = deviation * deviation;
    second += square;
    third += square * deviation;
    fourth += square * square;
  }
  const variance = values.length > 1 ? second / (values.length - 1) : 0;
  const standardDeviation = Math.sqrt(Math.max(variance, 0));
  const populationSecond = second / values.length;
  const skewness = populationSecond > 0 ? (third / values.length) / populationSecond ** 1.5 : 0;
  const kurtosis = populationSecond > 0 ? (fourth / values.length) / populationSecond ** 2 - 3 : 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return { mean, standardDeviation, skewness, kurtosis, sorted };
}

function canvasContext(canvas, logicalHeight) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const logicalWidth = Math.max(canvas.clientWidth, 320);
  canvas.style.height = `${logicalHeight}px`;
  canvas.width = Math.floor(logicalWidth * ratio);
  canvas.height = Math.floor(logicalHeight * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: logicalWidth, height: logicalHeight };
}

function drawAxes(context, width, height, bounds, labels) {
  const { left, right, top, bottom } = bounds;
  context.strokeStyle = "#29425e";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, height - bottom);
  context.lineTo(width - right, height - bottom);
  context.stroke();
  context.fillStyle = "#9db0c5";
  context.font = "11px ui-sans-serif, system-ui";
  context.fillText(labels.yMax, 4, top + 4);
  context.fillText(labels.yMin, 4, height - bottom + 4);
  context.textAlign = "left";
  context.fillText(labels.xMin, left, height - 8);
  context.textAlign = "right";
  context.fillText(labels.xMax, width - right, height - 8);
  context.textAlign = "left";
}

function drawHistogram(values, summary) {
  const canvas = document.querySelector("#histogram-chart");
  const { context, width, height } = canvasContext(canvas, 340);
  context.clearRect(0, 0, width, height);
  const binCount = Math.max(10, Math.min(120, Math.trunc(Number(binsInput.value) || 50)));
  let minimum = summary.sorted[0];
  let maximum = summary.sorted[summary.sorted.length - 1];
  if (maximum <= minimum) { minimum -= 0.5; maximum += 0.5; }
  const counts = new Uint32Array(binCount);
  for (const value of values) {
    const index = Math.min(Math.floor((value - minimum) / (maximum - minimum) * binCount), binCount - 1);
    counts[Math.max(index, 0)] += 1;
  }
  const maxCount = Math.max(...counts, 1);
  const bounds = { left: 54, right: 16, top: 18, bottom: 34 };
  const plotWidth = width - bounds.left - bounds.right;
  const plotHeight = height - bounds.top - bounds.bottom;
  context.fillStyle = "rgba(94, 225, 194, 0.55)";
  for (let index = 0; index < binCount; index += 1) {
    const x = bounds.left + index * plotWidth / binCount;
    const barHeight = counts[index] / maxCount * plotHeight;
    context.fillRect(x + 1, bounds.top + plotHeight - barHeight, Math.max(plotWidth / binCount - 2, 1), barHeight);
  }
  const xFor = (value) => bounds.left + (value - minimum) / (maximum - minimum) * plotWidth;
  const marker = (value, color, label, y) => {
    if (value < minimum || value > maximum) return;
    context.strokeStyle = color;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(xFor(value), bounds.top);
    context.lineTo(xFor(value), bounds.top + plotHeight);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = color;
    context.font = "11px ui-sans-serif, system-ui";
    context.fillText(label, Math.min(xFor(value) + 5, width - 90), y);
  };
  marker(summary.mean, "#ffd166", "mean", 31);
  marker(quantile(summary.sorted, 0.5), "#f4f8fc", "median", 46);
  marker(Number(thresholdInput.value), "#ff8b8b", "threshold", 61);
  drawAxes(context, width, height, bounds, {
    yMax: maxCount.toLocaleString(), yMin: "0",
    xMin: formatNumber(minimum, 4), xMax: formatNumber(maximum, 4),
  });
}

function transformedFanValue(step, quantileIndex) {
  const value = currentResult.fan[step * currentResult.quantiles.length + quantileIndex];
  return metricValue(value, metricSelect.value, currentResult.initialValue);
}

function drawFanChart() {
  const canvas = document.querySelector("#fan-chart");
  const { context, width, height } = canvasContext(canvas, 340);
  context.clearRect(0, 0, width, height);
  const bounds = { left: 58, right: 16, top: 18, bottom: 34 };
  const plotWidth = width - bounds.left - bounds.right;
  const plotHeight = height - bounds.top - bounds.bottom;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let step = 0; step <= currentResult.timeSteps; step += 1) {
    minimum = Math.min(minimum, transformedFanValue(step, 0));
    maximum = Math.max(maximum, transformedFanValue(step, 6));
  }
  if (maximum <= minimum) { minimum -= 0.5; maximum += 0.5; }
  const xFor = (step) => bounds.left + step / currentResult.timeSteps * plotWidth;
  const yFor = (value) => bounds.top + (maximum - value) / (maximum - minimum) * plotHeight;
  const band = (lowerIndex, upperIndex, color) => {
    context.beginPath();
    for (let step = 0; step <= currentResult.timeSteps; step += 1) {
      const x = xFor(step);
      const y = yFor(transformedFanValue(step, upperIndex));
      if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    for (let step = currentResult.timeSteps; step >= 0; step -= 1) {
      context.lineTo(xFor(step), yFor(transformedFanValue(step, lowerIndex)));
    }
    context.closePath();
    context.fillStyle = color;
    context.fill();
  };
  band(0, 6, "rgba(94, 225, 194, 0.10)");
  band(1, 5, "rgba(94, 225, 194, 0.18)");
  band(2, 4, "rgba(94, 225, 194, 0.30)");
  context.beginPath();
  for (let step = 0; step <= currentResult.timeSteps; step += 1) {
    const x = xFor(step);
    const y = yFor(transformedFanValue(step, 3));
    if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.strokeStyle = "#5ee1c2";
  context.lineWidth = 2;
  context.stroke();
  const selectedX = xFor(Number(stepSlider.value));
  context.strokeStyle = "#ffd166";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(selectedX, bounds.top);
  context.lineTo(selectedX, bounds.top + plotHeight);
  context.stroke();
  context.setLineDash([]);
  drawAxes(context, width, height, bounds, {
    yMax: formatNumber(maximum, 4), yMin: formatNumber(minimum, 4),
    xMin: "0", xMax: `${formatNumber(currentResult.times[currentResult.timeSteps], 4)}y`,
  });
}

function drawPathChart() {
  const canvas = document.querySelector("#path-chart");
  const { context, width, height } = canvasContext(canvas, 280);
  context.clearRect(0, 0, width, height);
  const bounds = { left: 58, right: 16, top: 18, bottom: 34 };
  const plotWidth = width - bounds.left - bounds.right;
  const plotHeight = height - bounds.top - bounds.bottom;
  const sampleCount = Math.min(24, currentResult.pathCount);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let path = 0; path < sampleCount; path += 1) {
    for (let step = 0; step <= currentResult.timeSteps; step += 1) {
      const level = currentResult.levels[step * currentResult.pathCount + path];
      const value = metricValue(level, metricSelect.value, currentResult.initialValue);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  if (maximum <= minimum) { minimum -= 0.5; maximum += 0.5; }
  const xFor = (step) => bounds.left + step / currentResult.timeSteps * plotWidth;
  const yFor = (value) => bounds.top + (maximum - value) / (maximum - minimum) * plotHeight;
  for (let path = 0; path < sampleCount; path += 1) {
    context.beginPath();
    for (let step = 0; step <= currentResult.timeSteps; step += 1) {
      const level = currentResult.levels[step * currentResult.pathCount + path];
      const x = xFor(step);
      const y = yFor(metricValue(level, metricSelect.value, currentResult.initialValue));
      if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = `hsla(${158 + path * 3}, 66%, 65%, 0.34)`;
    context.lineWidth = 1;
    context.stroke();
  }
  const selectedX = xFor(Number(stepSlider.value));
  context.strokeStyle = "#ffd166";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(selectedX, bounds.top);
  context.lineTo(selectedX, bounds.top + plotHeight);
  context.stroke();
  context.setLineDash([]);
  drawAxes(context, width, height, bounds, {
    yMax: formatNumber(maximum, 4), yMin: formatNumber(minimum, 4),
    xMin: "0", xMax: `${formatNumber(currentResult.times[currentResult.timeSteps], 4)}y`,
  });
}

function updateAnalysis() {
  if (!currentResult) return;
  const step = Number(stepSlider.value);
  const time = currentResult.times[step];
  const values = currentSlice();
  const summary = summarize(values);
  const q01 = quantile(summary.sorted, 0.01);
  const q05 = quantile(summary.sorted, 0.05);
  const median = quantile(summary.sorted, 0.5);
  const q95 = quantile(summary.sorted, 0.95);
  const q99 = quantile(summary.sorted, 0.99);
  const threshold = Number(thresholdInput.value);
  const probability = values.reduce((count, value) => count + (value <= threshold ? 1 : 0), 0) / values.length;

  document.querySelector("#analysis-title").textContent = `Distribution at t = ${time.toFixed(4)}`;
  document.querySelector("#time-label").textContent = `${time.toFixed(4)} years - step ${step}/${currentResult.timeSteps}`;
  document.querySelector("#stat-mean").textContent = formatNumber(summary.mean);
  document.querySelector("#stat-median").textContent = formatNumber(median);
  document.querySelector("#stat-std").textContent = formatNumber(summary.standardDeviation);
  document.querySelector("#stat-skew").textContent = formatNumber(summary.skewness, 4);
  document.querySelector("#stat-kurtosis").textContent = formatNumber(summary.kurtosis, 4);
  document.querySelector("#stat-tail").textContent = `${formatNumber(q01, 4)} / ${formatNumber(q99, 4)}`;
  document.querySelector("#stat-range").textContent = `${formatNumber(q05, 4)} / ${formatNumber(q95, 4)}`;
  document.querySelector("#probability-label").textContent = `P(X <= ${formatNumber(threshold, 4)})`;
  document.querySelector("#stat-probability").textContent = `${(100 * probability).toFixed(2)}%`;
  document.querySelector("#histogram-caption").textContent = `${currentResult.pathCount.toLocaleString()} observations of ${metricLabel(metricSelect.value)}.`;
  drawHistogram(values, summary);
  drawFanChart();
  drawPathChart();
}

function displayResult(result) {
  currentResult = result;
  stepSlider.max = String(result.timeSteps);
  stepSlider.value = String(result.timeSteps);
  document.querySelector("#maturity-label").textContent = `t = ${result.times[result.timeSteps].toFixed(4)}`;
  thresholdInput.value = metricSelect.value === "level" ? String(result.initialValue) : "0";
  const samplingLabel = samplingSelect.options[samplingSelect.selectedIndex].textContent.split(" - ")[0];
  const modelLabel = volatilityModel.options[volatilityModel.selectedIndex].textContent;
  document.querySelector("#run-caption").textContent =
    `${samplingLabel} - ${modelLabel} - ${result.pathCount.toLocaleString()} paths - ${result.elapsedMs.toFixed(1)} ms simulation time`;
  emptyState.hidden = true;
  analysis.hidden = false;
  statusBox.dataset.state = "ready";
  statusBox.textContent = `Ready - ${result.pathCount.toLocaleString()} paths across ${result.timeSteps} time steps`;
  updateAnalysis();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  try {
    const config = readConfig();
    currentRequest += 1;
    setBusy(true);
    clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => {
      setBusy(false);
      statusBox.dataset.state = "error";
      statusBox.textContent = "Simulation exceeded 60 seconds";
      errorBox.textContent = "Reduce the number of paths or time steps and try again.";
    }, 60000);
    worker.postMessage({ type: "simulate", requestId: currentRequest, config });
  } catch (error) {
    setBusy(false);
    errorBox.textContent = error.message;
  }
});

worker.addEventListener("message", (event) => {
  if (event.data?.requestId !== currentRequest) return;
  clearTimeout(timeoutHandle);
  setBusy(false);
  if (event.data.type === "error") {
    statusBox.dataset.state = "error";
    statusBox.textContent = "Simulation failed";
    errorBox.textContent = event.data.message;
    return;
  }
  displayResult(event.data.result);
});

worker.addEventListener("error", (event) => {
  clearTimeout(timeoutHandle);
  setBusy(false);
  statusBox.dataset.state = "error";
  statusBox.textContent = "Simulation worker failed to load";
  errorBox.textContent = event.message || "Reload this page from the local HTTP address.";
});

stepSlider.addEventListener("input", updateAnalysis);
metricSelect.addEventListener("change", () => {
  thresholdInput.value = metricSelect.value === "level" && currentResult ? String(currentResult.initialValue) : "0";
  updateAnalysis();
});
thresholdInput.addEventListener("input", updateAnalysis);
binsInput.addEventListener("change", updateAnalysis);
samplingSelect.addEventListener("change", updateVisibleFields);
volatilityModel.addEventListener("change", updateVisibleFields);
underlyingMode.addEventListener("change", updateVisibleFields);
assetCount.addEventListener("change", updateVisibleFields);

document.querySelector("#download-button").addEventListener("click", () => {
  if (!currentResult) return;
  const values = currentSlice();
  const step = Number(stepSlider.value);
  const lines = ["path,time,step,variable,value"];
  const variable = metricLabel(metricSelect.value).replaceAll(",", " ");
  for (let index = 0; index < values.length; index += 1) {
    lines.push(`${index + 1},${currentResult.times[step]},${step},${variable},${values[index]}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quantkiller-path-distribution-step-${step}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(updateAnalysis, 120);
});

updateVisibleFields();
setTimeout(() => form.requestSubmit(), 50);
