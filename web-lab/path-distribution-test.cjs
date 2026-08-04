"use strict";

const assert = require("node:assert/strict");
const Advanced = require("./web/advanced-pricer.js");

const base = {
  paths: 2048,
  timeSteps: 24,
  maturity: 1,
  seed: 314159,
  spot: 100,
  rate: 0.05,
  dividendYield: 0.01,
  volatility: 0.2,
  termVolatility: 0.3,
  localBeta: -0.25,
  hestonKappa: 2,
  hestonLongRunVol: 0.2,
  hestonVolOfVol: 0.4,
  hestonRho: -0.6,
  underlyingMode: "single",
  sampling: "mc",
};

function maximumDifference(first, second) {
  assert.equal(first.length, second.length);
  let maximum = 0;
  for (let index = 0; index < first.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(first[index] - second[index]));
  }
  return maximum;
}

function terminalMean(result) {
  const start = result.timeSteps * result.pathCount;
  let total = 0;
  for (let index = 0; index < result.pathCount; index += 1) total += result.levels[start + index];
  return total / result.pathCount;
}

const constant = Advanced.simulatePathDistribution({ ...base, volatilityModel: "constant" });
assert.equal(constant.levels.length, (base.timeSteps + 1) * base.paths);
assert.equal(constant.times.length, base.timeSteps + 1);
assert.equal(constant.times[0], 0);
assert.equal(constant.times[constant.timeSteps], base.maturity);
assert.ok(constant.levels.every(Number.isFinite));
assert.ok(constant.levels.every((value) => value > 0));
for (let path = 0; path < constant.pathCount; path += 1) assert.equal(constant.levels[path], base.spot);

const repeated = Advanced.simulatePathDistribution({ ...base, volatilityModel: "constant" });
assert.equal(maximumDifference(constant.levels, repeated.levels), 0, "PCG simulation must be seed-reproducible");

const sobol = Advanced.simulatePathDistribution({
  ...base, paths: 8192, sampling: "qmc", volatilityModel: "constant",
});
const expectedForwardMean = base.spot * Math.exp((base.rate - base.dividendYield) * base.maturity);
assert.ok(Math.abs(terminalMean(sobol) - expectedForwardMean) < 0.15, "Sobol terminal mean should match the risk-neutral forward mean");
const sobolOtherSeed = Advanced.simulatePathDistribution({
  ...base, paths: 8192, seed: 2718, sampling: "qmc", volatilityModel: "constant",
});
assert.equal(maximumDifference(sobol.levels, sobolOtherSeed.levels), 0, "Unrandomized Sobol must not depend on seed");

const randomizedOne = Advanced.simulatePathDistribution({
  ...base, sampling: "rqmc", volatilityModel: "constant", seed: 10,
});
const randomizedTwo = Advanced.simulatePathDistribution({
  ...base, sampling: "rqmc", volatilityModel: "constant", seed: 11,
});
assert.ok(maximumDifference(randomizedOne.levels, randomizedTwo.levels) > 0, "Randomized Sobol seeds must produce different shifts");

const termAsConstant = Advanced.simulatePathDistribution({
  ...base, volatilityModel: "term", termVolatility: base.volatility,
});
assert.equal(maximumDifference(constant.levels, termAsConstant.levels), 0, "Flat term volatility must reduce exactly to constant volatility");

const term = Advanced.simulatePathDistribution({ ...base, volatilityModel: "term" });
const localAsTerm = Advanced.simulatePathDistribution({
  ...base, volatilityModel: "local", localBeta: 0,
});
assert.equal(maximumDifference(term.levels, localAsTerm.levels), 0, "Zero local beta must reduce exactly to term volatility");

const hestonAsTerm = Advanced.simulatePathDistribution({
  ...base, volatilityModel: "heston", hestonVolOfVol: 0,
});
assert.equal(maximumDifference(term.levels, hestonAsTerm.levels), 0, "Zero Heston vol-of-vol must reduce exactly to term volatility");

const local = Advanced.simulatePathDistribution({ ...base, volatilityModel: "local" });
const slvAsLocal = Advanced.simulatePathDistribution({
  ...base, volatilityModel: "slv", hestonVolOfVol: 0,
});
assert.equal(maximumDifference(local.levels, slvAsLocal.levels), 0, "Zero SLV vol-of-vol must reduce exactly to local volatility");

const basket = Advanced.simulatePathDistribution({
  ...base,
  paths: 1024,
  sampling: "qmc",
  underlyingMode: "weighted-price",
  basketAssetCount: 3,
  basketWeights: [0.5, 0.3, 0.2],
  spot2: 200,
  spot3: 50,
  volatility2: 0.25,
  volatility3: 0.15,
  dividendYield2: 0.02,
  dividendYield3: 0,
  correlation: 0.3,
});
assert.equal(basket.initialValue, 120);
for (let path = 0; path < basket.pathCount; path += 1) assert.equal(basket.levels[path], 120);

assert.throws(() => Advanced.simulatePathDistribution({
  ...base, paths: 100000, timeSteps: 100,
}), /too large/i);

console.log(JSON.stringify({
  shape: { paths: constant.pathCount, timeSteps: constant.timeSteps, cells: constant.levels.length },
  qmcTerminalMean: terminalMean(sobol),
  expectedForwardMean,
  volatilityReductions: ["term->constant", "local->term", "heston->term", "slv->local"],
  basketInitialValue: basket.initialValue,
  passed: true,
}, null, 2));
