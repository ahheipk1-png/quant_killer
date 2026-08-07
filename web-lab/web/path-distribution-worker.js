"use strict";

importScripts("exotic-pricer.js?v=7", "advanced-pricer.js?v=6");

const QUANTILES = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99];

function quantile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = probability * (sorted.length - 1);
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[Math.min(lower + 1, sorted.length - 1)] * weight;
}

function quantileFan(result) {
  const fan = new Float32Array((result.timeSteps + 1) * QUANTILES.length);
  for (let step = 0; step <= result.timeSteps; step += 1) {
    const start = step * result.pathCount;
    const sorted = Array.from(result.levels.subarray(start, start + result.pathCount)).sort((a, b) => a - b);
    for (let index = 0; index < QUANTILES.length; index += 1) {
      fan[step * QUANTILES.length + index] = quantile(sorted, QUANTILES[index]);
    }
  }
  return fan;
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "simulate") return;
  const { requestId, config } = event.data;
  try {
    const result = AdvancedPricer.simulatePathDistribution(config);
    const fan = quantileFan(result);
    self.postMessage({
      type: "result",
      requestId,
      result: { ...result, fan, quantiles: QUANTILES },
    }, [result.levels.buffer, result.times.buffer, fan.buffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      message: error?.message || String(error),
    });
  }
});
