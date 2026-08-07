(function (root, factory) {
  const base = typeof module === "object" && module.exports
    ? require("./exotic-pricer.js")
    : root.ExoticPricer;
  const api = factory(base);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AdvancedPricer = api;
}(typeof self !== "undefined" ? self : globalThis, function (Base) {
  "use strict";

  if (!Base) throw new Error("AdvancedPricer requires ExoticPricer.");

  const UINT_SCALE = 4294967296.0;
  const VOLATILITY_MODELS = Object.freeze({
    constant: "Constant volatility",
    term: "Term volatility",
    local: "Local volatility",
    heston: "Heston stochastic volatility",
    slv: "Stochastic local volatility",
  });

  const PRODUCT_CODES = Object.freeze({
    digital: 0,
    barrier: 1,
    "double-barrier": 2,
    bermudan: 3,
    rainbow: 4,
    autocallable: 5,
    himalayan: 6,
    lookback: 7,
    ladder: 8,
    compound: 9,
    asian: 10,
    "phoenix-autocall": 11,
    "variance-swap": 12,
    "volatility-swap": 13,
    "variance-option": 14,
    "volatility-option": 15,
    accumulator: 16,
    "yield-seeker": 17,
  });

  const VOLATILITY_CODES = Object.freeze({ constant: 0, term: 1, local: 2, heston: 3, slv: 4 });

  const ADVANCED_PRODUCT_METHODS = Object.freeze({
    asian: ["levy", "shifted-lognormal", "curran", "curran-two-moment", "ju-taylor", "adi", "mc", "qmc"],
    "phoenix-autocall": ["mc", "qmc"],
    "variance-swap": ["static-replication", "mc", "qmc"],
    "volatility-swap": ["mc", "qmc"],
    "variance-option": ["mc", "qmc"],
    "volatility-option": ["mc", "qmc"],
    accumulator: ["mc", "qmc"],
    "yield-seeker": ["mc", "qmc"],
  });

  const PRODUCT_METHODS = Object.freeze({
    ...Base.PRODUCT_METHODS,
    ...ADVANCED_PRODUCT_METHODS,
  });

  const PRODUCT_DESCRIPTIONS = Object.freeze({
    ...Base.PRODUCT_DESCRIPTIONS,
    compound: "Call or put on an underlying call or put; all four compound combinations are supported.",
    asian: "Discrete fixed-strike arithmetic-average call or put on an explicit, possibly uneven observation schedule.",
    "phoenix-autocall": "Phoenix note with conditional coupons, optional memory, autocall observations, and protected or downside-linked redemption.",
    "variance-swap": "Discounted notional times annualized realized variance minus the variance strike.",
    "volatility-swap": "Discounted notional times realized volatility minus the volatility strike.",
    "variance-option": "Call or put on annualized realized variance.",
    "volatility-option": "Call or put on annualized realized volatility.",
    accumulator: "Scheduled accumulation of the underlying at a strike, with downside gearing and an upper knock-out.",
    "yield-seeker": "High-coupon barrier note with conditional coupons and downside-linked maturity redemption, without an autocall.",
  });

  const ADVANCED_PAYOFF_DEFINITIONS = Object.freeze({
    asian: {
      label: "Discrete arithmetic Asian",
      formula: "max(phi * (mean(S at fixing dates) - K), 0)",
      description: "The arithmetic mean uses the explicit uneven fixing schedule and can optionally include the initial spot.",
    },
    "phoenix-autocall": {
      label: "Phoenix autocall",
      formula: "conditional coupons + scheduled autocall principal; otherwise protected/downside redemption",
      description: "Memory coupons accumulate missed coupons until a later coupon barrier is met.",
    },
    "yield-seeker": {
      label: "Yield seeker",
      formula: "conditional coupons + protected/downside maturity redemption; no autocall",
      description: "This lab defines yield seeker as the non-callable high-coupon barrier-note counterpart of Phoenix.",
    },
    "variance-swap": {
      label: "Variance swap",
      formula: "Nvar * (annualized sum(log return^2) / elapsed - Kvar)",
      description: "Realized variance is computed from the supplied discrete return observations.",
    },
    "volatility-swap": {
      label: "Volatility swap",
      formula: "Nvol * (sqrt(realized variance) - Kvol)",
      description: "The volatility leg is the square root of the same annualized realized variance statistic.",
    },
    "variance-option": {
      label: "Option on variance",
      formula: "N * max(phi * (realized variance - Kvar), 0)",
      description: "The payoff is floored at zero after applying the call or put direction.",
    },
    "volatility-option": {
      label: "Option on volatility",
      formula: "N * max(phi * (sqrt(realized variance) - Kvol), 0)",
      description: "The option is written on realized volatility rather than variance.",
    },
    accumulator: {
      label: "Accumulator",
      formula: "sum(q_i * (S_i - K)); q_i is geared below K; stop at upper knock-out",
      description: "Each fixing settles independently until the first upper knock-out observation.",
    },
    "basket-underlying": {
      label: "Effective basket underlying",
      formula: "weighted prices, weighted returns, return of weighted prices, or ranked performance",
      description: "The constructed series becomes the underlying path supplied to compatible payoff functions.",
    },
  });

  class Pcg32 {
    constructor(seed = 42, sequence = 1) {
      this.state = 0n;
      this.increment = ((BigInt(sequence) << 1n) | 1n) & ((1n << 64n) - 1n);
      this.nextU32();
      this.state = (this.state + BigInt(seed >>> 0)) & ((1n << 64n) - 1n);
      this.nextU32();
    }

    nextU32() {
      const old = this.state;
      this.state = (old * 6364136223846793005n + this.increment) & ((1n << 64n) - 1n);
      const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn) >>> 0;
      const rotation = Number((old >> 59n) & 31n);
      return ((xorshifted >>> rotation) |
        (xorshifted << ((32 - rotation) & 31))) >>> 0;
    }

    uniform() {
      return (this.nextU32() + 0.5) / UINT_SCALE;
    }
  }

  function normalizeConfig(input) {
    const config = {
      ...Base.normalizeConfig(input),
      volatilityModel: input.volatilityModel || "constant",
      termVolatility: Number(input.termVolatility ?? input.volatility ?? 0.2),
      localBeta: Number(input.localBeta ?? -0.25),
      hestonKappa: Number(input.hestonKappa ?? 2.0),
      hestonLongRunVol: Number(input.hestonLongRunVol ?? input.volatility ?? 0.2),
      hestonVolOfVol: Number(input.hestonVolOfVol ?? 0.4),
      hestonRho: Number(input.hestonRho ?? -0.6),
      observationTimes: Array.isArray(input.observationTimes)
        ? input.observationTimes.map(Number)
        : String(input.observationTimes ?? "").split(",").map((value) => value.trim())
          .filter(Boolean).map(Number).filter(Number.isFinite),
      includeInitialFixing: Boolean(input.includeInitialFixing),
      compoundOuterType: input.compoundOuterType || "call",
      compoundInnerType: input.compoundInnerType || "call",
      couponBarrier: Number(input.couponBarrier ?? 0.7),
      memoryCoupon: input.memoryCoupon === undefined ? true : Boolean(input.memoryCoupon),
      varianceStrike: Number(input.varianceStrike ?? 0.04),
      volatilityStrike: Number(input.volatilityStrike ?? 0.2),
      varianceNotional: Number(input.varianceNotional ?? 1000),
      annualization: Number(input.annualization ?? 1.0),
      accumulatorQuantity: Number(input.accumulatorQuantity ?? 1.0),
      accumulatorGearing: Number(input.accumulatorGearing ?? 2.0),
      accumulatorKnockOut: Number(input.accumulatorKnockOut ?? 1.1),
      pdeSpotGrid: Math.trunc(Number(input.pdeSpotGrid ?? 72)),
      pdeAverageGrid: Math.trunc(Number(input.pdeAverageGrid ?? 72)),
      pdeTimeSteps: Math.trunc(Number(input.pdeTimeSteps ?? 220)),
      underlyingMode: input.underlyingMode || "single",
      basketAssetCount: Math.trunc(Number(input.basketAssetCount ?? 3)),
      basketWeights: Array.isArray(input.basketWeights)
        ? input.basketWeights.map(Number)
        : String(input.basketWeights ?? "0.5,0.3,0.2").split(",").map((value) => Number(value.trim())),
      basketOrder: Math.trunc(Number(input.basketOrder ?? 1)),
    };
    if (!Object.hasOwn(VOLATILITY_MODELS, config.volatilityModel)) {
      throw new Error("Unknown volatility model.");
    }
    if (!(config.termVolatility > 0 && config.hestonLongRunVol > 0)) {
      throw new Error("Term and Heston long-run volatility must be positive.");
    }
    if (config.hestonKappa < 0 || config.hestonVolOfVol < 0 || Math.abs(config.hestonRho) > 1) {
      throw new Error("Invalid Heston parameters.");
    }
    if (config.observationTimes.some((time, index, times) =>
      time <= 0 || time > config.maturity + 1e-12 || (index > 0 && time <= times[index - 1]))) {
      throw new Error("Observation times must be strictly increasing and lie inside maturity.");
    }
    return config;
  }

  function equalSchedule(count, horizon) {
    return Array.from({ length: Math.max(1, count) }, (_, index) => horizon * (index + 1) / count);
  }

  function scheduleFor(config, horizon = config.maturity) {
    if (config.observationTimes.length) {
      const filtered = config.observationTimes.filter((time) => time <= horizon + 1e-12);
      if (filtered.length && Math.abs(filtered[filtered.length - 1] - horizon) <= 1e-10) return filtered;
      if (filtered.length && horizon < config.maturity - 1e-12) return [...filtered, horizon];
      return filtered.length ? filtered : [horizon];
    }
    let count = config.monitoringSteps;
    if (config.product === "bermudan") count = config.exerciseDates;
    if (config.product === "himalayan") count = Math.min(config.observations, config.assetCount);
    return equalSchedule(count, horizon);
  }

  function termVolatility(config, baseVolatility, time) {
    const ratio = config.termVolatility / config.volatility;
    const ending = baseVolatility * ratio;
    const weight = Math.min(Math.max(time / config.maturity, 0.0), 1.0);
    return baseVolatility + (ending - baseVolatility) * weight;
  }

  function leverage(spot, initialSpot, beta) {
    const ratio = Math.max(spot / initialSpot, 1e-8);
    return Math.min(Math.max(Math.exp(beta * Math.log(ratio)), 0.2), 5.0);
  }

  function assetCountFor(config) {
    if (config.product === "rainbow" || config.product === "himalayan") return config.assetCount;
    if (config.underlyingMode !== "single") return config.basketAssetCount;
    return 1;
  }

  function normalizedWeights(config, count) {
    const values = Array.from({ length: count }, (_, index) => Number(config.basketWeights[index] ?? 0));
    const total = values.reduce((sum, value) => sum + value, 0.0);
    if (Math.abs(total) < 1e-14) return values.map(() => 1.0 / count);
    return values.map((value) => value / total);
  }

  function effectiveUnderlying(config, paths) {
    if (config.underlyingMode === "single" || paths.length === 1) return paths[0];
    const count = paths.length;
    const weights = normalizedWeights(config, count);
    const initial = [config.spot, config.spot2, config.spot3].slice(0, count);
    const values = new Float64Array(paths[0].length);
    const initialWeightedPrice = initial.reduce((sum, value, index) => sum + weights[index] * value, 0.0);
    for (let step = 0; step < values.length; step += 1) {
      if (config.underlyingMode === "weighted-price") {
        values[step] = paths.reduce((sum, path, index) => sum + weights[index] * path[step], 0.0);
      } else if (config.underlyingMode === "weighted-returns") {
        const performance = paths.reduce((sum, path, index) =>
          sum + weights[index] * path[step] / initial[index], 0.0);
        values[step] = config.spot * performance;
      } else if (config.underlyingMode === "return-of-weighted-sum") {
        const weightedPrice = paths.reduce((sum, path, index) => sum + weights[index] * path[step], 0.0);
        values[step] = config.spot * weightedPrice / initialWeightedPrice;
      } else if (config.underlyingMode === "order-performance") {
        const performances = paths.map((path, index) => path[step] / initial[index])
          .sort((first, second) => second - first);
        const rank = Math.min(Math.max(config.basketOrder, 1), performances.length) - 1;
        values[step] = config.spot * performances[rank];
      } else {
        values[step] = paths[0][step];
      }
    }
    return values;
  }

  function qmcNormal(pathIndex, dimension, shift) {
    return Base.inverseNormalCdf(Base.sobolUniform(pathIndex + 1, dimension, shift));
  }

  function drawIndependentNormals(count, source, pathIndex, offset, rng, shifts) {
    const values = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      values[index] = source === "qmc"
        ? qmcNormal(pathIndex, offset + index, shifts[offset + index])
        : Base.inverseNormalCdf(rng.uniform());
    }
    return values;
  }

  // General equicorrelated Cholesky (arbitrary asset count) -- for count<=3
  // this reproduces the previous hand-unrolled 1/2/3-asset formulas exactly,
  // since both factorize the same constant off-diagonal correlation matrix.
  function correlateAssets(independent, correlation) {
    const count = independent.length;
    if (count === 1) return independent;
    const lower = Array.from({ length: count }, () => new Float64Array(count));
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column <= row; column += 1) {
        let value = row === column ? 1.0 : correlation;
        for (let offset = 0; offset < column; offset += 1) value -= lower[row][offset] * lower[column][offset];
        lower[row][column] = row === column
          ? Math.sqrt(Math.max(value, 0.0))
          : value / lower[column][column];
      }
    }
    const correlated = new Float64Array(count);
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column <= row; column += 1) correlated[row] += lower[row][column] * independent[column];
    }
    return correlated;
  }

  function simulatePath(config, schedule, source, pathIndex, rng, shifts) {
    const assets = assetCountFor(config);
    // Rainbow/himalayan (arbitrary N) read the assetSpots/Volatilities/
    // DividendYields arrays; other basket products stay on the fixed
    // spot2/spot3 fallback Base.normalizeConfig fills those arrays with.
    const initialSpots = [config.spot, ...config.assetSpots].slice(0, assets);
    const baseVols = [config.volatility, ...config.assetVolatilities].slice(0, assets);
    const dividends = [config.dividendYield, ...config.assetDividendYields].slice(0, assets);
    const spots = initialSpots.slice();
    const variances = baseVols.map((value) => value * value);
    const paths = Array.from({ length: assets }, () => new Float64Array(schedule.length));
    const logReturns = new Float64Array(schedule.length);
    let previousTime = 0.0;
    for (let step = 0; step < schedule.length; step += 1) {
      const time = schedule[step];
      const dt = time - previousTime;
      const rootDt = Math.sqrt(dt);
      const offset = step * assets * 2;
      const independentSpot = drawIndependentNormals(assets, source, pathIndex, offset, rng, shifts);
      const independentVariance = drawIndependentNormals(assets, source, pathIndex, offset + assets, rng, shifts);
      const spotNormals = correlateAssets(independentSpot, config.correlation);
      const previousPrimary = spots[0];
      for (let asset = 0; asset < assets; asset += 1) {
        const midTime = previousTime + 0.5 * dt;
        const deterministicVol = termVolatility(config, baseVols[asset], midTime);
        const stochastic = config.volatilityModel === "heston" || config.volatilityModel === "slv";
        if (stochastic && config.hestonVolOfVol <= 1e-14) {
          variances[asset] = deterministicVol * deterministicVol;
        }
        const variance = Math.max(variances[asset], 0.0);
        let instantaneous;
        if (config.volatilityModel === "constant") instantaneous = baseVols[asset];
        else if (config.volatilityModel === "term") instantaneous = deterministicVol;
        else if (config.volatilityModel === "local") {
          instantaneous = deterministicVol * leverage(spots[asset], initialSpots[asset], config.localBeta);
        } else {
          instantaneous = Math.sqrt(variance);
          if (config.volatilityModel === "slv") {
            instantaneous *= leverage(spots[asset], initialSpots[asset], config.localBeta);
          }
        }
        spots[asset] *= Math.exp(
          (config.rate - dividends[asset] - 0.5 * instantaneous * instantaneous) * dt +
          instantaneous * rootDt * spotNormals[asset],
        );
        paths[asset][step] = spots[asset];
        if (stochastic && config.hestonVolOfVol > 1e-14) {
          const varianceNormal = config.hestonRho * spotNormals[asset] +
            Math.sqrt(Math.max(1.0 - config.hestonRho ** 2, 0.0)) * independentVariance[asset];
          const scale = baseVols[asset] / config.volatility;
          const theta = (config.hestonLongRunVol * scale) ** 2;
          variances[asset] = Math.max(
            variance + config.hestonKappa * (theta - variance) * dt +
            config.hestonVolOfVol * Math.sqrt(variance) * rootDt * varianceNormal,
            0.0,
          );
        }
      }
      logReturns[step] = Math.log(spots[0] / previousPrimary);
      previousTime = time;
    }
    const underlying = effectiveUnderlying(config, paths);
    let previousUnderlying = config.underlyingMode === "weighted-price"
      ? initialSpots.reduce((sum, value, index) =>
        sum + normalizedWeights(config, assets)[index] * value, 0.0)
      : config.spot;
    for (let step = 0; step < schedule.length; step += 1) {
      logReturns[step] = Math.log(underlying[step] / previousUnderlying);
      previousUnderlying = underlying[step];
    }
    return { paths, underlying, logReturns };
  }

  function phoenixPresentValue(config, path, schedule, allowAutocall) {
    let presentValue = 0.0;
    let missedCoupons = 0;
    for (let index = 0; index < path.length; index += 1) {
      const aboveCoupon = path[index] >= config.couponBarrier * config.spot;
      if (aboveCoupon) {
        const couponCount = config.memoryCoupon ? missedCoupons + 1 : 1;
        presentValue += Math.exp(-config.rate * schedule[index]) *
          config.notional * config.coupon * couponCount;
        missedCoupons = 0;
      } else if (config.memoryCoupon) {
        missedCoupons += 1;
      }
      if (allowAutocall && path[index] >= config.autocallBarrier * config.spot) {
        return presentValue + Math.exp(-config.rate * schedule[index]) * config.notional;
      }
    }
    const terminal = path[path.length - 1];
    const redemption = terminal >= config.protectionBarrier * config.spot
      ? config.notional
      : config.notional * terminal / config.spot;
    return presentValue + Math.exp(-config.rate * config.maturity) * redemption;
  }

  function realizedVariance(config, logReturns, schedule) {
    const elapsed = schedule[schedule.length - 1];
    const sumSquares = logReturns.reduce((sum, value) => sum + value * value, 0.0);
    return config.annualization * sumSquares / elapsed;
  }

  function compoundPathPresentValue(config, decisionSpot) {
    const remaining = config.maturity - config.decisionTime;
    let effectiveVol = config.volatilityModel === "constant"
      ? config.volatility
      : termVolatility(config, config.volatility, config.decisionTime);
    if (config.volatilityModel === "local" || config.volatilityModel === "slv") {
      effectiveVol *= leverage(decisionSpot, config.spot, config.localBeta);
    }
    const underlyingValue = Base.blackScholes({
      ...config,
      spot: decisionSpot,
      volatility: effectiveVol,
      maturity: remaining,
      optionType: config.compoundInnerType,
    });
    return Math.exp(-config.rate * config.decisionTime) *
      Base.compoundPayoff(underlyingValue, config.compoundStrike, config.compoundOuterType);
  }

  function pathPresentValue(config, simulation, schedule) {
    const primary = simulation.underlying;
    const terminal = primary[primary.length - 1];
    const discount = Math.exp(-config.rate * config.maturity);
    if (config.product === "digital") {
      return discount * Base.digitalPayoff(terminal, config.strike, config.optionType, config.cashPayoff);
    }
    if (config.product === "barrier") {
      const hit = primary.some((value) => config.barrierDirection === "up"
        ? value >= config.barrier : value <= config.barrier);
      return discount * Base.singleBarrierPayoff(
        terminal, config.strike, config.optionType, hit ? 0 : 1, config.barrierStyle,
      );
    }
    if (config.product === "double-barrier") {
      const hit = primary.some((value) => value <= config.lowerBarrier || value >= config.upperBarrier);
      return discount * Base.doubleBarrierPayoff(
        terminal, config.strike, config.optionType, hit ? 0 : 1, config.barrierStyle,
      );
    }
    if (config.product === "rainbow") {
      const terminals = simulation.paths.map((path) => path[schedule.length - 1]);
      return discount * Base.rainbowPayoff(terminals, config.strike, config.optionType, config.rainbowStyle);
    }
    if (config.product === "autocallable") {
      const redemption = Base.autocallablePayoff(primary, {
        initialSpot: config.spot, notional: config.notional, coupon: config.coupon,
        autocallBarrier: config.autocallBarrier, protectionBarrier: config.protectionBarrier,
        maturity: config.maturity,
      });
      return Math.exp(-config.rate * redemption.time) * redemption.amount;
    }
    if (config.product === "phoenix-autocall") return phoenixPresentValue(config, primary, schedule, true);
    if (config.product === "yield-seeker") return phoenixPresentValue(config, primary, schedule, false);
    if (config.product === "himalayan") {
      const initialSpots = [config.spot, ...config.assetSpots].slice(0, config.assetCount);
      const active = new Set(Array.from({ length: config.assetCount }, (_, index) => index));
      const selected = [];
      for (let step = 0; step < schedule.length; step += 1) {
        let bestAsset = -1;
        let bestReturn = -Infinity;
        for (const asset of active) {
          const previous = step === 0 ? initialSpots[asset]
            : simulation.paths[asset][step - 1];
          const intervalReturn = simulation.paths[asset][step] / previous - 1.0;
          if (intervalReturn > bestReturn) {
            bestReturn = intervalReturn;
            bestAsset = asset;
          }
        }
        selected.push(bestReturn);
        active.delete(bestAsset);
      }
      return discount * Base.himalayanPayoff(selected, config.notional, config.returnStrike);
    }
    if (config.product === "lookback") {
      return discount * Base.lookbackPayoff(primary, config.strike, config.optionType);
    }
    if (config.product === "ladder") {
      return discount * Base.ladderPayoff(primary, config.strike, config.optionType, config.ladderRungs);
    }
    if (config.product === "compound") return compoundPathPresentValue(config, terminal);
    if (config.product === "asian") {
      const values = config.includeInitialFixing ? [config.spot, ...primary] : Array.from(primary);
      const average = values.reduce((sum, value) => sum + value, 0.0) / values.length;
      return discount * Base.vanillaPayoff(average, config.strike, config.optionType);
    }
    if (["variance-swap", "volatility-swap", "variance-option", "volatility-option"].includes(config.product)) {
      const variance = realizedVariance(config, simulation.logReturns, schedule);
      if (config.product === "variance-swap") {
        return discount * config.varianceNotional * (variance - config.varianceStrike);
      }
      const volatility = Math.sqrt(Math.max(variance, 0.0));
      if (config.product === "volatility-swap") {
        return discount * config.varianceNotional * (volatility - config.volatilityStrike);
      }
      const underlying = config.product === "variance-option" ? variance : volatility;
      const strike = config.product === "variance-option" ? config.varianceStrike : config.volatilityStrike;
      return discount * config.varianceNotional * Base.vanillaPayoff(underlying, strike, config.optionType);
    }
    if (config.product === "accumulator") {
      let presentValue = 0.0;
      for (let index = 0; index < primary.length; index += 1) {
        if (primary[index] >= config.accumulatorKnockOut * config.spot) break;
        const quantity = primary[index] < config.strike
          ? config.accumulatorQuantity * config.accumulatorGearing
          : config.accumulatorQuantity;
        presentValue += Math.exp(-config.rate * schedule[index]) *
          quantity * (primary[index] - config.strike);
      }
      return presentValue;
    }
    throw new Error(`Advanced Monte Carlo is not configured for ${config.product}.`);
  }

  function solveThreeByThree(matrix, vector) {
    const a = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < 3; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < 3; row += 1) {
        if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
      }
      [a[column], a[pivot]] = [a[pivot], a[column]];
      if (Math.abs(a[column][column]) < 1e-12) return [0, 0, 0];
      const scale = a[column][column];
      for (let item = column; item < 4; item += 1) a[column][item] /= scale;
      for (let row = 0; row < 3; row += 1) {
        if (row === column) continue;
        const factor = a[row][column];
        for (let item = column; item < 4; item += 1) a[row][item] -= factor * a[column][item];
      }
    }
    return a.map((row) => row[3]);
  }

  function summarize(samples, source) {
    const mean = samples.reduce((sum, value) => sum + value, 0.0) / samples.length;
    const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0.0) /
      Math.max(samples.length - 1, 1);
    const standardDeviation = Math.sqrt(Math.max(variance, 0.0));
    return {
      price: mean,
      standardDeviation,
      standardError: source === "qmc" ? null : standardDeviation / Math.sqrt(samples.length),
      samples: samples.length,
    };
  }

  function bermudanLsm(config, source, schedule, rng, shifts) {
    const paths = Array.from({ length: config.paths }, () => new Float64Array(schedule.length));
    for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
      paths[pathIndex] = simulatePath(config, schedule, source, pathIndex, rng, shifts).underlying;
    }
    const cashflow = new Float64Array(config.paths);
    const exerciseTime = new Float64Array(config.paths);
    const last = schedule.length - 1;
    for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
      cashflow[pathIndex] = Base.bermudanExercisePayoff(
        paths[pathIndex][last], config.strike, config.optionType,
      );
      exerciseTime[pathIndex] = schedule[last];
    }
    for (let dateIndex = last - 1; dateIndex >= 0; dateIndex -= 1) {
      const time = schedule[dateIndex];
      const rows = [];
      for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
        const spot = paths[pathIndex][dateIndex];
        const intrinsic = Base.bermudanExercisePayoff(spot, config.strike, config.optionType);
        if (intrinsic > 0) {
          rows.push({
            pathIndex, intrinsic, x: spot / config.strike,
            y: cashflow[pathIndex] * Math.exp(-config.rate * (exerciseTime[pathIndex] - time)),
          });
        }
      }
      const sums = [0, 0, 0, 0, 0];
      const targets = [0, 0, 0];
      for (const row of rows) {
        const powers = [1, row.x, row.x ** 2, row.x ** 3, row.x ** 4];
        for (let index = 0; index < 5; index += 1) sums[index] += powers[index];
        targets[0] += row.y;
        targets[1] += row.x * row.y;
        targets[2] += row.x * row.x * row.y;
      }
      const coefficients = solveThreeByThree([
        [sums[0], sums[1], sums[2]],
        [sums[1], sums[2], sums[3]],
        [sums[2], sums[3], sums[4]],
      ], targets);
      for (const row of rows) {
        const continuation = coefficients[0] + coefficients[1] * row.x + coefficients[2] * row.x ** 2;
        if (row.intrinsic > continuation) {
          cashflow[row.pathIndex] = row.intrinsic;
          exerciseTime[row.pathIndex] = time;
        }
      }
    }
    const presentValues = new Float64Array(config.paths);
    for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
      presentValues[pathIndex] = cashflow[pathIndex] * Math.exp(-config.rate * exerciseTime[pathIndex]);
    }
    return summarize(presentValues, source);
  }

  function monteCarloPrice(config, source) {
    const horizon = config.product === "compound" ? config.decisionTime : config.maturity;
    const schedule = scheduleFor(config, horizon);
    const dimensions = schedule.length * assetCountFor(config) * 2;
    const rng = new Pcg32(config.seed);
    const shifts = new Uint32Array(dimensions);
    if (source === "qmc" && config.randomizedQmc) {
      for (let dimension = 0; dimension < dimensions; dimension += 1) shifts[dimension] = rng.nextU32();
    }
    if (config.product === "bermudan") return bermudanLsm(config, source, schedule, rng, shifts);
    const samples = new Float64Array(config.paths);
    for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
      const simulation = simulatePath(config, schedule, source, pathIndex, rng, shifts);
      samples[pathIndex] = pathPresentValue(config, simulation, schedule);
    }
    return summarize(samples, source);
  }

  function simulatePathDistribution(input = {}) {
    const pathCount = Math.trunc(Number(input.paths ?? 10000));
    const timeSteps = Math.trunc(Number(input.timeSteps ?? input.monitoringSteps ?? 100));
    if (!Number.isInteger(pathCount) || pathCount < 100 || pathCount > 100000) {
      throw new Error("Path count must be an integer from 100 to 100,000.");
    }
    if (!Number.isInteger(timeSteps) || timeSteps < 1 || timeSteps > 520) {
      throw new Error("Time steps must be an integer from 1 to 520.");
    }
    if (pathCount * (timeSteps + 1) > 8000000) {
      throw new Error("This run is too large for an interactive distribution session. Keep paths x time steps at or below 8,000,000.");
    }

    const requestedSampling = input.sampling || "mc";
    if (!["mc", "qmc", "rqmc"].includes(requestedSampling)) {
      throw new Error("Sampling must be mc, qmc, or rqmc.");
    }
    const series = input.series || "underlying";
    if (!["underlying", "asset-1", "asset-2", "asset-3"].includes(series)) {
      throw new Error("Unknown path series.");
    }

    const config = normalizeConfig({
      ...input,
      product: "digital",
      paths: pathCount,
      // Base.normalizeConfig retains the original exotic-lab UI bound of 16.
      // The independent path lab constructs and validates its own larger grid.
      monitoringSteps: Math.min(timeSteps, 16),
      observationTimes: [],
      randomizedQmc: requestedSampling === "rqmc",
    });
    const schedule = equalSchedule(timeSteps, config.maturity);
    const assets = assetCountFor(config);
    const selectedAsset = series.startsWith("asset-") ? Number(series.slice(6)) - 1 : -1;
    if (selectedAsset >= assets) {
      throw new Error(`The selected series requires at least ${selectedAsset + 1} basket assets.`);
    }

    const source = requestedSampling === "mc" ? "mc" : "qmc";
    const dimensions = schedule.length * assets * 2;
    const rng = new Pcg32(config.seed);
    const shifts = new Uint32Array(dimensions);
    if (requestedSampling === "rqmc") {
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        shifts[dimension] = rng.nextU32();
      }
    }

    const initialSpots = [config.spot, config.spot2, config.spot3].slice(0, assets);
    let initialValue;
    if (selectedAsset >= 0) {
      initialValue = initialSpots[selectedAsset];
    } else if (config.underlyingMode === "weighted-price") {
      const weights = normalizedWeights(config, assets);
      initialValue = initialSpots.reduce((sum, value, index) => sum + weights[index] * value, 0.0);
    } else {
      initialValue = config.spot;
    }

    const levels = new Float32Array((timeSteps + 1) * pathCount);
    levels.subarray(0, pathCount).fill(initialValue);
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const simulation = simulatePath(config, schedule, source, pathIndex, rng, shifts);
      const selectedPath = selectedAsset >= 0 ? simulation.paths[selectedAsset] : simulation.underlying;
      for (let step = 0; step < timeSteps; step += 1) {
        levels[(step + 1) * pathCount + pathIndex] = selectedPath[step];
      }
    }
    const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      levels,
      times: Float64Array.from([0, ...schedule]),
      pathCount,
      timeSteps,
      initialValue,
      elapsedMs: ended - started,
      sampling: requestedSampling,
      series,
      volatilityModel: config.volatilityModel,
      underlyingMode: config.underlyingMode,
    };
  }

  function asianMoments(config) {
    const schedule = scheduleFor(config);
    const times = config.includeInitialFixing ? [0, ...schedule] : schedule;
    const weight = 1.0 / times.length;
    const drift = config.rate - config.dividendYield;
    let first = 0.0;
    let second = 0.0;
    let third = 0.0;
    for (const firstTime of times) {
      first += weight * config.spot * Math.exp(drift * firstTime);
      for (const secondTime of times) {
        second += weight * weight * config.spot ** 2 * Math.exp(
          drift * (firstTime + secondTime) + config.volatility ** 2 * Math.min(firstTime, secondTime),
        );
        for (const thirdTime of times) {
          third += weight ** 3 * config.spot ** 3 * Math.exp(
            drift * (firstTime + secondTime + thirdTime) + config.volatility ** 2 * (
              Math.min(firstTime, secondTime) + Math.min(firstTime, thirdTime) +
              Math.min(secondTime, thirdTime)
            ),
          );
        }
      }
    }
    return { first, second, third, times };
  }

  function lognormalOption(first, second, strike, optionType, discount) {
    const variance = Math.max(second - first * first, 0.0);
    if (variance <= 1e-16) return discount * Base.vanillaPayoff(first, strike, optionType);
    const logVariance = Math.log(second / (first * first));
    const root = Math.sqrt(logVariance);
    const d1 = (Math.log(first / strike) + 0.5 * logVariance) / root;
    const d2 = d1 - root;
    const call = discount * (first * Base.normalCdf(d1) - strike * Base.normalCdf(d2));
    return optionType === "call" ? call : call - discount * (first - strike);
  }

  function levyPrice(config) {
    const moments = asianMoments(config);
    return lognormalOption(
      moments.first, moments.second, config.strike, config.optionType,
      Math.exp(-config.rate * config.maturity),
    );
  }

  function shiftedLognormalPrice(config) {
    const { first, second, third } = asianMoments(config);
    const variance = Math.max(second - first * first, 0.0);
    if (variance <= 1e-16) {
      return Math.exp(-config.rate * config.maturity) *
        Base.vanillaPayoff(first, config.strike, config.optionType);
    }
    const centralThird = third - 3 * first * second + 2 * first ** 3;
    const skewness = Math.max(centralThird / variance ** 1.5, 0.0);
    let lower = 1.0 + 1e-12;
    let upper = 100.0;
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const middle = 0.5 * (lower + upper);
      const candidate = (middle + 2.0) * Math.sqrt(middle - 1.0);
      if (candidate > skewness) upper = middle;
      else lower = middle;
    }
    const expVariance = 0.5 * (lower + upper);
    const lognormalMean = Math.sqrt(variance / (expVariance - 1.0));
    const shift = first - lognormalMean;
    const adjustedStrike = config.strike - shift;
    const discount = Math.exp(-config.rate * config.maturity);
    if (adjustedStrike <= 0) {
      const call = discount * (first - config.strike);
      return config.optionType === "call" ? Math.max(call, 0) : 0;
    }
    const lognormalSecond = lognormalMean * lognormalMean * expVariance;
    const call = lognormalOption(lognormalMean, lognormalSecond, adjustedStrike, "call", discount);
    return config.optionType === "call" ? call : call - discount * (first - config.strike);
  }

  function conditionalAsianPrice(config, twoMoment) {
    const { times } = asianMoments(config);
    const count = times.length;
    const weight = 1.0 / count;
    const sigma2 = config.volatility ** 2;
    const drift = config.rate - config.dividendYield - 0.5 * sigma2;
    const means = times.map((time) => Math.log(config.spot) + drift * time);
    const meanY = means.reduce((sum, value) => sum + value, 0.0) / count;
    let varianceY = 0.0;
    const covarianceY = new Float64Array(count);
    for (let first = 0; first < count; first += 1) {
      for (let second = 0; second < count; second += 1) {
        const covariance = sigma2 * Math.min(times[first], times[second]);
        varianceY += weight * weight * covariance;
        covarianceY[first] += weight * covariance;
      }
    }
    if (varianceY <= 1e-16) return levyPrice(config);
    const rootVarianceY = Math.sqrt(varianceY);
    const lower = -8.0;
    const upper = 8.0;
    const intervals = 320;
    const dz = (upper - lower) / intervals;
    const integrand = (z) => {
      const y = meanY + rootVarianceY * z;
      const conditionalMeans = new Float64Array(count);
      const conditionalLogMeans = new Float64Array(count);
      let firstMoment = 0.0;
      for (let index = 0; index < count; index += 1) {
        const logMean = means[index] + covarianceY[index] / varianceY * (y - meanY);
        const logVariance = sigma2 * times[index] - covarianceY[index] ** 2 / varianceY;
        conditionalLogMeans[index] = logMean;
        conditionalMeans[index] = Math.exp(logMean + 0.5 * Math.max(logVariance, 0.0));
        firstMoment += weight * conditionalMeans[index];
      }
      let conditionalPayoff;
      if (!twoMoment) {
        conditionalPayoff = Base.vanillaPayoff(firstMoment, config.strike, config.optionType);
      } else {
        let secondMoment = 0.0;
        for (let first = 0; first < count; first += 1) {
          for (let second = 0; second < count; second += 1) {
            const covariance = sigma2 * Math.min(times[first], times[second]) -
              covarianceY[first] * covarianceY[second] / varianceY;
            secondMoment += weight * weight * conditionalMeans[first] *
              conditionalMeans[second] * Math.exp(covariance);
          }
        }
        conditionalPayoff = lognormalOption(
          firstMoment, secondMoment, config.strike, config.optionType, 1.0,
        );
      }
      return conditionalPayoff * Math.exp(-0.5 * z * z) / Math.sqrt(2.0 * Math.PI);
    };
    let total = integrand(lower) + integrand(upper);
    for (let index = 1; index < intervals; index += 1) {
      total += (index % 2 ? 4.0 : 2.0) * integrand(lower + index * dz);
    }
    return Math.exp(-config.rate * config.maturity) * total * dz / 3.0;
  }

  function juAsianComponents(config) {
    const schedule = scheduleFor(config);
    const assets = assetCountFor(config);
    const spots = [config.spot, config.spot2, config.spot3].slice(0, assets);
    const volatilities = [config.volatility, config.volatility2, config.volatility3].slice(0, assets);
    const dividends = [config.dividendYield, config.dividendYield2, config.dividendYield3].slice(0, assets);
    const basketWeights = normalizedWeights(config, assets);
    const fixingCount = schedule.length + (config.includeInitialFixing ? 1 : 0);
    let effectiveInitial = config.spot;
    let assetCoefficients = [1.0];

    if (config.underlyingMode === "order-performance") {
      throw new Error("Ju's lognormal-sum expansion does not apply to an order-statistic basket; use MC or QMC.");
    }
    if (config.underlyingMode === "weighted-price") {
      effectiveInitial = spots.reduce((sum, value, index) => sum + basketWeights[index] * value, 0.0);
      assetCoefficients = basketWeights;
    } else if (config.underlyingMode === "weighted-returns") {
      assetCoefficients = basketWeights.map((weight, index) => config.spot * weight / spots[index]);
    } else if (config.underlyingMode === "return-of-weighted-sum") {
      const initialWeighted = spots.reduce((sum, value, index) => sum + basketWeights[index] * value, 0.0);
      assetCoefficients = basketWeights.map((weight) => config.spot * weight / initialWeighted);
    }
    if (assetCoefficients.some((value) => !(value > 0))) {
      throw new Error("Ju's expansion requires strictly positive basket weights.");
    }

    const components = [];
    for (const time of schedule) {
      for (let asset = 0; asset < assets; asset += 1) {
        const coefficient = assetCoefficients[asset] / fixingCount;
        components.push({
          asset,
          time,
          volatility: volatilities[asset],
          mean: coefficient * spots[asset] * Math.exp((config.rate - dividends[asset]) * time),
        });
      }
    }
    return {
      components,
      deterministic: config.includeInitialFixing ? effectiveInitial / fixingCount : 0.0,
    };
  }

  function juAsianPrice(config) {
    const { components, deterministic } = juAsianComponents(config);
    const count = components.length;
    if (!count) return Math.exp(-config.rate * config.maturity) *
      Base.vanillaPayoff(deterministic, config.strike, config.optionType);
    if (count > 320) {
      throw new Error("Ju's order-six correction is limited to 320 stochastic basket/fixing components in the interactive lab; use MC or QMC for a larger basket schedule.");
    }
    const adjustedStrike = config.strike - deterministic;
    const discount = Math.exp(-config.rate * config.maturity);
    const firstMoment = components.reduce((sum, component) => sum + component.mean, 0.0);
    if (adjustedStrike <= 0) {
      const call = discount * (firstMoment - adjustedStrike);
      return config.optionType === "call" ? call : 0.0;
    }

    // Ju (2002) scales every lognormal volatility by z and expands the ratio
    // of the true characteristic function to its moment-matched lognormal
    // counterpart through z^6. C_ij is the unscaled log-return covariance.
    const covariance = Array.from({ length: count }, () => new Float64Array(count));
    for (let first = 0; first < count; first += 1) {
      for (let second = 0; second < count; second += 1) {
        const assetCorrelation = components[first].asset === components[second].asset
          ? 1.0 : config.correlation;
        covariance[first][second] = components[first].volatility * components[second].volatility *
          assetCorrelation * Math.min(components[first].time, components[second].time);
      }
    }

    const firstPower = new Float64Array(count);
    const secondPower = new Float64Array(count);
    let u2First = 0.0;
    let u2Second = 0.0;
    let u2Third = 0.0;
    for (let first = 0; first < count; first += 1) {
      const firstMean = components[first].mean;
      for (let second = 0; second < count; second += 1) {
        const weighted = firstMean * components[second].mean;
        const cov = covariance[first][second];
        u2First += weighted * cov;
        u2Second += weighted * cov * cov;
        u2Third += weighted * cov * cov * cov;
        firstPower[first] += components[second].mean * cov;
        secondPower[first] += components[second].mean * cov * cov;
      }
    }
    const u2Zero = firstMoment * firstMoment;
    const a1 = -u2First / (2.0 * u2Zero);
    const a2 = 2.0 * a1 * a1 - u2Second / (2.0 * u2Zero);
    const a3 = 6.0 * a1 * a2 - 4.0 * a1 ** 3 - u2Third / (2.0 * u2Zero);

    let eA1SquaredA2 = 0.0;
    let covarianceQuadratic = 0.0;
    let eA1CubedA3 = 0.0;
    let eA1A2A3 = 0.0;
    for (let index = 0; index < count; index += 1) {
      const mean = components[index].mean;
      eA1SquaredA2 += 2.0 * mean * firstPower[index] ** 2;
      eA1CubedA3 += 6.0 * mean * firstPower[index] ** 3;
      eA1A2A3 += 6.0 * mean * firstPower[index] * secondPower[index];
      for (let second = 0; second < count; second += 1) {
        covarianceQuadratic += mean * firstPower[index] * components[second].mean *
          firstPower[second] * covariance[index][second];
      }
    }
    const eA1SquaredA2Squared = 8.0 * covarianceQuadratic + 2.0 * u2First * u2Second;

    let eA2Cubed = 0.0;
    for (let first = 0; first < count; first += 1) {
      const firstMean = components[first].mean;
      for (let second = 0; second < count; second += 1) {
        const pair = firstMean * components[second].mean * covariance[first][second];
        for (let third = 0; third < count; third += 1) {
          eA2Cubed += 8.0 * pair * components[third].mean *
            covariance[first][third] * covariance[second][third];
        }
      }
    }

    const b1 = eA1SquaredA2 / (4.0 * firstMoment ** 3);
    const b2 = u2Second / (4.0 * u2Zero);
    const c1 = -a1 * b1;
    const c2 = (9.0 * eA1SquaredA2Squared + 4.0 * eA1CubedA3) /
      (144.0 * firstMoment ** 4);
    const c3 = (4.0 * eA1A2A3 + eA2Cubed) / (48.0 * firstMoment ** 3);
    const c4 = u2Third / (12.0 * u2Zero);

    const d2 = 0.5 * (10.0 * a1 * a1 + a2 - 6.0 * b1 + 2.0 * b2) - (
      128.0 * a1 ** 3 / 3.0 - a3 / 6.0 + 2.0 * a1 * b1 - a1 * b2 +
      50.0 * c1 - 11.0 * c2 + 3.0 * c3 - c4
    );
    const d3 = 2.0 * a1 * a1 - b1 - (
      88.0 * a1 ** 3 + 3.0 * a1 * (5.0 * b1 - 2.0 * b2) +
      3.0 * (35.0 * c1 - 6.0 * c2 + c3)
    ) / 3.0;
    const d4 = -20.0 * a1 ** 3 / 3.0 + a1 * (-4.0 * b1 + b2) - 10.0 * c1 + c2;
    const z1 = d2 - d3 + d4;
    const z2 = d3 - d4;
    const z3 = d4;

    let secondMoment = 0.0;
    for (let first = 0; first < count; first += 1) {
      for (let second = 0; second < count; second += 1) {
        secondMoment += components[first].mean * components[second].mean *
          Math.exp(covariance[first][second]);
      }
    }
    const logVariance = Math.log(secondMoment / u2Zero);
    if (!(logVariance > 1e-14)) return discount *
      Base.vanillaPayoff(deterministic + firstMoment, config.strike, config.optionType);
    const logMean = 2.0 * Math.log(firstMoment) - 0.5 * Math.log(secondMoment);
    const y = Math.log(adjustedStrike);
    const rootVariance = Math.sqrt(logVariance);
    const y1 = (logMean - y) / rootVariance + rootVariance;
    const y2 = y1 - rootVariance;
    const density = Math.exp(-0.5 * (y - logMean) ** 2 / logVariance) /
      Math.sqrt(2.0 * Math.PI * logVariance);
    const densityFirst = -(y - logMean) / logVariance * density;
    const densitySecond = (((y - logMean) ** 2) / (logVariance * logVariance) -
      1.0 / logVariance) * density;
    const lognormalCall = discount * (
      firstMoment * Base.normalCdf(y1) - adjustedStrike * Base.normalCdf(y2)
    );
    const correction = discount * adjustedStrike *
      (z1 * density + z2 * densityFirst + z3 * densitySecond);
    const call = Math.max(lognormalCall + correction, 0.0);
    const expectedAverage = deterministic + firstMoment;
    const put = call - discount * (expectedAverage - config.strike);
    return config.optionType === "call" ? call : Math.max(put, 0.0);
  }

  function thomasSolve(lower, diagonal, upper, right) {
    const count = diagonal.length;
    const cPrime = new Float64Array(count);
    const dPrime = new Float64Array(count);
    cPrime[0] = upper[0] / diagonal[0];
    dPrime[0] = right[0] / diagonal[0];
    for (let index = 1; index < count; index += 1) {
      const denominator = diagonal[index] - lower[index] * cPrime[index - 1];
      cPrime[index] = index === count - 1 ? 0 : upper[index] / denominator;
      dPrime[index] = (right[index] - lower[index] * dPrime[index - 1]) / denominator;
    }
    const result = new Float64Array(count);
    result[count - 1] = dPrime[count - 1];
    for (let index = count - 2; index >= 0; index -= 1) {
      result[index] = dPrime[index] - cPrime[index] * result[index + 1];
    }
    return result;
  }

  function gridBracket(grid, value) {
    if (value <= grid[0]) return { left: 0, weight: 0.0 };
    const last = grid.length - 1;
    if (value >= grid[last]) return { left: last - 1, weight: 1.0 };
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (grid[middle] <= value) low = middle;
      else high = middle;
    }
    return { left: low, weight: (value - grid[low]) / (grid[high] - grid[low]) };
  }

  function bilinearGridValue(values, spot, accumulated, spotGrid, averageGrid) {
    const spotPoints = spotGrid.length - 1;
    const spotLocation = gridBracket(spotGrid, spot);
    const averageLocation = gridBracket(averageGrid, accumulated);
    const spotLeft = spotLocation.left;
    const averageLeft = averageLocation.left;
    const spotWeight = spotLocation.weight;
    const averageWeight = averageLocation.weight;
    const stride = spotPoints + 1;
    const at = (averageIndex, spotIndex) => values[averageIndex * stride + spotIndex];
    const lower = at(averageLeft, spotLeft) * (1 - spotWeight) +
      at(averageLeft, spotLeft + 1) * spotWeight;
    const upper = at(averageLeft + 1, spotLeft) * (1 - spotWeight) +
      at(averageLeft + 1, spotLeft + 1) * spotWeight;
    return lower * (1 - averageWeight) + upper * averageWeight;
  }

  function asianAdiPrice(config) {
    const schedule = scheduleFor(config);
    const futureFixings = schedule.length;
    const totalFixings = futureFixings + (config.includeInitialFixing ? 1 : 0);
    const spotPoints = Math.max(36, config.pdeSpotGrid);
    const averagePoints = Math.max(36, config.pdeAverageGrid);
    const maximumSpot = Math.max(config.spot, config.strike) * 4.0;
    const maximumAccumulated = totalFixings * maximumSpot;
    const spotFocus = config.pdeGridType === "sinh-spot" ? config.spot : config.strike;
    const spotGrid = Base.buildSpatialGrid(
      0.0, maximumSpot, spotPoints, config.pdeGridType, spotFocus, config.pdeGridConcentration,
    );
    const averageGrid = Base.buildSpatialGrid(
      0.0, maximumAccumulated, averagePoints,
      config.pdeGridType === "uniform" ? "uniform" : "sinh-strike",
      config.strike * totalFixings, config.pdeGridConcentration,
    );
    const stride = spotPoints + 1;
    let values = new Float64Array((averagePoints + 1) * stride);
    for (let averageIndex = 0; averageIndex <= averagePoints; averageIndex += 1) {
      const accumulated = averageGrid[averageIndex];
      let terminalPayoff;
      if (config.pdePayoffSmoothing === "cell-average") {
        const left = averageIndex === 0 ? averageGrid[0]
          : 0.5 * (averageGrid[averageIndex - 1] + accumulated);
        const right = averageIndex === averagePoints ? averageGrid[averagePoints]
          : 0.5 * (accumulated + averageGrid[averageIndex + 1]);
        terminalPayoff = Base.averageTerminalPayoff(
          config, left / totalFixings, right / totalFixings,
        );
      } else {
        terminalPayoff = Base.vanillaPayoff(
          accumulated / totalFixings, config.strike, config.optionType,
        );
      }
      for (let spotIndex = 0; spotIndex <= spotPoints; spotIndex += 1) {
        values[averageIndex * stride + spotIndex] = terminalPayoff;
      }
    }

    let laterTime = config.maturity;
    for (let fixingIndex = futureFixings - 1; fixingIndex >= 0; fixingIndex -= 1) {
      const fixingTime = schedule[fixingIndex];
      const mapped = new Float64Array(values.length);
      for (let averageIndex = 0; averageIndex <= averagePoints; averageIndex += 1) {
        const accumulated = averageGrid[averageIndex];
        for (let spotIndex = 0; spotIndex <= spotPoints; spotIndex += 1) {
          const spot = spotGrid[spotIndex];
          mapped[averageIndex * stride + spotIndex] = bilinearGridValue(
            values, spot, accumulated + spot, spotGrid, averageGrid,
          );
        }
      }
      values = mapped;
      const earlierTime = fixingIndex === 0 ? 0.0 : schedule[fixingIndex - 1];
      const interval = fixingTime - earlierTime;
      const steps = Math.max(1, Math.round(config.pdeTimeSteps * interval / config.maturity));
      const dt = interval / steps;
      const interior = spotPoints - 1;
      const advance = (stepSize, theta) => {
        const next = new Float64Array(values.length);
        for (let averageIndex = 0; averageIndex <= averagePoints; averageIndex += 1) {
          const lower = new Float64Array(interior);
          const diagonal = new Float64Array(interior);
          const upper = new Float64Array(interior);
          const right = new Float64Array(interior);
          const rowOffset = averageIndex * stride;
          for (let spotIndex = 1; spotIndex < spotPoints; spotIndex += 1) {
            const position = spotIndex - 1;
            const coefficients = Base.finiteDifferenceCoefficients(config, spotGrid, spotIndex);
            lower[position] = -theta * stepSize * coefficients.lower;
            diagonal[position] = 1.0 - theta * stepSize * coefficients.diagonal;
            upper[position] = -theta * stepSize * coefficients.upper;
            const explicitWeight = 1.0 - theta;
            right[position] = explicitWeight * stepSize * coefficients.lower * values[rowOffset + spotIndex - 1] +
              (1.0 + explicitWeight * stepSize * coefficients.diagonal) * values[rowOffset + spotIndex] +
              explicitWeight * stepSize * coefficients.upper * values[rowOffset + spotIndex + 1];
          }
          const lowBoundary = values[rowOffset] * Math.exp(-config.rate * stepSize);
          const highBoundary = values[rowOffset + spotPoints] * Math.exp(-config.rate * stepSize);
          right[0] -= lower[0] * lowBoundary;
          right[interior - 1] -= upper[interior - 1] * highBoundary;
          const solved = thomasSolve(lower, diagonal, upper, right);
          next[rowOffset] = lowBoundary;
          next[rowOffset + spotPoints] = highBoundary;
          for (let position = 0; position < interior; position += 1) {
            next[rowOffset + position + 1] = Math.max(solved[position], 0.0);
          }
        }
        values = next;
      };
      for (let timeStep = 0; timeStep < steps; timeStep += 1) {
        if (timeStep < config.pdeRannacherSteps) {
          advance(0.5 * dt, 1.0);
          advance(0.5 * dt, 1.0);
        } else {
          advance(dt, 0.5);
        }
      }
      laterTime = earlierTime;
    }
    const initialAccumulated = config.includeInitialFixing ? config.spot : 0.0;
    return bilinearGridValue(
      values, config.spot, initialAccumulated, spotGrid, averageGrid,
    );
  }

  function generalizedCompoundClosedForm(config) {
    const innerType = config.compoundInnerType;
    const outerType = config.compoundOuterType;
    if (config.compoundStrike <= 1e-12 && outerType === "call") {
      return Base.blackScholes({ ...config, optionType: innerType });
    }
    const remaining = config.maturity - config.decisionTime;
    const innerAtDecision = (underlyingSpot) => Base.blackScholes({
      ...config, spot: underlyingSpot, maturity: remaining, optionType: innerType,
    });
    let low = 1e-10;
    let high = Math.max(config.spot, config.strike) * 4.0;
    while (innerType === "call" && innerAtDecision(high) < config.compoundStrike && high < 1e10) high *= 2;
    for (let iteration = 0; iteration < 140; iteration += 1) {
      const middle = 0.5 * (low + high);
      const above = innerAtDecision(middle) > config.compoundStrike;
      if ((innerType === "call" && above) || (innerType === "put" && !above)) high = middle;
      else low = middle;
    }
    const critical = 0.5 * (low + high);
    const phi = outerType === "call" ? 1.0 : -1.0;
    const eta = innerType === "call" ? 1.0 : -1.0;
    const sigma = config.volatility;
    const t1 = config.decisionTime;
    const t2 = config.maturity;
    const carry = config.rate - config.dividendYield;
    const a1 = (Math.log(config.spot / critical) + (carry + 0.5 * sigma ** 2) * t1) /
      (sigma * Math.sqrt(t1));
    const a2 = a1 - sigma * Math.sqrt(t1);
    const b1 = (Math.log(config.spot / config.strike) + (carry + 0.5 * sigma ** 2) * t2) /
      (sigma * Math.sqrt(t2));
    const b2 = b1 - sigma * Math.sqrt(t2);
    const correlation = Math.sqrt(t1 / t2);
    return phi * eta * config.spot * Math.exp(-config.dividendYield * t2) *
        Base.bivariateNormalCdf(phi * eta * a1, eta * b1, phi * correlation)
      - phi * eta * config.strike * Math.exp(-config.rate * t2) *
        Base.bivariateNormalCdf(phi * eta * a2, eta * b2, phi * correlation)
      - phi * config.compoundStrike * Math.exp(-config.rate * t1) *
        Base.normalCdf(phi * eta * a2);
  }

  function integratedTermVariance(config) {
    const first = config.volatility;
    const last = config.termVolatility;
    return (first * first + first * last + last * last) / 3.0;
  }

  function staticVarianceSwapPrice(config) {
    if (!["constant", "term"].includes(config.volatilityModel)) {
      throw new Error("Static replication currently requires deterministic constant or term volatility.");
    }
    const averageVariance = config.volatilityModel === "constant"
      ? config.volatility ** 2
      : integratedTermVariance(config);
    const effectiveVolatility = Math.sqrt(averageVariance);
    const forward = config.spot * Math.exp((config.rate - config.dividendYield) * config.maturity);
    const logRange = Math.max(4.0, 10.0 * effectiveVolatility * Math.sqrt(config.maturity));
    const panels = 2048;
    const integrateWing = (left, right, optionType) => {
      const width = (right - left) / panels;
      let sum = 0.0;
      for (let index = 0; index <= panels; index += 1) {
        const logMoneyness = left + index * width;
        const strike = forward * Math.exp(logMoneyness);
        const option = Base.blackScholes({
          ...config, strike, optionType, volatility: effectiveVolatility,
        });
        const coefficient = index === 0 || index === panels ? 1 : (index % 2 === 0 ? 2 : 4);
        // dK = K dx, hence OTM(K) / K^2 dK = OTM(K) / K dx.
        sum += coefficient * option / strike;
      }
      return sum * width / 3.0;
    };
    const optionStrip = integrateWing(-logRange, 0.0, "put") +
      integrateWing(0.0, logRange, "call");
    const fairVariance = 2.0 * Math.exp(config.rate * config.maturity) *
      optionStrip / config.maturity;
    return Math.exp(-config.rate * config.maturity) *
      config.varianceNotional * (config.annualization * fairVariance - config.varianceStrike);
  }

  function price(input, method) {
    const config = normalizeConfig(input);
    const supported = PRODUCT_METHODS[config.product];
    if (!supported?.includes(method)) throw new Error(`${method} is not available for ${config.product}.`);
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    let result;
    if (method === "mc" || method === "qmc") result = monteCarloPrice(config, method);
    else if (config.product === "asian") {
      if (config.volatilityModel !== "constant") {
        throw new Error("Asian approximations and ADI are Black-Scholes methods; select MC/QMC for term, local, Heston, or SLV.");
      }
      const prices = {
        levy: levyPrice,
        "shifted-lognormal": shiftedLognormalPrice,
        curran: (value) => conditionalAsianPrice(value, false),
        "curran-two-moment": (value) => conditionalAsianPrice(value, true),
        "ju-taylor": juAsianPrice,
        adi: asianAdiPrice,
      };
      result = { price: prices[method](config), standardError: null, standardDeviation: null, samples: 0 };
    } else if (config.product === "compound" && method === "closed-form") {
      if (config.volatilityModel !== "constant") throw new Error("Geske compound formulas require constant volatility.");
      result = { price: generalizedCompoundClosedForm(config), standardError: null, standardDeviation: null, samples: 0 };
    } else if (config.product === "variance-swap" && method === "static-replication") {
      result = { price: staticVarianceSwapPrice(config), standardError: null, standardDeviation: null, samples: 0 };
    } else if (config.volatilityModel === "constant") {
      result = Base.price(config, method);
    } else {
      throw new Error("This deterministic method requires constant volatility; use Monte Carlo for the selected model.");
    }
    const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
    return { ...result, elapsedMs: ended - started, config, method };
  }

  const REGRESSION_CONTRACTS = [
    { product: "digital", cashPayoff: 10 },
    { product: "barrier", barrier: 130, monitoringSteps: 6 },
    { product: "double-barrier", lowerBarrier: 70, upperBarrier: 140, monitoringSteps: 6 },
    { product: "bermudan", optionType: "put", exerciseDates: 4 },
    { product: "rainbow", spot2: 95, monitoringSteps: 4 },
    { product: "autocallable", monitoringSteps: 4 },
    { product: "phoenix-autocall", monitoringSteps: 4 },
    { product: "yield-seeker", monitoringSteps: 4 },
    { product: "himalayan", assetCount: 3, observations: 3 },
    { product: "lookback", monitoringSteps: 6 },
    { product: "ladder", monitoringSteps: 6 },
    { product: "compound", compoundOuterType: "call", compoundInnerType: "call" },
    { product: "compound", compoundOuterType: "put", compoundInnerType: "call" },
    { product: "compound", compoundOuterType: "call", compoundInnerType: "put" },
    { product: "compound", compoundOuterType: "put", compoundInnerType: "put" },
    { product: "asian", monitoringSteps: 6 },
    { product: "variance-swap", monitoringSteps: 6 },
    { product: "volatility-swap", monitoringSteps: 6 },
    { product: "variance-option", monitoringSteps: 6 },
    { product: "volatility-option", monitoringSteps: 6 },
    { product: "accumulator", monitoringSteps: 6 },
  ];

  function runVolatilityRegressions(paths = 2048) {
    const rows = [];
    const base = {
      spot: 100, strike: 100, rate: 0.03, dividendYield: 0.01,
      volatility: 0.2, termVolatility: 0.28, maturity: 1,
      paths, seed: 99173, monitoringSteps: 6,
      hestonKappa: 1.8, hestonLongRunVol: 0.24, hestonVolOfVol: 0.45, hestonRho: -0.55,
      localBeta: -0.3,
    };
    const compare = (name, contract, referenceConfig, candidateConfig) => {
      const reference = monteCarloPrice(normalizeConfig({ ...base, ...contract, ...referenceConfig }), "mc").price;
      const candidate = monteCarloPrice(normalizeConfig({ ...base, ...contract, ...candidateConfig }), "mc").price;
      const absoluteError = Math.abs(reference - candidate);
      rows.push({
        name: `${contract.product}: ${name}`,
        product: contract.product,
        reference,
        candidate,
        absoluteError,
        tolerance: 1e-11,
        passed: absoluteError <= 1e-11,
      });
    };
    for (const contract of REGRESSION_CONTRACTS) {
      compare("SLV -> Heston", contract,
        { volatilityModel: "heston" },
        { volatilityModel: "slv", localBeta: 0 });
      compare("SLV -> local volatility", contract,
        { volatilityModel: "local" },
        { volatilityModel: "slv", hestonVolOfVol: 0 });
      compare("local volatility -> term volatility", contract,
        { volatilityModel: "term" },
        { volatilityModel: "local", localBeta: 0 });
      compare("term volatility -> constant volatility", contract,
        { volatilityModel: "constant" },
        { volatilityModel: "term", termVolatility: base.volatility });
    }
    return rows;
  }

  function runAdvancedPayoffUnitTests() {
    const rows = [];
    const add = (product, name, inputs, expected, evaluate, rationale, tolerance = 1e-12) => {
      let actual = null;
      let error = "";
      try {
        actual = evaluate();
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      rows.push({
        product, name, inputs, expected, actual, rationale, error,
        passed: !error && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
      });
    };
    const configFor = (product, extra = {}) => normalizeConfig({
      product, spot: 100, strike: 100, rate: 0, dividendYield: 0,
      volatility: 0.2, maturity: 1, paths: 100, monitoringSteps: 3, ...extra,
    });
    const presentValue = (product, path, extra = {}, logReturns = []) => {
      const config = configFor(product, extra);
      const schedule = Array.from({ length: path.length }, (_, index) => (index + 1) / path.length);
      return pathPresentValue(config, { underlying: path, paths: [path], logReturns }, schedule);
    };

    add("asian", "Uneven arithmetic-average call", { fixings: [90, 100, 120], strike: 100 },
      10 / 3, () => presentValue("asian", [90, 100, 120]),
      "The mean is 103⅓, so the call pays 3⅓.");
    add("asian", "Initial fixing participates", { initial: 100, fixings: [80, 120], strike: 100 },
      0, () => presentValue("asian", [80, 120], { includeInitialFixing: true }),
      "Including the initial 100 makes the three-fixing average exactly 100.");

    add("phoenix-autocall", "Memory coupons catch up before autocall",
      { path: [70, 85, 105], couponBarrier: 0.8, autocallBarrier: 1, coupon: 0.02 },
      106, () => presentValue("phoenix-autocall", [70, 85, 105], {
        notional: 100, coupon: 0.02, couponBarrier: 0.8, autocallBarrier: 1,
        protectionBarrier: 0.7, memoryCoupon: true,
      }), "The missed first coupon is paid with the second; the final fixing pays one coupon and returns principal.");
    add("phoenix-autocall", "Unprotected downside redemption", { path: [60, 60, 60] },
      60, () => presentValue("phoenix-autocall", [60, 60, 60], {
        notional: 100, coupon: 0.02, couponBarrier: 0.8, autocallBarrier: 1,
        protectionBarrier: 0.7,
      }), "Below protection with no coupons or autocall, principal follows terminal performance.");

    add("yield-seeker", "No autocall despite strong performance", { path: [105, 105, 105] },
      106, () => presentValue("yield-seeker", [105, 105, 105], {
        notional: 100, coupon: 0.02, couponBarrier: 0.8, protectionBarrier: 0.7,
      }), "Three coupons and principal are paid; the product deliberately has no autocall feature.");
    add("yield-seeker", "Protected maturity redemption", { path: [75, 75, 75] },
      100, () => presentValue("yield-seeker", [75, 75, 75], {
        notional: 100, coupon: 0.02, couponBarrier: 0.8, protectionBarrier: 0.7,
      }), "No coupon is earned, but terminal performance remains above the protection barrier.");

    const varianceReturns = [0.1, -0.2];
    add("variance-swap", "Variance leg uses squared log returns", { returns: varianceReturns, strike: 0.04 },
      10, () => presentValue("variance-swap", [100, 100], {
        varianceStrike: 0.04, varianceNotional: 1000, annualization: 1,
      }, varianceReturns), "Realized variance is 0.05, ten variance-notional points above the 0.04 strike.");
    add("volatility-swap", "Volatility is square root of variance", { variance: 0.05, strike: 0.2 },
      1000 * (Math.sqrt(0.05) - 0.2), () => presentValue("volatility-swap", [100, 100], {
        volatilityStrike: 0.2, varianceNotional: 1000, annualization: 1,
      }, varianceReturns), "The leg uses √0.05, not 0.05 itself.");
    add("variance-option", "Variance call is floored", { variance: 0.05, strike: 0.04 },
      10, () => presentValue("variance-option", [100, 100], {
        varianceStrike: 0.04, varianceNotional: 1000, annualization: 1, optionType: "call",
      }, varianceReturns), "A variance call pays the positive 0.01 excess times notional.");
    add("volatility-option", "Volatility put pays below strike", { volatility: Math.sqrt(0.05), strike: 0.25 },
      1000 * (0.25 - Math.sqrt(0.05)), () => presentValue("volatility-option", [100, 100], {
        volatilityStrike: 0.25, varianceNotional: 1000, annualization: 1, optionType: "put",
      }, varianceReturns), "The put pays because √0.05 is below 25%.");

    add("accumulator", "Downside gearing and upper knock-out", { path: [105, 80, 112], strike: 100 },
      -35, () => presentValue("accumulator", [105, 80, 112], {
        accumulatorQuantity: 1, accumulatorGearing: 2, accumulatorKnockOut: 1.1,
      }), "The first fixing earns 5, the second loses 40 with gearing, and the third knocks out before settlement.");
    add("accumulator", "All favorable fixings accumulate", { path: [102, 104, 106], strike: 100 },
      12, () => presentValue("accumulator", [102, 104, 106], {
        accumulatorQuantity: 1, accumulatorGearing: 2, accumulatorKnockOut: 1.1,
      }), "No knock-out occurs, so 2 + 4 + 6 is accumulated.");

    const basketPaths = [[110, 120], [180, 220], [90, 120]];
    const basketBase = configFor("asian", { spot2: 200, spot3: 100, basketAssetCount: 3, basketWeights: [0.5, 0.3, 0.2] });
    add("basket-underlying", "Weighted price basket", { weights: [0.5, 0.3, 0.2] },
      127, () => effectiveUnderlying({ ...basketBase, underlyingMode: "weighted-price" }, basketPaths)[0],
      "The first basket fixing is 0.5×110 + 0.3×180 + 0.2×90.");
    add("basket-underlying", "Best performance order statistic", { performances: [1.1, 0.9, 0.9], rank: 1 },
      110, () => effectiveUnderlying({ ...basketBase, underlyingMode: "order-performance", basketOrder: 1 }, basketPaths)[0],
      "Rank one is the best normalized performance and is rescaled to the primary initial spot.");
    add("basket-underlying", "Weighted returns normalize asset price scales", { weights: [0.5, 0.3, 0.2] },
      100, () => effectiveUnderlying({ ...basketBase, underlyingMode: "weighted-returns" }, basketPaths)[0],
      "The weighted performances are 0.5×1.1 + 0.3×0.9 + 0.2×0.9 = 1.0.");
    add("basket-underlying", "Return of weighted sums has its own denominator", { firstWeightedPrice: 127, initialWeightedPrice: 130 },
      100 * 127 / 130, () => effectiveUnderlying({ ...basketBase, underlyingMode: "return-of-weighted-sum" }, basketPaths)[0],
      "The basket return is the weighted current price divided by the weighted initial price.");

    const compoundBase = configFor("compound", {
      rate: 0.05, volatilityModel: "constant", compoundStrike: 5, decisionTime: 0.5,
    });
    const compoundParity = (innerType) => {
      const outerCall = generalizedCompoundClosedForm({
        ...compoundBase, compoundInnerType: innerType, compoundOuterType: "call",
      });
      const outerPut = generalizedCompoundClosedForm({
        ...compoundBase, compoundInnerType: innerType, compoundOuterType: "put",
      });
      return outerCall - outerPut;
    };
    add("compound", "Call-on-call and put-on-call parity", { inner: "call", outer: ["call", "put"] },
      Base.blackScholes({ ...compoundBase, optionType: "call" }) -
        compoundBase.compoundStrike * Math.exp(-compoundBase.rate * compoundBase.decisionTime),
      () => compoundParity("call"),
      "The difference between outer call and outer put equals the inner call value less discounted compound strike.", 2e-8);
    add("compound", "Call-on-put and put-on-put parity", { inner: "put", outer: ["call", "put"] },
      Base.blackScholes({ ...compoundBase, optionType: "put" }) -
        compoundBase.compoundStrike * Math.exp(-compoundBase.rate * compoundBase.decisionTime),
      () => compoundParity("put"),
      "The same compound put-call parity covers the two inner-put combinations.", 2e-8);
    return rows;
  }

  return {
    VOLATILITY_MODELS,
    VOLATILITY_CODES,
    PRODUCT_CODES,
    PRODUCT_METHODS,
    PRODUCT_DESCRIPTIONS,
    ADVANCED_PAYOFF_DEFINITIONS,
    normalizeConfig,
    scheduleFor,
    price,
    monteCarloPrice,
    simulatePathDistribution,
    levyPrice,
    shiftedLognormalPrice,
    conditionalAsianPrice,
    juAsianPrice,
    asianAdiPrice,
    generalizedCompoundClosedForm,
    staticVarianceSwapPrice,
    integratedTermVariance,
    phoenixPresentValue,
    realizedVariance,
    effectiveUnderlying,
    pathPresentValue,
    runAdvancedPayoffUnitTests,
    runVolatilityRegressions,
  };
}));
