(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PolyglotContract = api;
}(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MAX_SCHEDULE = 260;
  const HEADER_SIZE = 64;
  const PRODUCT_CODES = {
    digital: 0, barrier: 1, "double-barrier": 2, bermudan: 3, rainbow: 4,
    autocallable: 5, himalayan: 6, lookback: 7, ladder: 8, compound: 9,
    asian: 10, "phoenix-autocall": 11, "variance-swap": 12,
    "volatility-swap": 13, "variance-option": 14, "volatility-option": 15,
    accumulator: 16, "yield-seeker": 17,
  };
  const VOLATILITY_CODES = { constant: 0, term: 1, local: 2, heston: 3, slv: 4 };
  const UNDERLYING_CODES = {
    single: 0, "weighted-price": 1, "order-performance": 2,
    "weighted-returns": 3, "return-of-weighted-sum": 4,
  };

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function schedule(config) {
    if (Array.isArray(config.observationTimes) && config.observationTimes.length) {
      return config.observationTimes.slice(0, MAX_SCHEDULE).map(Number);
    }
    let count = Math.trunc(number(config.monitoringSteps, 12));
    if (config.product === "bermudan") count = Math.trunc(number(config.exerciseDates, 4));
    if (config.product === "himalayan") {
      count = Math.min(Math.trunc(number(config.observations, 3)), Math.trunc(number(config.assetCount, 3)));
    }
    const horizon = config.product === "compound"
      ? number(config.decisionTime, 0.5)
      : number(config.maturity, 1);
    return Array.from({ length: Math.min(Math.max(count, 1), MAX_SCHEDULE) },
      (_, index) => horizon * (index + 1) / count);
  }

  function pack(config) {
    const values = new Float64Array(HEADER_SIZE + MAX_SCHEDULE);
    const rungs = Array.isArray(config.ladderRungs) ? config.ladderRungs : [110, 120, 130];
    const weights = Array.isArray(config.basketWeights) ? config.basketWeights : [0.5, 0.3, 0.2];
    const times = schedule(config);
    values[0] = PRODUCT_CODES[config.product];
    values[1] = VOLATILITY_CODES[config.volatilityModel || "constant"];
    values[2] = number(config.spot, 100);
    values[3] = number(config.strike, 100);
    values[4] = number(config.rate, 0.05);
    values[5] = number(config.dividendYield, 0);
    values[6] = number(config.volatility, 0.2);
    values[7] = number(config.termVolatility, values[6]);
    values[8] = number(config.localBeta, -0.25);
    values[9] = number(config.hestonKappa, 2);
    values[10] = number(config.hestonLongRunVol, values[6]);
    values[11] = number(config.hestonVolOfVol, 0.4);
    values[12] = number(config.hestonRho, -0.6);
    values[13] = number(config.maturity, 1);
    values[14] = config.optionType === "put" ? 0 : 1;
    values[15] = times.length;
    values[16] = number(config.cashPayoff, 10);
    values[17] = number(config.barrier, 125);
    values[18] = config.barrierDirection === "down" ? 0 : 1;
    values[19] = config.barrierStyle === "in" ? 1 : 0;
    values[20] = number(config.lowerBarrier, 70);
    values[21] = number(config.upperBarrier, 130);
    values[22] = number(config.spot2, 100);
    values[23] = number(config.volatility2, 0.25);
    values[24] = number(config.dividendYield2, 0);
    values[25] = number(config.spot3, 100);
    values[26] = number(config.volatility3, 0.3);
    values[27] = number(config.dividendYield3, 0);
    values[28] = number(config.correlation, 0.5);
    values[29] = config.rainbowStyle === "worst" ? 0 : 1;
    values[30] = number(config.notional, 100);
    values[31] = number(config.coupon, 0.02);
    values[32] = number(config.autocallBarrier, 1);
    values[33] = number(config.protectionBarrier, 0.7);
    values[34] = number(config.observations, 3);
    values[35] = number(config.assetCount, 3);
    values[36] = number(config.returnStrike, 0);
    values[37] = number(rungs[0], 0);
    values[38] = number(rungs[1], 0);
    values[39] = number(rungs[2], 0);
    values[40] = Math.min(rungs.length, 3);
    values[41] = number(config.decisionTime, 0.5);
    values[42] = number(config.compoundStrike, 5);
    values[43] = config.compoundOuterType === "put" ? 0 : 1;
    values[44] = config.compoundInnerType === "put" ? 0 : 1;
    values[45] = number(config.couponBarrier, 0.7);
    values[46] = config.memoryCoupon === false ? 0 : 1;
    values[47] = number(config.varianceStrike, 0.04);
    values[48] = number(config.volatilityStrike, 0.2);
    values[49] = number(config.varianceNotional, 1000);
    values[50] = number(config.annualization, 1);
    values[51] = number(config.accumulatorQuantity, 1);
    values[52] = number(config.accumulatorGearing, 2);
    values[53] = number(config.accumulatorKnockOut, 1.1);
    values[54] = config.includeInitialFixing ? 1 : 0;
    values[55] = UNDERLYING_CODES[config.underlyingMode || "single"];
    values[56] = number(config.basketAssetCount, 3);
    values[57] = number(config.basketOrder, 1);
    values[58] = number(weights[0], 0.5);
    values[59] = number(weights[1], 0.3);
    values[60] = number(weights[2], 0.2);
    times.forEach((time, index) => { values[HEADER_SIZE + index] = time; });
    return values;
  }

  return { MAX_SCHEDULE, HEADER_SIZE, PRODUCT_CODES, VOLATILITY_CODES, UNDERLYING_CODES, schedule, pack };
}));
