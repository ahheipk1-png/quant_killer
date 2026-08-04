(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./exotic-pricer.js"));
  } else {
    root.VolatilityModels = factory(root.ExoticPricer);
  }
}(typeof self !== "undefined" ? self : this, function (Base) {
  "use strict";

  if (!Base) throw new Error("The base option-pricing engine is required.");

  const FIT_METHODS = Object.freeze({
    "raw-svi": "Raw SVI",
    "natural-svi": "Natural SVI (reported from raw fit)",
    "svi-jw": "SVI jump-wings (reported from raw fit)",
    ssvi: "Power-law SSVI surface",
    sabr: "Hagan lognormal SABR",
    "vanna-volga": "Vanna-Volga three-anchor smile",
    "pchip-variance": "PCHIP total-variance smile",
    cvi: "CVI convex variance spline (QP)",
    "convex-call": "Constrained convex call-price interpolation",
    dumas: "Dumas polynomial surface",
  });

  const TERM_METHODS = Object.freeze({
    "linear-total-variance": "Linear total variance",
    "pchip-total-variance": "Monotone PCHIP total variance",
    "linear-volatility": "Linear implied volatility",
  });

  const VOLATILITY_TEST_DEFINITION = Object.freeze({
    label: "Volatility calibration",
    kind: "Surface-model regression",
    formulaLabel: "Workflow",
    formula: "option price -> fitted variance surface -> Dupire local vol -> forward-PDE price round trip -> SLV leverage",
    description: "Executable reductions cover implied-vol inversion, term variance, SVI/SSVI, SABR, Vanna-Volga, CVI variance-spline QP, convex-call interpolation, Dumas fitting, a dense local-volatility price round trip, and SLV leverage.",
  });

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function normalPdf(value) {
    return Math.exp(-0.5 * value * value) / Math.sqrt(2.0 * Math.PI);
  }

  function blackScholesPrice(market, volatility, optionType = market.optionType || "call") {
    return Base.blackScholes({
      spot: market.spot,
      strike: market.strike,
      rate: market.rate || 0,
      dividendYield: market.dividendYield || 0,
      maturity: market.maturity,
      volatility,
      optionType,
    });
  }

  function blackScholesBounds(market, optionType = market.optionType || "call") {
    const spotPv = market.spot * Math.exp(-(market.dividendYield || 0) * market.maturity);
    const strikePv = market.strike * Math.exp(-(market.rate || 0) * market.maturity);
    return optionType === "call"
      ? { lower: Math.max(spotPv - strikePv, 0), upper: spotPv }
      : { lower: Math.max(strikePv - spotPv, 0), upper: strikePv };
  }

  function blackScholesVega(market, volatility) {
    const rootT = Math.sqrt(market.maturity);
    const d1 = (Math.log(market.spot / market.strike) +
      ((market.rate || 0) - (market.dividendYield || 0) + 0.5 * volatility ** 2) *
      market.maturity) / (volatility * rootT);
    return market.spot * Math.exp(-(market.dividendYield || 0) * market.maturity) *
      normalPdf(d1) * rootT;
  }

  function impliedVolatility(market, optionPrice, optionType = market.optionType || "call",
    options = {}) {
    if (!(market.spot > 0 && market.strike > 0 && market.maturity > 0)) {
      throw new Error("Implied volatility requires positive spot, strike, and maturity.");
    }
    const price = Number(optionPrice);
    const tolerance = Number(options.tolerance ?? 1e-10);
    const maximumIterations = Math.trunc(Number(options.maximumIterations ?? 100));
    const bounds = blackScholesBounds(market, optionType);
    const boundTolerance = Math.max(1e-12, tolerance * Math.max(1, bounds.upper));
    if (!Number.isFinite(price) || price < bounds.lower - boundTolerance ||
      price > bounds.upper + boundTolerance) {
      throw new Error(`Option price ${price} violates Black-Scholes arbitrage bounds ` +
        `[${bounds.lower}, ${bounds.upper}].`);
    }
    if (price <= bounds.lower + boundTolerance) {
      return { volatility: 0, iterations: 0, residual: bounds.lower - price, converged: true };
    }
    let lower = 1e-9;
    let upper = Number(options.maximumVolatility ?? 2.0);
    while (blackScholesPrice(market, upper, optionType) < price && upper < 16) upper *= 2;
    if (blackScholesPrice(market, upper, optionType) < price) {
      throw new Error("The implied volatility root could not be bracketed.");
    }
    let volatility = clamp(Number(options.initialGuess ?? 0.25), lower, upper);
    let residual = Infinity;
    for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
      const modelPrice = blackScholesPrice(market, volatility, optionType);
      residual = modelPrice - price;
      if (Math.abs(residual) <= tolerance * Math.max(1, price)) {
        return { volatility, iterations: iteration, residual, converged: true };
      }
      if (residual > 0) upper = volatility;
      else lower = volatility;
      const vega = blackScholesVega(market, Math.max(volatility, 1e-9));
      const newton = volatility - residual / Math.max(vega, 1e-14);
      volatility = newton > lower && newton < upper && Number.isFinite(newton)
        ? newton
        : 0.5 * (lower + upper);
    }
    return { volatility, iterations: maximumIterations, residual, converged: false };
  }

  function pava(values, weights = values.map(() => 1), increasing = true) {
    const blocks = [];
    values.forEach((rawValue, index) => {
      const value = increasing ? rawValue : -rawValue;
      blocks.push({ start: index, end: index, weight: weights[index], value });
      while (blocks.length > 1 && blocks.at(-2).value > blocks.at(-1).value) {
        const right = blocks.pop();
        const left = blocks.pop();
        const weight = left.weight + right.weight;
        blocks.push({
          start: left.start,
          end: right.end,
          weight,
          value: (left.value * left.weight + right.value * right.weight) / weight,
        });
      }
    });
    const result = new Array(values.length);
    blocks.forEach((block) => {
      for (let index = block.start; index <= block.end; index += 1) {
        result[index] = increasing ? block.value : -block.value;
      }
    });
    return result;
  }

  function pchipSlopes(xs, ys) {
    const count = xs.length;
    if (count === 1) return [0];
    if (count === 2) {
      const slope = (ys[1] - ys[0]) / (xs[1] - xs[0]);
      return [slope, slope];
    }
    const h = new Array(count - 1);
    const delta = new Array(count - 1);
    for (let index = 0; index < count - 1; index += 1) {
      h[index] = xs[index + 1] - xs[index];
      delta[index] = (ys[index + 1] - ys[index]) / h[index];
    }
    const slopes = new Array(count).fill(0);
    for (let index = 1; index < count - 1; index += 1) {
      if (delta[index - 1] * delta[index] <= 0) slopes[index] = 0;
      else {
        const first = 2 * h[index] + h[index - 1];
        const second = h[index] + 2 * h[index - 1];
        slopes[index] = (first + second) /
          (first / delta[index - 1] + second / delta[index]);
      }
    }
    slopes[0] = ((2 * h[0] + h[1]) * delta[0] - h[0] * delta[1]) / (h[0] + h[1]);
    if (Math.sign(slopes[0]) !== Math.sign(delta[0])) slopes[0] = 0;
    else if (Math.sign(delta[0]) !== Math.sign(delta[1]) &&
      Math.abs(slopes[0]) > Math.abs(3 * delta[0])) slopes[0] = 3 * delta[0];
    const last = count - 1;
    slopes[last] = ((2 * h[last - 1] + h[last - 2]) * delta[last - 1] -
      h[last - 1] * delta[last - 2]) / (h[last - 1] + h[last - 2]);
    if (Math.sign(slopes[last]) !== Math.sign(delta[last - 1])) slopes[last] = 0;
    else if (Math.sign(delta[last - 1]) !== Math.sign(delta[last - 2]) &&
      Math.abs(slopes[last]) > Math.abs(3 * delta[last - 1])) {
      slopes[last] = 3 * delta[last - 1];
    }
    return slopes;
  }

  function buildPchip(xsInput, ysInput, extrapolation = "linear") {
    if (xsInput.length !== ysInput.length || xsInput.length < 1) {
      throw new Error("Interpolation requires matching non-empty x/y arrays.");
    }
    const nodes = xsInput.map((x, index) => ({ x: Number(x), y: Number(ysInput[index]) }))
      .sort((first, second) => first.x - second.x);
    for (let index = 1; index < nodes.length; index += 1) {
      if (!(nodes[index].x > nodes[index - 1].x)) throw new Error("Interpolation nodes must be unique.");
    }
    const xs = nodes.map((node) => node.x);
    const ys = nodes.map((node) => node.y);
    const slopes = pchipSlopes(xs, ys);
    const evaluate = (point) => {
      if (xs.length === 1) return ys[0];
      if (point <= xs[0]) return extrapolation === "flat"
        ? ys[0] : ys[0] + slopes[0] * (point - xs[0]);
      const last = xs.length - 1;
      if (point >= xs[last]) return extrapolation === "flat"
        ? ys[last] : ys[last] + slopes[last] * (point - xs[last]);
      let low = 0;
      let high = last;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (xs[middle] <= point) low = middle;
        else high = middle;
      }
      const width = xs[low + 1] - xs[low];
      const t = (point - xs[low]) / width;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      return h00 * ys[low] + h10 * width * slopes[low] +
        h01 * ys[low + 1] + h11 * width * slopes[low + 1];
    };
    return { xs, ys, slopes, evaluate };
  }

  function interpolateLinear(xs, ys, point, extrapolation = "linear") {
    if (xs.length === 1) return ys[0];
    if (point <= xs[0]) {
      if (extrapolation === "flat") return ys[0];
      return ys[0] + (ys[1] - ys[0]) * (point - xs[0]) / (xs[1] - xs[0]);
    }
    const last = xs.length - 1;
    if (point >= xs[last]) {
      if (extrapolation === "flat") return ys[last];
      return ys[last] + (ys[last] - ys[last - 1]) * (point - xs[last]) /
        (xs[last] - xs[last - 1]);
    }
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (xs[middle] <= point) low = middle;
      else high = middle;
    }
    const weight = (point - xs[low]) / (xs[low + 1] - xs[low]);
    return ys[low] * (1 - weight) + ys[low + 1] * weight;
  }

  function buildTermStructure(pillars, method = "linear-total-variance", repair = true) {
    if (!Object.hasOwn(TERM_METHODS, method)) throw new Error("Unknown term interpolation method.");
    const sorted = pillars.map((pillar) => ({
      maturity: Number(pillar.maturity),
      volatility: Number(pillar.volatility),
      totalVariance: pillar.totalVariance === undefined
        ? Number(pillar.volatility) ** 2 * Number(pillar.maturity)
        : Number(pillar.totalVariance),
    })).sort((first, second) => first.maturity - second.maturity);
    if (!sorted.length || sorted.some((node) => !(node.maturity > 0 && node.totalVariance >= 0))) {
      throw new Error("Term pillars require positive maturities and non-negative total variance.");
    }
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].maturity === sorted[index - 1].maturity) {
        throw new Error("Term maturities must be unique.");
      }
    }
    const maturities = sorted.map((node) => node.maturity);
    let totalVariances = sorted.map((node) => node.totalVariance);
    if (repair) totalVariances = pava(totalVariances, totalVariances.map(() => 1), true)
      .map((value) => Math.max(value, 0));
    const volatilities = totalVariances.map((value, index) =>
      Math.sqrt(Math.max(value / maturities[index], 0)));
    const pchip = method === "pchip-total-variance"
      ? buildPchip(maturities, totalVariances, "linear") : null;
    const totalVariance = (maturity) => {
      const time = Math.max(Number(maturity), 1e-10);
      if (time <= maturities[0]) return totalVariances[0] * time / maturities[0];
      if (method === "linear-volatility") {
        const volatility = Math.max(interpolateLinear(
          maturities, volatilities, time, "flat",
        ), 0);
        return volatility ** 2 * time;
      }
      const value = method === "pchip-total-variance"
        ? pchip.evaluate(time)
        : interpolateLinear(maturities, totalVariances, time, "linear");
      return Math.max(value, 0);
    };
    const volatility = (maturity) => Math.sqrt(totalVariance(maturity) / Math.max(maturity, 1e-10));
    const forwardVariances = maturities.map((maturity, index) => {
      const previousTime = index === 0 ? 0 : maturities[index - 1];
      const previousVariance = index === 0 ? 0 : totalVariances[index - 1];
      return (totalVariances[index] - previousVariance) / (maturity - previousTime);
    });
    return {
      method,
      repaired: repair && sorted.some((node, index) =>
        Math.abs(node.totalVariance - totalVariances[index]) > 1e-14),
      maturities,
      totalVariances,
      volatilities,
      forwardVariances,
      totalVariance,
      volatility,
    };
  }

  function rawSviTotalVariance(logMoneyness, parameters) {
    const difference = logMoneyness - parameters.m;
    return parameters.a + parameters.b * (parameters.rho * difference +
      Math.sqrt(difference ** 2 + parameters.sigma ** 2));
  }

  function rawSviDerivatives(logMoneyness, parameters) {
    const difference = logMoneyness - parameters.m;
    const root = Math.sqrt(difference ** 2 + parameters.sigma ** 2);
    return {
      value: rawSviTotalVariance(logMoneyness, parameters),
      first: parameters.b * (parameters.rho + difference / root),
      second: parameters.b * parameters.sigma ** 2 / root ** 3,
    };
  }

  function rawToNaturalSvi(parameters) {
    const rootRho = Math.sqrt(Math.max(1 - parameters.rho ** 2, 1e-14));
    const zeta = rootRho / parameters.sigma;
    const omega = 2 * parameters.b / zeta;
    return {
      delta: parameters.a - 0.5 * omega * (1 - parameters.rho ** 2),
      mu: parameters.m + parameters.rho / zeta,
      rho: parameters.rho,
      omega,
      zeta,
    };
  }

  function naturalSviTotalVariance(logMoneyness, parameters) {
    const centered = logMoneyness - parameters.mu;
    return parameters.delta + 0.5 * parameters.omega * (
      1 + parameters.zeta * parameters.rho * centered +
      Math.sqrt((parameters.zeta * centered + parameters.rho) ** 2 +
        1 - parameters.rho ** 2)
    );
  }

  function rawToJumpWings(parameters, maturity) {
    const atTheMoney = rawSviTotalVariance(0, parameters);
    const rootW = Math.sqrt(Math.max(atTheMoney, 1e-14));
    const root = Math.sqrt(parameters.m ** 2 + parameters.sigma ** 2);
    return {
      v: atTheMoney / maturity,
      psi: parameters.b * 0.5 / rootW * (parameters.rho - parameters.m / root),
      p: parameters.b * (1 - parameters.rho) / rootW,
      c: parameters.b * (1 + parameters.rho) / rootW,
      vTilde: (parameters.a + parameters.b * parameters.sigma *
        Math.sqrt(Math.max(1 - parameters.rho ** 2, 0))) / maturity,
    };
  }

  function ssviPhi(theta, parameters) {
    return parameters.eta /
      (Math.max(theta, 1e-12) ** parameters.gamma *
        (1 + Math.max(theta, 0)) ** (1 - parameters.gamma));
  }

  function ssviTotalVariance(logMoneyness, theta, parameters) {
    const phi = ssviPhi(theta, parameters);
    const shifted = phi * logMoneyness + parameters.rho;
    return 0.5 * theta * (1 + parameters.rho * phi * logMoneyness +
      Math.sqrt(shifted ** 2 + 1 - parameters.rho ** 2));
  }

  function applyBounds(values, bounds) {
    return values.map((value, index) => clamp(value, bounds[index][0], bounds[index][1]));
  }

  function nelderMead(objective, initial, bounds, options = {}) {
    const dimension = initial.length;
    const maximumIterations = Math.trunc(options.maximumIterations ?? 800);
    const tolerance = Number(options.tolerance ?? 1e-12);
    const simplex = [{ x: applyBounds(initial, bounds) }];
    for (let index = 0; index < dimension; index += 1) {
      const point = initial.slice();
      const range = bounds[index][1] - bounds[index][0];
      point[index] += Math.max(range * 0.06, Math.abs(point[index]) * 0.08, 1e-4);
      simplex.push({ x: applyBounds(point, bounds) });
    }
    simplex.forEach((point) => { point.value = objective(point.x); });
    let iteration = 0;
    for (; iteration < maximumIterations; iteration += 1) {
      simplex.sort((first, second) => first.value - second.value);
      if (Math.abs(simplex.at(-1).value - simplex[0].value) <=
        tolerance * Math.max(1, Math.abs(simplex[0].value))) break;
      const centroid = new Array(dimension).fill(0);
      for (let vertex = 0; vertex < dimension; vertex += 1) {
        for (let index = 0; index < dimension; index += 1) {
          centroid[index] += simplex[vertex].x[index] / dimension;
        }
      }
      const worst = simplex[dimension];
      const reflect = applyBounds(centroid.map((value, index) =>
        value + (value - worst.x[index])), bounds);
      const reflectedValue = objective(reflect);
      if (reflectedValue < simplex[0].value) {
        const expand = applyBounds(centroid.map((value, index) =>
          value + 2 * (reflect[index] - value)), bounds);
        const expandedValue = objective(expand);
        simplex[dimension] = expandedValue < reflectedValue
          ? { x: expand, value: expandedValue }
          : { x: reflect, value: reflectedValue };
      } else if (reflectedValue < simplex[dimension - 1].value) {
        simplex[dimension] = { x: reflect, value: reflectedValue };
      } else {
        const contract = applyBounds(centroid.map((value, index) =>
          value + 0.5 * (worst.x[index] - value)), bounds);
        const contractedValue = objective(contract);
        if (contractedValue < worst.value) simplex[dimension] = { x: contract, value: contractedValue };
        else {
          const best = simplex[0].x;
          for (let vertex = 1; vertex <= dimension; vertex += 1) {
            simplex[vertex].x = applyBounds(simplex[vertex].x.map((value, index) =>
              best[index] + 0.5 * (value - best[index])), bounds);
            simplex[vertex].value = objective(simplex[vertex].x);
          }
        }
      }
    }
    simplex.sort((first, second) => first.value - second.value);
    return { parameters: simplex[0].x, objective: simplex[0].value, iterations: iteration };
  }

  function errorMetrics(points, evaluator, field = "totalVariance") {
    let weightedError = 0;
    let totalWeight = 0;
    let maximumError = 0;
    points.forEach((point) => {
      const error = evaluator(point) - point[field];
      const weight = Number(point.weight ?? 1);
      weightedError += weight * error ** 2;
      totalWeight += weight;
      maximumError = Math.max(maximumError, Math.abs(error));
    });
    return { rmse: Math.sqrt(weightedError / Math.max(totalWeight, 1e-14)), maximumError };
  }

  function fitRawSvi(points, options = {}) {
    if (points.length < 5) throw new Error("Raw SVI calibration requires at least five quotes.");
    const minimumW = Math.max(Math.min(...points.map((point) => point.totalVariance)), 1e-6);
    const maximumW = Math.max(...points.map((point) => point.totalVariance));
    const minimumK = Math.min(...points.map((point) => point.logMoneyness));
    const maximumK = Math.max(...points.map((point) => point.logMoneyness));
    const span = Math.max(maximumK - minimumK, 0.2);
    const bounds = [
      [1e-9, Math.max(maximumW * 2, 0.25)],
      [1e-6, Math.max(2, maximumW * 8 / span)],
      [-0.999, 0.999],
      [minimumK - span, maximumK + span],
      [0.005, Math.max(2, span * 4)],
    ];
    const slope = (points.at(-1).totalVariance - points[0].totalVariance) / span;
    const starts = [
      [minimumW * 0.5, Math.max((maximumW - minimumW) / span, 0.05),
        clamp(slope / Math.max((maximumW - minimumW) / span, 0.05), -0.8, 0.8), 0, 0.2],
      [minimumW * 0.7, 0.15, -0.5, 0, 0.35],
      [minimumW * 0.7, 0.15, 0.5, 0, 0.35],
      [minimumW * 0.4, 0.3, -0.2, minimumK * 0.25, 0.1],
      [minimumW * 0.4, 0.3, 0.2, maximumK * 0.25, 0.6],
    ];
    const objective = (values) => {
      const parameters = { a: values[0], b: values[1], rho: values[2], m: values[3], sigma: values[4] };
      const minimumVariance = parameters.a + parameters.b * parameters.sigma *
        Math.sqrt(Math.max(1 - parameters.rho ** 2, 0));
      if (minimumVariance < 0) return 1e6 + minimumVariance ** 2 * 1e8;
      return points.reduce((sum, point) => {
        const error = rawSviTotalVariance(point.logMoneyness, parameters) - point.totalVariance;
        return sum + Number(point.weight ?? 1) * error ** 2;
      }, 0);
    };
    let best = null;
    starts.forEach((start) => {
      const result = nelderMead(objective, start, bounds, options);
      if (!best || result.objective < best.objective) best = result;
    });
    const parameters = {
      a: best.parameters[0], b: best.parameters[1], rho: best.parameters[2],
      m: best.parameters[3], sigma: best.parameters[4],
    };
    const metrics = errorMetrics(points,
      (point) => rawSviTotalVariance(point.logMoneyness, parameters));
    return {
      method: "raw-svi", parameters, natural: rawToNaturalSvi(parameters),
      jumpWings: rawToJumpWings(parameters, points[0].maturity),
      ...metrics, objective: best.objective, iterations: best.iterations,
      totalVariance: (logMoneyness) => Math.max(rawSviTotalVariance(logMoneyness, parameters), 1e-12),
    };
  }

  function interpolateAtMoney(points) {
    const sorted = points.slice().sort((first, second) => first.logMoneyness - second.logMoneyness);
    const xs = sorted.map((point) => point.logMoneyness);
    const ys = sorted.map((point) => point.totalVariance);
    return Math.max(interpolateLinear(xs, ys, 0, "flat"), 1e-12);
  }

  function fitSsvi(points, options = {}) {
    const groups = new Map();
    points.forEach((point) => {
      if (!groups.has(point.maturity)) groups.set(point.maturity, []);
      groups.get(point.maturity).push(point);
    });
    if (groups.size < 2 || points.length < 8) {
      throw new Error("SSVI calibration requires at least two expiries and eight quotes.");
    }
    const thetaNodes = [...groups.entries()].sort((first, second) => first[0] - second[0])
      .map(([maturity, slice]) => ({ maturity, totalVariance: interpolateAtMoney(slice) }));
    const thetaCurve = buildTermStructure(thetaNodes.map((node) => ({
      maturity: node.maturity,
      totalVariance: node.totalVariance,
      volatility: Math.sqrt(node.totalVariance / node.maturity),
    })), options.termMethod || "pchip-total-variance", true);
    const bounds = [[-0.999, 0.999], [0.001, 5], [0, 1]];
    const objective = (values) => {
      const parameters = { rho: values[0], eta: values[1], gamma: values[2] };
      let loss = 0;
      for (const point of points) {
        const theta = thetaCurve.totalVariance(point.maturity);
        const error = ssviTotalVariance(point.logMoneyness, theta, parameters) - point.totalVariance;
        loss += Number(point.weight ?? 1) * error ** 2;
        const phi = ssviPhi(theta, parameters);
        const firstCondition = theta * phi * (1 + Math.abs(parameters.rho));
        const secondCondition = theta * phi ** 2 * (1 + Math.abs(parameters.rho));
        if (firstCondition > 4) loss += (firstCondition - 4) ** 2 * 10;
        if (secondCondition > 4) loss += (secondCondition - 4) ** 2 * 10;
      }
      return loss;
    };
    const starts = [[-0.5, 0.8, 0.5], [0, 0.5, 0.25], [0.5, 0.8, 0.5], [-0.8, 1.2, 0.8]];
    let best = null;
    starts.forEach((start) => {
      const result = nelderMead(objective, start, bounds, options);
      if (!best || result.objective < best.objective) best = result;
    });
    const parameters = { rho: best.parameters[0], eta: best.parameters[1], gamma: best.parameters[2] };
    const totalVariance = (maturity, logMoneyness) => ssviTotalVariance(
      logMoneyness, thetaCurve.totalVariance(maturity), parameters,
    );
    const metrics = errorMetrics(points,
      (point) => totalVariance(point.maturity, point.logMoneyness));
    return { method: "ssvi", parameters, thetaCurve, thetaNodes, ...metrics,
      objective: best.objective, iterations: best.iterations, totalVariance };
  }

  function sabrLognormalVolatility(forward, strike, maturity, parameters) {
    const alpha = Math.max(parameters.alpha, 1e-12);
    const beta = parameters.beta;
    const rho = clamp(parameters.rho, -0.999999, 0.999999);
    const nu = Math.max(parameters.nu, 0);
    const oneMinusBeta = 1 - beta;
    const forwardStrike = forward * strike;
    const geometricPower = forwardStrike ** (0.5 * oneMinusBeta);
    const correction = 1 + (
      oneMinusBeta ** 2 * alpha ** 2 / (24 * forwardStrike ** oneMinusBeta) +
      rho * beta * nu * alpha / (4 * geometricPower) +
      (2 - 3 * rho ** 2) * nu ** 2 / 24
    ) * maturity;
    const logRatio = Math.log(forward / strike);
    if (Math.abs(logRatio) < 1e-10) {
      return alpha / forward ** oneMinusBeta * (
        1 + (
          oneMinusBeta ** 2 * alpha ** 2 / (24 * forward ** (2 * oneMinusBeta)) +
          rho * beta * nu * alpha / (4 * forward ** oneMinusBeta) +
          (2 - 3 * rho ** 2) * nu ** 2 / 24
        ) * maturity
      );
    }
    const z = nu / alpha * geometricPower * logRatio;
    let zOverX = 1;
    if (Math.abs(z) > 1e-8) {
      const numerator = Math.sqrt(Math.max(1 - 2 * rho * z + z ** 2, 1e-16)) + z - rho;
      const x = Math.log(Math.max(numerator / (1 - rho), 1e-16));
      zOverX = z / x;
    } else zOverX = 1 - 0.5 * rho * z + (2 - 3 * rho ** 2) * z ** 2 / 12;
    const denominator = geometricPower * (
      1 + oneMinusBeta ** 2 * logRatio ** 2 / 24 +
      oneMinusBeta ** 4 * logRatio ** 4 / 1920
    );
    return alpha / denominator * zOverX * correction;
  }

  function fitSabr(points, forward, beta = 0.5, options = {}) {
    if (points.length < 3) throw new Error("SABR calibration requires at least three quotes.");
    const atmVariance = interpolateAtMoney(points);
    const atmVolatility = Math.sqrt(atmVariance / points[0].maturity);
    const initialAlpha = atmVolatility * forward ** (1 - beta);
    const bounds = [[1e-6, Math.max(initialAlpha * 5, 3)], [-0.999, 0.999], [0, 5]];
    const objective = (values) => points.reduce((sum, point) => {
      const model = sabrLognormalVolatility(forward, point.strike, point.maturity, {
        alpha: values[0], beta, rho: values[1], nu: values[2],
      });
      const error = model - point.impliedVolatility;
      return sum + Number(point.weight ?? 1) * error ** 2;
    }, 0);
    const starts = [
      [initialAlpha, -0.3, 0.5], [initialAlpha, 0.3, 0.5],
      [initialAlpha * 0.8, -0.7, 1], [initialAlpha * 1.2, 0, 0.2],
    ];
    let best = null;
    starts.forEach((start) => {
      const result = nelderMead(objective, start, bounds, options);
      if (!best || result.objective < best.objective) best = result;
    });
    const parameters = { alpha: best.parameters[0], beta, rho: best.parameters[1], nu: best.parameters[2] };
    const volatility = (strike) => sabrLognormalVolatility(
      forward, strike, points[0].maturity, parameters,
    );
    const metrics = errorMetrics(points, (point) => volatility(point.strike), "impliedVolatility");
    return { method: "sabr", parameters, ...metrics, objective: best.objective,
      iterations: best.iterations, volatility,
      totalVariance: (logMoneyness) => volatility(forward * Math.exp(logMoneyness)) ** 2 *
        points[0].maturity };
  }

  function solveLinearSystem(matrixInput, rightInput) {
    const count = rightInput.length;
    const matrix = matrixInput.map((row, index) => [...row, rightInput[index]]);
    for (let column = 0; column < count; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < count; row += 1) {
        if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
      }
      if (Math.abs(matrix[pivot][column]) < 1e-14) throw new Error("Calibration system is singular.");
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
      const divisor = matrix[column][column];
      for (let entry = column; entry <= count; entry += 1) matrix[column][entry] /= divisor;
      for (let row = 0; row < count; row += 1) {
        if (row === column) continue;
        const factor = matrix[row][column];
        for (let entry = column; entry <= count; entry += 1) {
          matrix[row][entry] -= factor * matrix[column][entry];
        }
      }
    }
    return matrix.map((row) => row[count]);
  }

  function blackScholesVolGreeks(market, volatility) {
    const rootT = Math.sqrt(market.maturity);
    const d1 = (Math.log(market.spot / market.strike) +
      ((market.rate || 0) - (market.dividendYield || 0) + 0.5 * volatility ** 2) *
      market.maturity) / (volatility * rootT);
    const d2 = d1 - volatility * rootT;
    const vega = blackScholesVega(market, volatility);
    return {
      vega,
      vanna: -vega * d2 / (market.spot * volatility * rootT),
      volga: vega * d1 * d2 / volatility,
    };
  }

  function buildVannaVolgaSmile(points, market) {
    if (points.length < 3) throw new Error("Vanna-Volga requires at least three smile anchors.");
    const sorted = points.slice().sort((first, second) => first.strike - second.strike);
    const atmIndex = sorted.reduce((best, point, index) =>
      Math.abs(point.logMoneyness) < Math.abs(sorted[best].logMoneyness) ? index : best, 0);
    const anchors = [sorted[0], sorted[atmIndex], sorted.at(-1)];
    if (new Set(anchors.map((anchor) => anchor.strike)).size !== 3) {
      throw new Error("Vanna-Volga requires distinct low, ATM, and high strikes.");
    }
    const atmVolatility = anchors[1].impliedVolatility;
    const anchorGreeks = anchors.map((anchor) => blackScholesVolGreeks({
      ...market, strike: anchor.strike, maturity: anchor.maturity,
    }, atmVolatility));
    const greekMatrix = [
      anchorGreeks.map((greeks) => greeks.vega),
      anchorGreeks.map((greeks) => greeks.vanna),
      anchorGreeks.map((greeks) => greeks.volga),
    ];
    const corrections = anchors.map((anchor) => {
      const anchorMarket = { ...market, strike: anchor.strike, maturity: anchor.maturity };
      return blackScholesPrice(anchorMarket, anchor.impliedVolatility, "call") -
        blackScholesPrice(anchorMarket, atmVolatility, "call");
    });
    const price = (strike) => {
      const target = { ...market, strike, maturity: anchors[0].maturity };
      const greeks = blackScholesVolGreeks(target, atmVolatility);
      const weights = solveLinearSystem(greekMatrix,
        [greeks.vega, greeks.vanna, greeks.volga]);
      const flatPrice = blackScholesPrice(target, atmVolatility, "call");
      const bounds = blackScholesBounds(target, "call");
      return clamp(flatPrice + weights.reduce((sum, weight, index) =>
        sum + weight * corrections[index], 0), bounds.lower, bounds.upper);
    };
    const volatility = (strike) => impliedVolatility({
      ...market, strike, maturity: anchors[0].maturity,
    }, price(strike), "call").volatility;
    const metrics = errorMetrics(points, (point) => volatility(point.strike), "impliedVolatility");
    return {
      method: "vanna-volga", parameters: { atmVolatility, anchorStrikes: anchors.map((a) => a.strike) },
      anchors, ...metrics, price, volatility,
      totalVariance: (logMoneyness) => volatility(
        market.forward * Math.exp(logMoneyness),
      ) ** 2 * anchors[0].maturity,
    };
  }

  function weightedLinearRegression(rows, targets, weights, ridge = 1e-12) {
    const dimension = rows[0].length;
    const normal = Array.from({ length: dimension }, () => new Array(dimension).fill(0));
    const right = new Array(dimension).fill(0);
    rows.forEach((row, observation) => {
      const weight = Number(weights[observation] ?? 1);
      for (let first = 0; first < dimension; first += 1) {
        right[first] += weight * row[first] * targets[observation];
        for (let second = 0; second < dimension; second += 1) {
          normal[first][second] += weight * row[first] * row[second];
        }
      }
    });
    for (let index = 0; index < dimension; index += 1) normal[index][index] += ridge;
    return solveLinearSystem(normal, right);
  }

  function dumasFeatures(logMoneyness, maturity) {
    return [1, logMoneyness, logMoneyness ** 2, maturity,
      logMoneyness * maturity, maturity ** 2];
  }

  function fitDumas(points) {
    if (points.length < 6) throw new Error("Dumas calibration requires at least six quotes.");
    const coefficients = weightedLinearRegression(
      points.map((point) => dumasFeatures(point.logMoneyness, point.maturity)),
      points.map((point) => point.impliedVolatility),
      points.map((point) => point.weight ?? 1),
      1e-10,
    );
    const volatility = (maturity, logMoneyness) => Math.max(
      dumasFeatures(logMoneyness, maturity).reduce((sum, value, index) =>
        sum + value * coefficients[index], 0), 1e-6,
    );
    const metrics = errorMetrics(points,
      (point) => volatility(point.maturity, point.logMoneyness), "impliedVolatility");
    return { method: "dumas", parameters: { coefficients }, ...metrics, volatility,
      totalVariance: (maturity, logMoneyness) => volatility(maturity, logMoneyness) ** 2 * maturity };
  }

  function buildPchipSmile(points) {
    const sorted = points.slice().sort((first, second) => first.logMoneyness - second.logMoneyness);
    const curve = buildPchip(
      sorted.map((point) => point.logMoneyness),
      sorted.map((point) => point.totalVariance),
      "linear",
    );
    const totalVariance = (logMoneyness) => Math.max(curve.evaluate(logMoneyness), 1e-12);
    const metrics = errorMetrics(points, (point) => totalVariance(point.logMoneyness));
    return { method: "pchip-variance", parameters: { nodes: sorted.length }, ...metrics,
      curve, totalVariance };
  }

  function buildConvexCallSmile(points, market) {
    if (points.length < 3) throw new Error("Constrained convex interpolation requires three quotes.");
    const sorted = points.slice().sort((first, second) => first.strike - second.strike);
    const strikes = sorted.map((point) => point.strike);
    const observed = sorted.map((point) => blackScholesPrice({
      ...market, strike: point.strike, maturity: point.maturity,
    }, point.impliedVolatility, "call"));
    const widths = strikes.slice(1).map((strike, index) => strike - strikes[index]);
    const rawSlopes = widths.map((width, index) => (observed[index + 1] - observed[index]) / width);
    const discount = Math.exp(-(market.rate || 0) * sorted[0].maturity);
    const slopes = pava(rawSlopes.map((slope) => clamp(slope, -discount, 0)), widths, true)
      .map((slope) => clamp(slope, -discount, 0));
    const cumulative = [0];
    for (let index = 0; index < slopes.length; index += 1) {
      cumulative.push(cumulative[index] + slopes[index] * widths[index]);
    }
    const desiredOffset = observed.reduce((sum, value, index) => sum + value - cumulative[index], 0) /
      observed.length;
    let lowerOffset = -Infinity;
    let upperOffset = Infinity;
    sorted.forEach((point, index) => {
      const bounds = blackScholesBounds({ ...market, strike: point.strike,
        maturity: point.maturity }, "call");
      lowerOffset = Math.max(lowerOffset, bounds.lower - cumulative[index]);
      upperOffset = Math.min(upperOffset, bounds.upper - cumulative[index]);
    });
    const offset = clamp(desiredOffset, lowerOffset, upperOffset);
    const fittedPrices = cumulative.map((value) => value + offset);
    const price = (strike) => {
      const targetMarket = { ...market, strike, maturity: sorted[0].maturity };
      const bounds = blackScholesBounds(targetMarket, "call");
      let candidate;
      if (strike <= strikes[0]) candidate = fittedPrices[0] + slopes[0] * (strike - strikes[0]);
      else if (strike >= strikes.at(-1)) candidate = fittedPrices.at(-1) + slopes.at(-1) *
        (strike - strikes.at(-1));
      else candidate = interpolateLinear(strikes, fittedPrices, strike);
      return clamp(candidate, bounds.lower, bounds.upper);
    };
    const volatility = (strike) => impliedVolatility({
      ...market, strike, maturity: sorted[0].maturity,
    }, price(strike), "call").volatility;
    const metrics = errorMetrics(points, (point) => volatility(point.strike), "impliedVolatility");
    return {
      method: "convex-call",
      parameters: { nodes: sorted.length, slopes, maxNodePriceAdjustment: Math.max(
        ...observed.map((value, index) => Math.abs(value - fittedPrices[index])),
      ) },
      strikes, fittedPrices, slopes, ...metrics, price, volatility,
      totalVariance: (logMoneyness) => volatility(
        market.forward * Math.exp(logMoneyness),
      ) ** 2 * sorted[0].maturity,
    };
  }

  function cviKnotVector(knots) {
    if (knots.length < 5) throw new Error("CVI requires at least five variance knots.");
    return [knots[0], knots[0], knots[0], knots[0],
      ...knots.slice(1, -1),
      knots.at(-1), knots.at(-1), knots.at(-1), knots.at(-1)];
  }

  function bsplineValue(index, degree, derivative, point, knotVector, lastPoint) {
    if (derivative > degree) return 0;
    if (derivative > 0) {
      const leftDenominator = knotVector[index + degree] - knotVector[index];
      const rightDenominator = knotVector[index + degree + 1] - knotVector[index + 1];
      const left = leftDenominator > 0
        ? degree / leftDenominator * bsplineValue(
          index, degree - 1, derivative - 1, point, knotVector, lastPoint,
        ) : 0;
      const right = rightDenominator > 0
        ? degree / rightDenominator * bsplineValue(
          index + 1, degree - 1, derivative - 1, point, knotVector, lastPoint,
        ) : 0;
      return left - right;
    }
    if (degree === 0) {
      return (point >= knotVector[index] && point < knotVector[index + 1]) ||
        (point === lastPoint && knotVector[index + 1] === lastPoint &&
          knotVector[index] < lastPoint) ? 1 : 0;
    }
    const leftDenominator = knotVector[index + degree] - knotVector[index];
    const rightDenominator = knotVector[index + degree + 1] - knotVector[index + 1];
    const left = leftDenominator > 0
      ? (point - knotVector[index]) / leftDenominator * bsplineValue(
        index, degree - 1, 0, point, knotVector, lastPoint,
      ) : 0;
    const right = rightDenominator > 0
      ? (knotVector[index + degree + 1] - point) / rightDenominator * bsplineValue(
        index + 1, degree - 1, 0, point, knotVector, lastPoint,
      ) : 0;
    return left + right;
  }

  function cviBasisVector(normalizedMoneyness, knots, derivative = 0) {
    const first = knots[0];
    const last = knots.at(-1);
    const knotVector = cviKnotVector(knots);
    const basisCount = knots.length + 2;
    const inside = (point, order) => Array.from({ length: basisCount }, (_, index) =>
      bsplineValue(index, 3, order, point, knotVector, last));
    if (normalizedMoneyness < first || normalizedMoneyness > last) {
      if (derivative >= 2) return new Array(basisCount).fill(0);
      const edge = normalizedMoneyness < first ? first : last;
      const value = inside(edge, 0);
      const slope = inside(edge, 1);
      if (derivative === 1) return slope;
      return value.map((entry, index) => entry +
        (normalizedMoneyness - edge) * slope[index]);
    }
    return inside(normalizedMoneyness, derivative);
  }

  function dot(first, second) {
    let result = 0;
    for (let index = 0; index < first.length; index += 1) result += first[index] * second[index];
    return result;
  }

  function choleskyFactor(matrix) {
    const size = matrix.length;
    const lower = Array.from({ length: size }, () => new Float64Array(size));
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column <= row; column += 1) {
        let value = matrix[row][column];
        for (let inner = 0; inner < column; inner += 1) {
          value -= lower[row][inner] * lower[column][inner];
        }
        if (row === column) {
          if (!(value > 1e-16)) throw new Error("CVI quadratic system is not positive definite.");
          lower[row][column] = Math.sqrt(value);
        } else lower[row][column] = value / lower[column][column];
      }
    }
    return lower;
  }

  function choleskySolve(lower, right) {
    const size = right.length;
    const intermediate = new Float64Array(size);
    const result = new Float64Array(size);
    for (let row = 0; row < size; row += 1) {
      let value = right[row];
      for (let column = 0; column < row; column += 1) value -= lower[row][column] * intermediate[column];
      intermediate[row] = value / lower[row][row];
    }
    for (let row = size - 1; row >= 0; row -= 1) {
      let value = intermediate[row];
      for (let column = row + 1; column < size; column += 1) {
        value -= lower[column][row] * result[column];
      }
      result[row] = value / lower[row][row];
    }
    return Array.from(result);
  }

  function solveCviQuadraticProgram(hessianInput, linearInput, constraintsInput, options = {}) {
    const size = linearInput.length;
    const rho = Number(options.rho ?? 4);
    const maximumIterations = Math.trunc(Number(options.maximumIterations ?? 2400));
    const tolerance = Number(options.tolerance ?? 2e-8);
    const constraints = constraintsInput.map((constraint) => {
      const norm = Math.sqrt(Math.max(dot(constraint.row, constraint.row), 1e-24));
      return { row: constraint.row.map((value) => value / norm), bound: constraint.bound / norm };
    });
    const hessian = hessianInput.map((row, index) => row.map((value, column) =>
      value + (index === column ? 1e-10 : 0)));
    constraints.forEach((constraint) => {
      for (let first = 0; first < size; first += 1) {
        if (constraint.row[first] === 0) continue;
        for (let second = 0; second < size; second += 1) {
          hessian[first][second] += rho * constraint.row[first] * constraint.row[second];
        }
      }
    });
    const factor = choleskyFactor(hessian);
    let solution = options.initial ? Array.from(options.initial) : new Array(size).fill(0);
    let projected = constraints.map((constraint) => Math.max(constraint.bound,
      dot(constraint.row, solution)));
    const dual = new Array(constraints.length).fill(0);
    let primalResidual = Infinity;
    let dualResidual = Infinity;
    let iteration = 0;
    for (; iteration < maximumIterations; iteration += 1) {
      const right = linearInput.map((value) => -value);
      constraints.forEach((constraint, row) => {
        const multiplier = rho * (projected[row] - dual[row]);
        for (let column = 0; column < size; column += 1) {
          right[column] += multiplier * constraint.row[column];
        }
      });
      solution = choleskySolve(factor, right);
      const previousProjected = projected.slice();
      const mapped = constraints.map((constraint) => dot(constraint.row, solution));
      projected = mapped.map((value, row) => Math.max(constraints[row].bound, value + dual[row]));
      for (let row = 0; row < constraints.length; row += 1) dual[row] += mapped[row] - projected[row];
      primalResidual = mapped.reduce((maximum, value, row) =>
        Math.max(maximum, Math.abs(value - projected[row])), 0);
      const projectedChange = projected.map((value, row) => value - previousProjected[row]);
      const dualVector = new Array(size).fill(0);
      constraints.forEach((constraint, row) => {
        for (let column = 0; column < size; column += 1) {
          dualVector[column] += rho * constraint.row[column] * projectedChange[row];
        }
      });
      dualResidual = Math.max(...dualVector.map(Math.abs), 0);
      if (primalResidual <= tolerance && dualResidual <= tolerance) break;
    }
    const maximumViolation = constraints.reduce((maximum, constraint) =>
      Math.max(maximum, constraint.bound - dot(constraint.row, solution)), 0);
    return { solution, iterations: Math.min(iteration + 1, maximumIterations),
      primalResidual, dualResidual, maximumViolation,
      converged: maximumViolation <= Math.max(tolerance * 10, 2e-6) };
  }

  function addQuadraticPenalty(hessian, linear, row, target, weight) {
    for (let first = 0; first < row.length; first += 1) {
      if (row[first] === 0) continue;
      linear[first] -= 2 * weight * target * row[first];
      for (let second = 0; second < row.length; second += 1) {
        if (row[second] !== 0) hessian[first][second] += 2 * weight * row[first] * row[second];
      }
    }
  }

  function fitCviSurface(points, options = {}) {
    const groups = new Map();
    points.forEach((point) => {
      if (!groups.has(point.maturity)) groups.set(point.maturity, []);
      groups.get(point.maturity).push(point);
    });
    const maturities = [...groups.keys()].sort((first, second) => first - second);
    if (maturities.length < 2 || points.length < 10) {
      throw new Error("CVI calibration requires at least two expiries and ten quotes.");
    }
    let knotCount = Math.trunc(Number(options.cviKnots ?? 13));
    knotCount = clamp(knotCount, 5, 21);
    if (knotCount % 2 === 0) knotCount += 1;
    const anchors = maturities.map((maturity) => {
      const totalVariance = interpolateAtMoney(groups.get(maturity));
      return { maturity, totalVariance,
        volatility: Math.sqrt(totalVariance / maturity), scale: Math.sqrt(totalVariance) };
    });
    const anchorByMaturity = new Map(anchors.map((anchor) => [anchor.maturity, anchor]));
    const maximumObservedZ = Math.max(...points.map((point) => Math.abs(
      point.logMoneyness / anchorByMaturity.get(point.maturity).scale,
    )));
    const knotRange = Math.max(3.5, maximumObservedZ * 1.15);
    const knots = Array.from({ length: knotCount }, (_, index) =>
      -knotRange + 2 * knotRange * index / (knotCount - 1));
    knots[(knotCount - 1) / 2] = 0;
    const basisCount = knotCount + 2;
    const variableCount = basisCount * maturities.length;
    const sliceIndex = new Map(maturities.map((maturity, index) => [maturity, index]));
    const embeddedBasis = (maturity, logMoneyness, derivative = 0) => {
      const anchor = anchorByMaturity.get(maturity);
      const local = cviBasisVector(logMoneyness / anchor.scale, knots, derivative);
      const row = new Array(variableCount).fill(0);
      const offset = sliceIndex.get(maturity) * basisCount;
      local.forEach((value, index) => { row[offset + index] = value; });
      return row;
    };
    const pillarTotalVarianceBasis = (maturity, logMoneyness, derivative = 0) => {
      const anchor = anchorByMaturity.get(maturity);
      return embeddedBasis(maturity, logMoneyness, derivative).map((value) =>
        maturity * value / anchor.scale ** derivative);
    };
    const interpolatedTotalVarianceBasis = (maturity, logMoneyness, derivative = 0) => {
      const time = Math.max(Number(maturity), 1e-10);
      if (time <= maturities[0]) {
        const anchor = anchorByMaturity.get(maturities[0]);
        return embeddedBasis(maturities[0], logMoneyness, derivative).map((value) =>
          time * value / anchor.scale ** derivative);
      }
      let lower = maturities.length - 2;
      for (let index = 0; index < maturities.length - 1; index += 1) {
        if (time <= maturities[index + 1]) { lower = index; break; }
      }
      const earlier = maturities[lower];
      const later = maturities[lower + 1];
      const weight = (time - earlier) / (later - earlier);
      const earlierRow = pillarTotalVarianceBasis(earlier, logMoneyness, derivative);
      const laterRow = pillarTotalVarianceBasis(later, logMoneyness, derivative);
      return earlierRow.map((value, index) => value * (1 - weight) + laterRow[index] * weight);
    };
    const normalizedWeights = new Map();
    maturities.forEach((maturity) => {
      const slice = groups.get(maturity);
      const raw = slice.map((point) => {
        if (point.bidVolatility > 0 && point.askVolatility > point.bidVolatility) {
          const spread = point.askVolatility ** 2 - point.bidVolatility ** 2;
          return Number(point.weight ?? 1) / Math.max(spread ** 2, 1e-10);
        }
        return Number(point.weight ?? 1);
      });
      const average = raw.reduce((sum, value) => sum + value, 0) / Math.max(raw.length, 1);
      slice.forEach((point, index) => normalizedWeights.set(point, raw[index] / Math.max(average, 1e-12)));
    });

    const buildObjective = (reference = null) => {
      const hessian = Array.from({ length: variableCount }, () => new Array(variableCount).fill(0));
      const linear = new Array(variableCount).fill(0);
      points.forEach((point) => {
        const row = embeddedBasis(point.maturity, point.logMoneyness);
        const weight = normalizedWeights.get(point) / groups.get(point.maturity).length;
        addQuadraticPenalty(hessian, linear, row, point.impliedVolatility ** 2, weight);
        if (reference) {
          const fitted = dot(row, reference);
          const bidVariance = point.bidVolatility > 0 ? point.bidVolatility ** 2 : null;
          const askVariance = point.askVolatility > 0 ? point.askVolatility ** 2 : null;
          if (bidVariance !== null && fitted < bidVariance) {
            addQuadraticPenalty(hessian, linear, row, bidVariance, weight);
          }
          if (askVariance !== null && fitted > askVariance) {
            addQuadraticPenalty(hessian, linear, row, askVariance, weight);
          }
        }
      });
      const regularization = Number(options.cviRegularization ?? 0.05);
      maturities.forEach((maturity) => {
        const anchorVariance = anchorByMaturity.get(maturity).volatility ** 2;
        for (let index = 0; index < knots.length - 1; index += 1) {
          const first = embeddedBasis(maturity, knots[index] *
            anchorByMaturity.get(maturity).scale, 2);
          const second = embeddedBasis(maturity, knots[index + 1] *
            anchorByMaturity.get(maturity).scale, 2);
          const difference = first.map((value, column) =>
            (second[column] - value) / Math.max(anchorVariance, 1e-12));
          const referenceDifference = reference ? Math.abs(dot(difference, reference)) : 1;
          const irlsWeight = 1 / Math.sqrt(referenceDifference ** 2 + 1e-4);
          addQuadraticPenalty(hessian, linear, difference, 0,
            regularization * 2e-5 * irlsWeight / Math.max(maturities.length, 1));
        }
      });
      for (let index = 0; index < variableCount; index += 1) hessian[index][index] += 1e-8;
      return { hessian, linear };
    };

    const baseConstraints = [];
    const addConstraint = (row, bound) => baseConstraints.push({ row, bound });
    const constraintZ = Array.from({ length: Math.max(25, knotCount * 2 - 1) }, (_, index) =>
      -knotRange + 2 * knotRange * index / Math.max(Math.max(25, knotCount * 2 - 1) - 1, 1));
    maturities.forEach((maturity) => {
      const anchor = anchorByMaturity.get(maturity);
      constraintZ.forEach((z) => addConstraint(
        embeddedBasis(maturity, z * anchor.scale), 1e-8,
      ));
      const leftFirst = embeddedBasis(maturity, knots[0] * anchor.scale, 1);
      const rightFirst = embeddedBasis(maturity, knots.at(-1) * anchor.scale, 1);
      const leftSecond = embeddedBasis(maturity, knots[0] * anchor.scale, 2);
      const rightSecond = embeddedBasis(maturity, knots.at(-1) * anchor.scale, 2);
      addConstraint(leftSecond, -1e-8);
      addConstraint(leftSecond.map((value) => -value), -1e-8);
      addConstraint(rightSecond, -1e-8);
      addConstraint(rightSecond.map((value) => -value), -1e-8);
      addConstraint(leftFirst.map((value) => -value), 0);
      addConstraint(rightFirst, 0);
      const derivativeLimit = 1.98 * anchor.volatility / Math.sqrt(maturity);
      addConstraint(leftFirst, -derivativeLimit);
      addConstraint(rightFirst.map((value) => -value), -derivativeLimit);
    });
    const maximumObservedK = Math.max(0.5, ...points.map((point) => Math.abs(point.logMoneyness)));
    const calendarK = Array.from({ length: 31 }, (_, index) =>
      -maximumObservedK * 1.15 + 2 * maximumObservedK * 1.15 * index / 30);
    for (let expiry = 0; expiry < maturities.length - 1; expiry += 1) {
      const earlier = maturities[expiry];
      const later = maturities[expiry + 1];
      calendarK.forEach((logMoneyness) => {
        const earlierRow = embeddedBasis(earlier, logMoneyness);
        const laterRow = embeddedBasis(later, logMoneyness);
        addConstraint(laterRow.map((value, index) =>
          later * value - earlier * earlierRow[index]), 0);
      });
    }

    const firstObjective = buildObjective();
    let solver = solveCviQuadraticProgram(
      firstObjective.hessian, firstObjective.linear, baseConstraints, options,
    );
    let weights = solver.solution;
    const totalIterations = Math.max(5, Math.trunc(Number(options.cviIterations ?? 5)));
    const butterflyFloor = Math.max(Number(options.cviButterflyFloor ?? 0.05), 1e-7);
    const firstDiagnosticMaturity = Math.max(maturities[0] * 0.5, 1e-4);
    const lastDiagnosticMaturity = maturities.at(-1) * 1.05;
    const intermediateMaturities = Array.from({ length: 8 }, (_, index) =>
      firstDiagnosticMaturity + (lastDiagnosticMaturity - firstDiagnosticMaturity) * index / 7);
    const butterflyMaturities = [...new Set([...maturities, ...intermediateMaturities])]
      .sort((first, second) => first - second);
    let butterflyConstraintCount = 0;
    for (let outer = 1; outer < totalIterations; outer += 1) {
      const constraints = baseConstraints.slice();
      butterflyConstraintCount = 0;
      butterflyMaturities.forEach((maturity) => {
        const maximumK = Math.max(0.45, maximumObservedK * 1.15);
        const samples = Math.max(41, Math.trunc(Number(options.cviButterflyPoints ?? 41)));
        for (let sample = 0; sample < samples; sample += 1) {
          const k = -maximumK + 2 * maximumK * sample / Math.max(samples - 1, 1);
          const wRow = interpolatedTotalVarianceBasis(maturity, k);
          const firstRow = interpolatedTotalVarianceBasis(maturity, k, 1);
          const secondRow = interpolatedTotalVarianceBasis(maturity, k, 2);
          const w = Math.max(dot(wRow, weights), 1e-10);
          const first = dot(firstRow, weights);
          const second = dot(secondRow, weights);
          const referenceG = butterflyFunction(w, first, second, k);
          const hW = Math.max(w * 1e-5, 1e-8);
          const hFirst = Math.max(Math.abs(first) * 1e-5, 1e-7);
          const gradientW = (butterflyFunction(w + hW, first, second, k) -
            butterflyFunction(Math.max(w - hW, 1e-12), first, second, k)) / (2 * hW);
          const gradientFirst = (butterflyFunction(w, first + hFirst, second, k) -
            butterflyFunction(w, first - hFirst, second, k)) / (2 * hFirst);
          const gradientSecond = 0.5;
          const gradient = wRow.map((value, index) => gradientW * value +
            gradientFirst * firstRow[index] + gradientSecond * secondRow[index]);
          const bound = butterflyFloor - referenceG + dot(gradient, weights);
          constraints.push({ row: gradient, bound });
          butterflyConstraintCount += 1;
        }
      });
      const objective = buildObjective(weights);
      solver = solveCviQuadraticProgram(objective.hessian, objective.linear, constraints,
        { ...options, initial: weights });
      weights = solver.solution;
    }

    const varianceAtListedMaturity = (maturity, logMoneyness) => Math.max(
      dot(embeddedBasis(maturity, logMoneyness), weights), 1e-12,
    );
    // The joint CVI constraints are expressed on affine combinations of expiry
    // total variances. Keep that same interpolation in the returned surface so
    // the constrained intermediate smiles and the evaluated smiles coincide.
    const termMethod = "linear-total-variance";
    const totalVariance = (maturity, logMoneyness) => {
      const pillars = maturities.map((time) => ({
        maturity: time,
        totalVariance: varianceAtListedMaturity(time, logMoneyness) * time,
        volatility: Math.sqrt(varianceAtListedMaturity(time, logMoneyness)),
      }));
      return buildTermStructure(pillars, termMethod, true).totalVariance(maturity);
    };
    const metrics = errorMetrics(points, (point) =>
      varianceAtListedMaturity(point.maturity, point.logMoneyness) * point.maturity);
    return {
      method: "cvi", parameters: {
        knots, knotCount, regularization: Number(options.cviRegularization ?? 0.05),
        termMethod,
        outerIterations: totalIterations, qpIterations: solver.iterations,
        maximumConstraintViolation: solver.maximumViolation,
        butterflyConstraintCount,
      }, anchors, maturities, basisCount, weights, solver, ...metrics,
      varianceAtListedMaturity, totalVariance,
    };
  }

  function parseMarketQuotes(text, market) {
    const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error("Quote data requires a header and at least one row.");
    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const headers = lines[0].split(delimiter).map((header) => header.trim().toLowerCase());
    const indexOf = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
    const maturityIndex = indexOf("maturity", "tenor", "t");
    const strikeIndex = indexOf("strike", "k");
    const volatilityIndex = indexOf("iv", "vol", "volatility", "impliedvolatility");
    const priceIndex = indexOf("price", "optionprice", "premium");
    const typeIndex = indexOf("type", "optiontype");
    const weightIndex = indexOf("weight", "vegaweight");
    const bidVolatilityIndex = indexOf("bidiv", "bidvol", "bidvolatility");
    const askVolatilityIndex = indexOf("askiv", "askvol", "askvolatility");
    if (maturityIndex < 0 || strikeIndex < 0 || (volatilityIndex < 0 && priceIndex < 0 &&
      (bidVolatilityIndex < 0 || askVolatilityIndex < 0))) {
      throw new Error("Quote columns must include maturity, strike, and iv, price, or bidiv/askiv.");
    }
    return lines.slice(1).map((line, rowIndex) => {
      const values = line.split(delimiter).map((value) => value.trim());
      const maturity = Number(values[maturityIndex]);
      const strike = Number(values[strikeIndex]);
      const optionType = typeIndex >= 0 ? values[typeIndex].toLowerCase() : "call";
      let impliedVol = volatilityIndex >= 0 ? Number(values[volatilityIndex]) : null;
      let bidVolatility = bidVolatilityIndex >= 0 ? Number(values[bidVolatilityIndex]) : null;
      let askVolatility = askVolatilityIndex >= 0 ? Number(values[askVolatilityIndex]) : null;
      if (impliedVol !== null && impliedVol > 3) impliedVol /= 100;
      if (bidVolatility !== null && bidVolatility > 3) bidVolatility /= 100;
      if (askVolatility !== null && askVolatility > 3) askVolatility /= 100;
      if ((impliedVol === null || !Number.isFinite(impliedVol)) && bidVolatility > 0 &&
        askVolatility >= bidVolatility) impliedVol = 0.5 * (bidVolatility + askVolatility);
      if (impliedVol === null || !Number.isFinite(impliedVol)) {
        impliedVol = impliedVolatility({ ...market, strike, maturity },
          Number(values[priceIndex]), optionType).volatility;
      }
      if (!(maturity > 0 && strike > 0 && impliedVol > 0)) {
        throw new Error(`Invalid quote on data row ${rowIndex + 2}.`);
      }
      const forward = market.spot * Math.exp(((market.rate || 0) -
        (market.dividendYield || 0)) * maturity);
      return {
        maturity, strike, optionType, impliedVolatility: impliedVol,
        totalVariance: impliedVol ** 2 * maturity,
        logMoneyness: Math.log(strike / forward),
        forward,
        weight: weightIndex >= 0 ? Math.max(Number(values[weightIndex]), 0) : 1,
        bidVolatility: bidVolatility > 0 ? bidVolatility : null,
        askVolatility: askVolatility > 0 ? askVolatility : null,
      };
    }).sort((first, second) => first.maturity - second.maturity || first.strike - second.strike);
  }

  function normalizeQuotes(quotes, market) {
    if (typeof quotes === "string") return parseMarketQuotes(quotes, market);
    return quotes.map((quote) => {
      const maturity = Number(quote.maturity);
      const strike = Number(quote.strike);
      const forward = market.spot * Math.exp(((market.rate || 0) -
        (market.dividendYield || 0)) * maturity);
      let impliedVol = Number(quote.impliedVolatility ?? quote.iv ?? quote.volatility);
      let bidVolatility = Number(quote.bidVolatility ?? quote.bidIv ?? quote.bidiv);
      let askVolatility = Number(quote.askVolatility ?? quote.askIv ?? quote.askiv);
      if (bidVolatility > 3) bidVolatility /= 100;
      if (askVolatility > 3) askVolatility /= 100;
      if (!Number.isFinite(impliedVol) && bidVolatility > 0 && askVolatility >= bidVolatility) {
        impliedVol = 0.5 * (bidVolatility + askVolatility);
      }
      if (!Number.isFinite(impliedVol) && Number.isFinite(Number(quote.price))) {
        impliedVol = impliedVolatility({ ...market, maturity, strike }, Number(quote.price),
          quote.optionType || "call").volatility;
      }
      return {
        ...quote, maturity, strike, forward, impliedVolatility: impliedVol,
        totalVariance: impliedVol ** 2 * maturity,
        logMoneyness: Math.log(strike / forward), weight: Number(quote.weight ?? 1),
        bidVolatility: bidVolatility > 0 ? bidVolatility : null,
        askVolatility: askVolatility > 0 ? askVolatility : null,
      };
    });
  }

  function calibrateSurface(quotesInput, options = {}) {
    const market = {
      spot: Number(options.spot ?? 100), rate: Number(options.rate ?? 0),
      dividendYield: Number(options.dividendYield ?? 0),
    };
    const method = options.method || "raw-svi";
    const termMethod = options.termMethod || "pchip-total-variance";
    if (!Object.hasOwn(FIT_METHODS, method)) throw new Error("Unknown volatility fitting method.");
    const quotes = normalizeQuotes(quotesInput, market);
    if (!quotes.length) throw new Error("At least one volatility quote is required.");
    const groups = new Map();
    quotes.forEach((quote) => {
      if (!groups.has(quote.maturity)) groups.set(quote.maturity, []);
      groups.get(quote.maturity).push(quote);
    });
    const maturities = [...groups.keys()].sort((first, second) => first - second);
    let globalFit = null;
    const sliceFits = new Map();
    if (method === "ssvi") globalFit = fitSsvi(quotes, { termMethod });
    else if (method === "dumas") globalFit = fitDumas(quotes);
    else if (method === "cvi") globalFit = fitCviSurface(quotes, { ...options, termMethod });
    else {
      maturities.forEach((maturity) => {
        const points = groups.get(maturity);
        const forward = points[0].forward;
        const sliceMarket = { ...market, maturity, forward };
        let fit;
        if (["raw-svi", "natural-svi", "svi-jw"].includes(method)) fit = fitRawSvi(points);
        else if (method === "sabr") fit = fitSabr(points, forward, Number(options.sabrBeta ?? 0.5));
        else if (method === "vanna-volga") fit = buildVannaVolgaSmile(points, sliceMarket);
        else if (method === "pchip-variance") fit = buildPchipSmile(points);
        else if (method === "convex-call") fit = buildConvexCallSmile(points, sliceMarket);
        else throw new Error(`Unsupported slice volatility method ${method}.`);
        fit.requestedMethod = method;
        sliceFits.set(maturity, fit);
      });
    }

    const sliceTotalVariance = (maturity, logMoneyness) => {
      if (["ssvi", "dumas", "cvi"].includes(method)) {
        return globalFit.totalVariance(maturity, logMoneyness);
      }
      return sliceFits.get(maturity).totalVariance(logMoneyness);
    };
    const totalVariance = (maturity, logMoneyness) => {
      if (!(maturity > 0)) throw new Error("Surface maturity must be positive.");
      if (["ssvi", "dumas", "cvi"].includes(method)) {
        return Math.max(globalFit.totalVariance(maturity, logMoneyness), 1e-12);
      }
      const pillars = maturities.map((time) => ({
        maturity: time,
        totalVariance: Math.max(sliceTotalVariance(time, logMoneyness), 1e-12),
        volatility: Math.sqrt(Math.max(sliceTotalVariance(time, logMoneyness), 1e-12) / time),
      }));
      return buildTermStructure(pillars, termMethod, options.repairCalendar !== false)
        .totalVariance(maturity);
    };
    const volatility = (maturity, strike) => {
      const forward = market.spot * Math.exp((market.rate - market.dividendYield) * maturity);
      const logMoneyness = Math.log(strike / forward);
      return Math.sqrt(totalVariance(maturity, logMoneyness) / maturity);
    };
    const fitRows = quotes.map((quote) => {
      const fittedVolatility = ["ssvi", "dumas", "cvi"].includes(method)
        ? Math.sqrt(globalFit.totalVariance(quote.maturity, quote.logMoneyness) / quote.maturity)
        : Math.sqrt(sliceTotalVariance(quote.maturity, quote.logMoneyness) / quote.maturity);
      return { ...quote, fittedVolatility, residual: fittedVolatility - quote.impliedVolatility };
    });
    const rmse = Math.sqrt(fitRows.reduce((sum, row) => sum + row.weight * row.residual ** 2, 0) /
      Math.max(fitRows.reduce((sum, row) => sum + row.weight, 0), 1e-14));
    const maximumError = Math.max(...fitRows.map((row) => Math.abs(row.residual)));
    const surface = {
      method, termMethod, market, quotes, maturities, sliceFits, globalFit,
      fitRows, rmse, maximumError, totalVariance, volatility,
    };
    surface.diagnostics = arbitrageDiagnostics(surface, options.diagnosticOptions);
    return surface;
  }

  function butterflyFunction(totalVariance, firstDerivative, secondDerivative, logMoneyness) {
    const variance = Math.max(totalVariance, 1e-12);
    return (1 - logMoneyness * firstDerivative / (2 * variance)) ** 2 -
      0.25 * firstDerivative ** 2 * (1 / variance + 0.25) + 0.5 * secondDerivative;
  }

  function surfaceDerivatives(surface, maturity, logMoneyness, options = {}) {
    const hK = Number(options.logMoneynessStep ?? 1e-3);
    const hT = Math.min(Number(options.maturityStep ?? Math.max(1e-4, maturity * 1e-3)), maturity * 0.49);
    const center = surface.totalVariance(maturity, logMoneyness);
    const left = surface.totalVariance(maturity, logMoneyness - hK);
    const right = surface.totalVariance(maturity, logMoneyness + hK);
    const earlierTime = Math.max(maturity - hT, 1e-8);
    const laterTime = maturity + hT;
    const earlier = surface.totalVariance(earlierTime, logMoneyness);
    const later = surface.totalVariance(laterTime, logMoneyness);
    return {
      totalVariance: center,
      strikeFirst: (right - left) / (2 * hK),
      strikeSecond: (right - 2 * center + left) / hK ** 2,
      timeFirst: (later - earlier) / (laterTime - earlierTime),
    };
  }

  function arbitrageDiagnostics(surface, options = {}) {
    const kMinimum = Number(options.logMoneynessMinimum ?? -0.45);
    const kMaximum = Number(options.logMoneynessMaximum ?? 0.45);
    const strikeSamples = Math.trunc(Number(options.strikeSamples ?? 61));
    const maturitySamples = Math.trunc(Number(options.maturitySamples ?? Math.max(8,
      surface.maturities.length * 4)));
    const firstMaturity = Math.max(surface.maturities[0] * 0.5, 1e-4);
    const lastMaturity = surface.maturities.at(-1) * 1.05;
    const maturities = Array.from({ length: maturitySamples }, (_, index) =>
      firstMaturity + (lastMaturity - firstMaturity) * index / Math.max(maturitySamples - 1, 1));
    const logMoneyness = Array.from({ length: strikeSamples }, (_, index) =>
      kMinimum + (kMaximum - kMinimum) * index / Math.max(strikeSamples - 1, 1));
    let minimumButterfly = Infinity;
    let minimumCalendarSlope = Infinity;
    let minimumButterflyLocation = null;
    let minimumCalendarLocation = null;
    let butterflyViolations = 0;
    let calendarViolations = 0;
    maturities.forEach((maturity) => {
      logMoneyness.forEach((k) => {
        const derivatives = surfaceDerivatives(surface, maturity, k);
        const butterfly = butterflyFunction(
          derivatives.totalVariance, derivatives.strikeFirst, derivatives.strikeSecond, k,
        );
        if (butterfly < minimumButterfly) {
          minimumButterfly = butterfly;
          minimumButterflyLocation = { maturity, logMoneyness: k };
        }
        if (butterfly < -1e-5) butterflyViolations += 1;
        if (derivatives.timeFirst < minimumCalendarSlope) {
          minimumCalendarSlope = derivatives.timeFirst;
          minimumCalendarLocation = { maturity, logMoneyness: k };
        }
        if (derivatives.timeFirst < -1e-7) calendarViolations += 1;
      });
    });
    return {
      butterflyViolations, calendarViolations,
      minimumButterfly, minimumCalendarSlope,
      minimumButterflyLocation, minimumCalendarLocation,
      sampleCount: maturities.length * logMoneyness.length,
      passed: butterflyViolations === 0 && calendarViolations === 0,
    };
  }

  function dupireLocalVolatility(surface, maturity, strike, options = {}) {
    const forward = surface.market.spot * Math.exp((surface.market.rate -
      surface.market.dividendYield) * maturity);
    const logMoneyness = Math.log(strike / forward);
    const derivatives = surfaceDerivatives(surface, maturity, logMoneyness, options);
    const denominator = butterflyFunction(
      derivatives.totalVariance, derivatives.strikeFirst,
      derivatives.strikeSecond, logMoneyness,
    );
    const localVariance = derivatives.timeFirst / denominator;
    return {
      volatility: localVariance > 0 && denominator > 0 ? Math.sqrt(localVariance) : NaN,
      localVariance,
      denominator,
      logMoneyness,
      derivatives,
      valid: localVariance > 0 && denominator > 0,
    };
  }

  function buildLocalVolatilityGrid(surface, options = {}) {
    const maturities = options.maturities || surface.maturities;
    const logMoneyness = options.logMoneyness || [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3];
    const rows = [];
    maturities.forEach((maturity) => {
      const forward = surface.market.spot * Math.exp((surface.market.rate -
        surface.market.dividendYield) * maturity);
      logMoneyness.forEach((k) => {
        const strike = forward * Math.exp(k);
        rows.push({ maturity, logMoneyness: k, strike,
          ...dupireLocalVolatility(surface, maturity, strike, options) });
      });
    });
    return rows;
  }

  function solveTridiagonal(lower, diagonal, upper, right) {
    const count = diagonal.length;
    const cPrime = new Float64Array(Math.max(count - 1, 0));
    const dPrime = new Float64Array(count);
    let denominator = diagonal[0];
    if (Math.abs(denominator) < 1e-14) throw new Error("Singular forward-PDE system.");
    if (count > 1) cPrime[0] = upper[0] / denominator;
    dPrime[0] = right[0] / denominator;
    for (let index = 1; index < count; index += 1) {
      denominator = diagonal[index] - lower[index - 1] * cPrime[index - 1];
      if (Math.abs(denominator) < 1e-14) throw new Error("Singular forward-PDE system.");
      if (index < count - 1) cPrime[index] = upper[index] / denominator;
      dPrime[index] = (right[index] - lower[index - 1] * dPrime[index - 1]) / denominator;
    }
    const result = new Float64Array(count);
    result[count - 1] = dPrime[count - 1];
    for (let index = count - 2; index >= 0; index -= 1) {
      result[index] = dPrime[index] - cPrime[index] * result[index + 1];
    }
    return result;
  }

  function localVolatilityRoundTrip(surface, options = {}) {
    const market = {
      spot: Number(surface.market?.spot ?? options.spot ?? 100),
      rate: Number(surface.market?.rate ?? options.rate ?? 0),
      dividendYield: Number(surface.market?.dividendYield ?? options.dividendYield ?? 0),
    };
    const targetMaturities = (options.maturities || surface.maturities).map(Number)
      .filter((maturity) => maturity > 0).sort((first, second) => first - second);
    const targetLogMoneyness = options.logMoneyness ||
      Array.from({ length: 21 }, (_, index) => -0.35 + 0.7 * index / 20);
    if (!targetMaturities.length) throw new Error("Local-volatility round trip requires maturities.");
    const maximumMaturity = targetMaturities.at(-1);
    const strikePoints = Math.max(101, Math.trunc(Number(options.strikePoints ?? 501)) | 1);
    const timeSteps = Math.max(40, Math.trunc(Number(options.timeSteps ??
      Math.ceil(maximumMaturity * 220))));
    const maximumVolatility = Math.max(...targetMaturities.flatMap((maturity) =>
      targetLogMoneyness.map((k) => {
        const forward = market.spot * Math.exp((market.rate - market.dividendYield) * maturity);
        return Math.sqrt(surface.totalVariance(maturity, k) / maturity) *
          (Number.isFinite(forward) ? 1 : 0);
      })));
    const strikeMaximum = Number(options.strikeMaximum ?? market.spot * Math.exp(
      Math.max(1.1, Math.max(...targetLogMoneyness) +
        5 * Math.max(maximumVolatility, 0.2) * Math.sqrt(maximumMaturity)),
    ));
    const strikeStep = strikeMaximum / (strikePoints - 1);
    const strikes = Array.from({ length: strikePoints }, (_, index) => index * strikeStep);
    let prices = Float64Array.from(strikes, (strike) => Math.max(market.spot - strike, 0));
    const dt = maximumMaturity / timeSteps;
    const snapshots = new Map();
    let targetIndex = 0;
    const localKMinimum = Number(options.localLogMoneynessMinimum ?? -0.8);
    const localKMaximum = Number(options.localLogMoneynessMaximum ?? 0.8);
    let minimumLocalVolatility = Infinity;
    let maximumLocalVolatility = 0;
    for (let step = 0; step < timeSteps; step += 1) {
      const oldTime = step * dt;
      const newTime = (step + 1) * dt;
      const middleTime = 0.5 * (oldTime + newTime);
      const oldLeftBoundary = market.spot * Math.exp(-market.dividendYield * oldTime);
      const newLeftBoundary = market.spot * Math.exp(-market.dividendYield * newTime);
      const oldRightBoundary = 0;
      const newRightBoundary = 0;
      const interiorCount = strikePoints - 2;
      const lowerOperator = new Float64Array(interiorCount);
      const diagonalOperator = new Float64Array(interiorCount);
      const upperOperator = new Float64Array(interiorCount);
      for (let interior = 0; interior < interiorCount; interior += 1) {
        const strike = strikes[interior + 1];
        const forward = market.spot * Math.exp((market.rate - market.dividendYield) * middleTime);
        const rawK = Math.log(strike / forward);
        const localK = clamp(rawK, localKMinimum, localKMaximum);
        const queryStrike = forward * Math.exp(localK);
        const local = dupireLocalVolatility(surface, Math.max(middleTime, 1e-8), queryStrike,
          options.derivativeOptions || {});
        if (!local.valid || !Number.isFinite(local.volatility)) {
          throw new Error(`Invalid Dupire local volatility at T=${middleTime}, K=${queryStrike}.`);
        }
        const volatility = clamp(local.volatility,
          Number(options.minimumLocalVolatility ?? 0.01),
          Number(options.maximumLocalVolatility ?? 3));
        minimumLocalVolatility = Math.min(minimumLocalVolatility, volatility);
        maximumLocalVolatility = Math.max(maximumLocalVolatility, volatility);
        const diffusion = 0.5 * volatility ** 2 * strike ** 2 / strikeStep ** 2;
        const drift = (market.rate - market.dividendYield) * strike / (2 * strikeStep);
        lowerOperator[interior] = diffusion + drift;
        diagonalOperator[interior] = -2 * diffusion - market.dividendYield;
        upperOperator[interior] = diffusion - drift;
      }
      const matrixLower = new Float64Array(interiorCount - 1);
      const matrixDiagonal = new Float64Array(interiorCount);
      const matrixUpper = new Float64Array(interiorCount - 1);
      const right = new Float64Array(interiorCount);
      for (let interior = 0; interior < interiorCount; interior += 1) {
        const gridIndex = interior + 1;
        const lower = lowerOperator[interior];
        const diagonal = diagonalOperator[interior];
        const upper = upperOperator[interior];
        const oldLeft = gridIndex === 1 ? oldLeftBoundary : prices[gridIndex - 1];
        const oldRight = gridIndex === strikePoints - 2 ? oldRightBoundary : prices[gridIndex + 1];
        right[interior] = prices[gridIndex] + 0.5 * dt * (
          lower * oldLeft + diagonal * prices[gridIndex] + upper * oldRight
        );
        if (interior === 0) right[interior] += 0.5 * dt * lower * newLeftBoundary;
        else matrixLower[interior - 1] = -0.5 * dt * lower;
        if (interior === interiorCount - 1) right[interior] += 0.5 * dt * upper * newRightBoundary;
        else matrixUpper[interior] = -0.5 * dt * upper;
        matrixDiagonal[interior] = 1 - 0.5 * dt * diagonal;
      }
      const interiorPrices = solveTridiagonal(matrixLower, matrixDiagonal, matrixUpper, right);
      const nextPrices = new Float64Array(strikePoints);
      nextPrices[0] = newLeftBoundary;
      nextPrices[strikePoints - 1] = newRightBoundary;
      nextPrices.set(interiorPrices, 1);
      while (targetIndex < targetMaturities.length &&
        targetMaturities[targetIndex] <= newTime + 1e-12) {
        const maturity = targetMaturities[targetIndex];
        const alpha = clamp((maturity - oldTime) / dt, 0, 1);
        snapshots.set(maturity, Float64Array.from(prices, (value, index) =>
          value * (1 - alpha) + nextPrices[index] * alpha));
        targetIndex += 1;
      }
      prices = nextPrices;
    }
    const rows = [];
    targetMaturities.forEach((maturity) => {
      const snapshot = snapshots.get(maturity);
      const forward = market.spot * Math.exp((market.rate - market.dividendYield) * maturity);
      targetLogMoneyness.forEach((logMoneyness) => {
        const strike = forward * Math.exp(logMoneyness);
        const gridPosition = clamp(strike / strikeStep, 0, strikePoints - 1);
        const lowerIndex = Math.min(Math.floor(gridPosition), strikePoints - 2);
        const fraction = gridPosition - lowerIndex;
        const reconstructedPrice = snapshot[lowerIndex] * (1 - fraction) +
          snapshot[lowerIndex + 1] * fraction;
        const inputVolatility = Math.sqrt(surface.totalVariance(maturity, logMoneyness) / maturity);
        const inputPrice = blackScholesPrice({ ...market, maturity, strike }, inputVolatility, "call");
        const bounds = blackScholesBounds({ ...market, maturity, strike }, "call");
        const safePrice = clamp(reconstructedPrice, bounds.lower + 1e-12, bounds.upper - 1e-12);
        const reconstructedVolatility = impliedVolatility(
          { ...market, maturity, strike }, safePrice, "call",
        ).volatility;
        rows.push({ maturity, logMoneyness, strike, inputPrice, reconstructedPrice,
          priceError: reconstructedPrice - inputPrice, inputVolatility, reconstructedVolatility,
          volatilityError: reconstructedVolatility - inputVolatility });
      });
    });
    const priceRmse = Math.sqrt(rows.reduce((sum, row) => sum + row.priceError ** 2, 0) / rows.length);
    const impliedVolatilityRmse = Math.sqrt(rows.reduce((sum, row) =>
      sum + row.volatilityError ** 2, 0) / rows.length);
    return {
      rows, priceRmse, maximumPriceError: Math.max(...rows.map((row) => Math.abs(row.priceError))),
      impliedVolatilityRmse,
      maximumImpliedVolatilityError: Math.max(...rows.map((row) => Math.abs(row.volatilityError))),
      maturities: targetMaturities, logMoneyness: Array.from(targetLogMoneyness),
      strikePoints, timeSteps, strikeMaximum, minimumLocalVolatility, maximumLocalVolatility,
    };
  }

  class SeededNormal {
    constructor(seed) {
      this.state = (Number(seed) >>> 0) || 0x9e3779b9;
      this.spare = null;
    }

    uniform() {
      let value = this.state;
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      this.state = value >>> 0;
      return (this.state + 0.5) / 4294967296;
    }

    normal() {
      if (this.spare !== null) {
        const value = this.spare;
        this.spare = null;
        return value;
      }
      const radius = Math.sqrt(-2 * Math.log(Math.max(this.uniform(), 1e-15)));
      const angle = 2 * Math.PI * this.uniform();
      this.spare = radius * Math.sin(angle);
      return radius * Math.cos(angle);
    }
  }

  function interpolateLeverage(nodes, values, point) {
    return interpolateLinear(nodes, values, point, "flat");
  }

  function calibrateSlvLeverage(localVolatility, options = {}) {
    const spot = Number(options.spot ?? 100);
    const maturity = Number(options.maturity ?? 1);
    const rate = Number(options.rate ?? 0);
    const dividendYield = Number(options.dividendYield ?? 0);
    const timeSteps = Math.trunc(Number(options.timeSteps ?? 12));
    const particles = Math.trunc(Number(options.particles ?? 4000));
    const kappa = Number(options.kappa ?? 2);
    const theta = Number(options.theta ?? 0.04);
    const volOfVol = Number(options.volOfVol ?? 0.4);
    const rho = Number(options.rho ?? -0.6);
    const initialVariance = Number(options.initialVariance ?? theta);
    const bandwidth = Number(options.bandwidth ?? 0.08);
    const damping = clamp(Number(options.damping ?? 0.5), 0, 1);
    const minimumLeverage = Number(options.minimumLeverage ?? 0.1);
    const maximumLeverage = Number(options.maximumLeverage ?? 5);
    const logMoneyness = options.logMoneyness ||
      Array.from({ length: 15 }, (_, index) => -0.42 + 0.84 * index / 14);
    if (!(spot > 0 && maturity > 0 && timeSteps >= 1 && particles >= 100 && theta > 0 &&
      initialVariance >= 0 && volOfVol >= 0 && Math.abs(rho) <= 1 && bandwidth > 0)) {
      throw new Error("Invalid SLV particle-calibration controls.");
    }
    const rng = new SeededNormal(options.seed ?? 99173);
    const spots = new Float64Array(particles).fill(spot);
    const variances = new Float64Array(particles).fill(initialVariance);
    const dt = maturity / timeSteps;
    const rootDt = Math.sqrt(dt);
    const times = [0];
    const leverage = [new Float64Array(logMoneyness.length).fill(
      clamp(Number(localVolatility(0, spot)) / Math.sqrt(Math.max(initialVariance, 1e-12)),
        minimumLeverage, maximumLeverage),
    )];
    const conditionalVariance = [new Float64Array(logMoneyness.length).fill(initialVariance)];
    const reproductionErrors = [];
    for (let step = 1; step <= timeSteps; step += 1) {
      const previousLeverage = leverage.at(-1);
      for (let particle = 0; particle < particles; particle += 1) {
        const spotNormal = rng.normal();
        const independent = rng.normal();
        const varianceNormal = rho * spotNormal + Math.sqrt(Math.max(1 - rho ** 2, 0)) * independent;
        const variance = Math.max(variances[particle], 0);
        const k = Math.log(spots[particle] / (spot * Math.exp((rate - dividendYield) *
          (step - 1) * dt)));
        const localLeverage = interpolateLeverage(logMoneyness, previousLeverage, k);
        spots[particle] *= Math.exp((rate - dividendYield - 0.5 * variance * localLeverage ** 2) * dt +
          Math.sqrt(variance) * localLeverage * rootDt * spotNormal);
        variances[particle] = Math.max(variance + kappa * (theta - variance) * dt +
          volOfVol * Math.sqrt(variance) * rootDt * varianceNormal, 0);
      }
      const time = step * dt;
      const forward = spot * Math.exp((rate - dividendYield) * time);
      const conditional = new Float64Array(logMoneyness.length);
      const nextLeverage = new Float64Array(logMoneyness.length);
      let maximumError = 0;
      for (let node = 0; node < logMoneyness.length; node += 1) {
        let weightSum = 0;
        let varianceSum = 0;
        for (let particle = 0; particle < particles; particle += 1) {
          const distance = (Math.log(spots[particle] / forward) - logMoneyness[node]) / bandwidth;
          if (Math.abs(distance) > 4) continue;
          const weight = Math.exp(-0.5 * distance ** 2);
          weightSum += weight;
          varianceSum += weight * variances[particle];
        }
        conditional[node] = weightSum > 1e-10 ? varianceSum / weightSum : theta;
        const targetSpot = forward * Math.exp(logMoneyness[node]);
        const target = Math.max(Number(localVolatility(time, targetSpot)), 1e-8);
        const rawLeverage = target / Math.sqrt(Math.max(conditional[node], 1e-12));
        nextLeverage[node] = clamp(
          damping * rawLeverage + (1 - damping) * previousLeverage[node],
          minimumLeverage, maximumLeverage,
        );
        const reproduced = nextLeverage[node] * Math.sqrt(Math.max(conditional[node], 0));
        maximumError = Math.max(maximumError, Math.abs(reproduced - target));
      }
      times.push(time);
      leverage.push(nextLeverage);
      conditionalVariance.push(conditional);
      reproductionErrors.push(maximumError);
    }
    return {
      times, logMoneyness: Array.from(logMoneyness),
      leverage: leverage.map((row) => Array.from(row)),
      conditionalVariance: conditionalVariance.map((row) => Array.from(row)),
      reproductionErrors,
      maximumReproductionError: Math.max(...reproductionErrors),
      particles, timeSteps,
    };
  }

  function runVolatilityUnitTests() {
    const rows = [];
    const add = (name, inputs, expected, evaluate, tolerance, rationale) => {
      let actual = null;
      let error = "";
      try { actual = evaluate(); }
      catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
      rows.push({
        product: "volatility-calibration", name, inputs, expected, actual, tolerance, rationale, error,
        passed: !error && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
      });
    };
    const market = { spot: 100, strike: 105, rate: 0.04, dividendYield: 0.01, maturity: 1 };
    const callPrice = blackScholesPrice(market, 0.27, "call");
    const putPrice = blackScholesPrice(market, 0.27, "put");
    add("Call price-to-implied-vol inversion", { price: callPrice }, 0.27,
      () => impliedVolatility(market, callPrice, "call").volatility, 1e-10,
      "The inverted volatility reprices the call to its original market premium.");
    add("Put price-to-implied-vol inversion", { price: putPrice }, 0.27,
      () => impliedVolatility(market, putPrice, "put").volatility, 1e-10,
      "The same hybrid root solver handles put premiums and dividend yield.");

    const term = buildTermStructure([
      { maturity: 0.5, volatility: 0.2 }, { maturity: 1, volatility: Math.sqrt(0.06) },
    ], "linear-total-variance");
    add("Linear total-variance interpolation", { maturity: 0.75 }, 0.04,
      () => term.totalVariance(0.75), 1e-12,
      "Total variance halfway between 0.02 and 0.06 is 0.04.");

    const raw = { a: 0.02, b: 0.25, rho: -0.4, m: 0.03, sigma: 0.18 };
    const natural = rawToNaturalSvi(raw);
    add("Raw-to-natural SVI equivalence", { k: -0.12 }, rawSviTotalVariance(-0.12, raw),
      () => naturalSviTotalVariance(-0.12, natural), 1e-12,
      "Natural SVI is an algebraic reparameterization of the raw smile.");

    const sviPoints = [-0.35, -0.2, -0.08, 0, 0.1, 0.22, 0.38].map((k) => ({
      maturity: 1, strike: 100 * Math.exp(k), logMoneyness: k,
      totalVariance: rawSviTotalVariance(k, raw),
      impliedVolatility: Math.sqrt(rawSviTotalVariance(k, raw)), weight: 1,
    }));
    const sviFit = fitRawSvi(sviPoints, { maximumIterations: 1000 });
    add("Synthetic raw-SVI calibration", { quotes: sviPoints.length }, 0,
      () => sviFit.rmse, 2e-5,
      "A five-parameter SVI fit recovers a synthetic SVI smile in total-variance space.");

    const sabrParameters = { alpha: 0.24, beta: 0.6, rho: -0.35, nu: 0.7 };
    const sabrPoints = [70, 82, 92, 100, 110, 125, 145].map((strike) => ({
      maturity: 1.5, strike, logMoneyness: Math.log(strike / 100), weight: 1,
      impliedVolatility: sabrLognormalVolatility(100, strike, 1.5, sabrParameters),
    })).map((point) => ({ ...point, totalVariance: point.impliedVolatility ** 2 * point.maturity }));
    const sabrFit = fitSabr(sabrPoints, 100, 0.6, { maximumIterations: 800 });
    add("Synthetic SABR calibration", { beta: 0.6 }, 0,
      () => sabrFit.rmse, 2e-5,
      "With beta fixed, alpha, rho, and nu recover a synthetic Hagan smile.");

    const vvPoints = [85, 100, 120].map((strike, index) => {
      const volatility = [0.29, 0.23, 0.215][index];
      return { maturity: 1, strike, forward: 100, logMoneyness: Math.log(strike / 100),
        impliedVolatility: volatility, totalVariance: volatility ** 2, weight: 1 };
    });
    const vv = buildVannaVolgaSmile(vvPoints, { spot: 100, forward: 100, rate: 0,
      dividendYield: 0, maturity: 1 });
    add("Vanna-Volga anchor reproduction", { strike: 85 }, 0.29,
      () => vv.volatility(85), 1e-9,
      "The locally vega/vanna/volga-matched price reproduces each input anchor.");

    const convex = buildConvexCallSmile(vvPoints, { spot: 100, forward: 100,
      rate: 0, dividendYield: 0, maturity: 1 });
    add("Constrained convex call slopes", { nodes: 3 }, 0,
      () => Math.max(0, convex.slopes[0] - convex.slopes[1]), 1e-12,
      "Nondecreasing call-price slopes imply discrete convexity and non-negative density.");

    const dumasCoefficients = [0.2, -0.06, 0.12, 0.01, -0.02, 0.005];
    const dumasPoints = [];
    [0.5, 1, 2].forEach((maturity) => [-0.25, -0.1, 0.05, 0.2].forEach((k) => {
      const iv = dumasFeatures(k, maturity).reduce((sum, value, index) =>
        sum + value * dumasCoefficients[index], 0);
      dumasPoints.push({ maturity, logMoneyness: k, impliedVolatility: iv,
        totalVariance: iv ** 2 * maturity, weight: 1 });
    }));
    const dumasFit = fitDumas(dumasPoints);
    add("Synthetic Dumas surface calibration", { quotes: dumasPoints.length }, 0,
      () => dumasFit.rmse, 1e-8,
      "Linear least squares recovers a synthetic quadratic maturity/moneyness surface.");

    const flatSurface = {
      market: { spot: 100, rate: 0.03, dividendYield: 0.01 }, maturities: [0.25, 2],
      totalVariance: (maturity) => 0.2 ** 2 * maturity,
    };
    add("Dupire flat-surface reduction", { volatility: 0.2 }, 0.2,
      () => dupireLocalVolatility(flatSurface, 1, 100 * Math.exp(0.02)).volatility, 2e-8,
      "A flat implied-volatility surface reduces to the same constant local volatility.");

    const slv = calibrateSlvLeverage(() => 0.2, {
      spot: 100, maturity: 0.5, timeSteps: 4, particles: 256, seed: 7,
      kappa: 2, theta: 0.04, initialVariance: 0.04, volOfVol: 0, rho: -0.5,
      damping: 1,
    });
    add("SLV deterministic-variance reduction", { volOfVol: 0 }, 1,
      () => slv.leverage.at(-1)[7], 1e-10,
      "When conditional variance is 20%^2 and target local vol is 20%, leverage is one.");

    const ssviParameters = { rho: -0.45, eta: 0.8, gamma: 0.5 };
    const theta = 0.05;
    add("SSVI ATM total-variance identity", { theta }, theta,
      () => ssviTotalVariance(0, theta, ssviParameters), 1e-12,
      "SSVI evaluates exactly to theta at forward ATM.");
    add("SVI density diagnostic", { k: 0 }, 1,
      () => rawSviDerivatives(0, raw).second > 0 ? 1 : 0, 0,
      "Positive SVI curvature at the smile center is a basic density sanity check.");
    const cviQuotes = [];
    [0.5, 1].forEach((maturity) => [-0.3, -0.15, 0, 0.15, 0.3].forEach((k) => {
      const totalVariance = ssviTotalVariance(k, 0.04 * maturity,
        { rho: -0.35, eta: 0.65, gamma: 0.45 });
      cviQuotes.push({ maturity, logMoneyness: k, strike: 100 * Math.exp(k), forward: 100,
        impliedVolatility: Math.sqrt(totalVariance / maturity), totalVariance, weight: 1 });
    }));
    const cvi = fitCviSurface(cviQuotes, {
      cviKnots: 9, cviRegularization: 0.05, cviIterations: 2,
      maximumIterations: 1800,
    });
    add("CVI sequential-QP feasibility", {
      expiries: 2, quotes: 10, knotsPerExpiry: 9,
      butterflyConstraints: cvi.parameters.butterflyConstraintCount,
    }, 0, () => cvi.solver.maximumViolation, 5e-5,
    "The variance B-spline solution satisfies the normalized positivity, calendar, tail, and linearized-butterfly constraint grid.");
    const roundTripMaturities = Array.from({ length: 12 }, (_, index) =>
      1 / 12 + (2 - 1 / 12) * index / 11);
    const roundTripMoneyness = Array.from({ length: 25 }, (_, index) =>
      -0.3 + 0.6 * index / 24);
    const roundTripSurface = {
      market: { spot: 100, rate: 0.03, dividendYield: 0.01 },
      maturities: roundTripMaturities,
      totalVariance: (maturity, k) => ssviTotalVariance(
        k, 0.04 * maturity, { rho: -0.35, eta: 0.65, gamma: 0.45 },
      ),
    };
    const roundTrip = localVolatilityRoundTrip(roundTripSurface, {
      maturities: roundTripMaturities, logMoneyness: roundTripMoneyness,
      strikePoints: 1101, timeSteps: 1100,
    });
    add("Dense Dupire local-volatility price round trip", {
      expiries: roundTripMaturities.length, moneynessPoints: roundTripMoneyness.length,
      prices: roundTrip.rows.length, strikeGrid: roundTrip.strikePoints,
      timeSteps: roundTrip.timeSteps,
    }, 0, () => roundTrip.maximumPriceError, 0.015,
    "Dupire local volatility reprices all 300 non-flat input-surface calls through an independent forward PDE to within 1.5 cents.");
    return rows;
  }

  return {
    FIT_METHODS,
    TERM_METHODS,
    VOLATILITY_TEST_DEFINITION,
    blackScholesPrice,
    blackScholesBounds,
    blackScholesVega,
    impliedVolatility,
    pava,
    buildPchip,
    buildTermStructure,
    rawSviTotalVariance,
    rawSviDerivatives,
    rawToNaturalSvi,
    naturalSviTotalVariance,
    rawToJumpWings,
    ssviPhi,
    ssviTotalVariance,
    fitRawSvi,
    fitSsvi,
    sabrLognormalVolatility,
    fitSabr,
    blackScholesVolGreeks,
    buildVannaVolgaSmile,
    dumasFeatures,
    fitDumas,
    buildPchipSmile,
    buildConvexCallSmile,
    cviBasisVector,
    solveCviQuadraticProgram,
    fitCviSurface,
    parseMarketQuotes,
    normalizeQuotes,
    calibrateSurface,
    butterflyFunction,
    surfaceDerivatives,
    arbitrageDiagnostics,
    dupireLocalVolatility,
    buildLocalVolatilityGrid,
    localVolatilityRoundTrip,
    calibrateSlvLeverage,
    runVolatilityUnitTests,
  };
}));
