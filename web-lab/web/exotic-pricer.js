(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ExoticPricer = api;
}(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const TWO_PI = 2.0 * Math.PI;
  const UINT_SCALE = 4294967296.0;
  const SOBOL_PARAMETERS = [
    null,
    [1, 0, [1]],
    [2, 1, [1, 3]],
    [3, 1, [1, 3, 1]],
    [3, 2, [1, 1, 1]],
    [4, 1, [1, 3, 5, 13]],
    [4, 4, [1, 1, 5, 5]],
    [5, 2, [1, 3, 3, 9, 7]],
    [5, 4, [1, 1, 5, 11, 27]],
    [5, 7, [1, 1, 7, 13, 3]],
    [5, 11, [1, 1, 5, 1, 15]],
    [5, 13, [1, 1, 1, 3, 29]],
    [5, 14, [1, 3, 5, 5, 21]],
    [6, 1, [1, 3, 3, 9, 9, 27]],
    [6, 13, [1, 1, 3, 3, 7, 49]],
    [6, 16, [1, 1, 1, 15, 21, 21]],
  ];
  const sobolDirectionCache = new Map();
  const primitivePolynomials = [];

  function polynomialDegree(value) {
    return 31 - Math.clz32(value >>> 0);
  }

  function polynomialRemainder(dividend, divisor) {
    let value = dividend >>> 0;
    const divisorDegree = polynomialDegree(divisor);
    while (value !== 0 && polynomialDegree(value) >= divisorDegree) {
      value ^= divisor << (polynomialDegree(value) - divisorDegree);
    }
    return value >>> 0;
  }

  function polynomialGcd(first, second) {
    let a = first >>> 0;
    let b = second >>> 0;
    while (b !== 0) [a, b] = [b, polynomialRemainder(a, b)];
    return a >>> 0;
  }

  function fieldMultiply(first, second, polynomial, degree) {
    let a = first >>> 0;
    let b = second >>> 0;
    let result = 0;
    const high = 1 << degree;
    while (b !== 0) {
      if (b & 1) result ^= a;
      b >>>= 1;
      a <<= 1;
      if (a & high) a ^= polynomial;
    }
    return result >>> 0;
  }

  function fieldPower(base, exponent, polynomial, degree) {
    let result = 1;
    let factor = base;
    let power = exponent;
    while (power > 0) {
      if (power & 1) result = fieldMultiply(result, factor, polynomial, degree);
      factor = fieldMultiply(factor, factor, polynomial, degree);
      power = Math.floor(power / 2);
    }
    return result >>> 0;
  }

  function primeFactors(value) {
    const factors = [];
    let remaining = value;
    for (let divisor = 2; divisor * divisor <= remaining; divisor += 1) {
      if (remaining % divisor !== 0) continue;
      factors.push(divisor);
      while (remaining % divisor === 0) remaining /= divisor;
    }
    if (remaining > 1) factors.push(remaining);
    return factors;
  }

  function isPrimitivePolynomial(polynomial, degree) {
    const x = 2;
    let frobenius = x;
    for (let index = 1; index <= Math.floor(degree / 2); index += 1) {
      frobenius = fieldMultiply(frobenius, frobenius, polynomial, degree);
      if (polynomialGcd(frobenius ^ x, polynomial) !== 1) return false;
    }
    frobenius = x;
    for (let index = 0; index < degree; index += 1) {
      frobenius = fieldMultiply(frobenius, frobenius, polynomial, degree);
    }
    if (frobenius !== x) return false;
    const order = (2 ** degree) - 1;
    return primeFactors(order).every((factor) =>
      fieldPower(x, order / factor, polynomial, degree) !== 1);
  }

  function primitivePolynomialAt(index) {
    if (index < primitivePolynomials.length) return primitivePolynomials[index];
    for (let degree = primitivePolynomials.length ? primitivePolynomials.at(-1).degree : 1;
      primitivePolynomials.length <= index; degree += 1) {
      const first = (1 << degree) | 1;
      const limit = 1 << (degree + 1);
      for (let polynomial = first; polynomial < limit && primitivePolynomials.length <= index; polynomial += 2) {
        if (polynomialDegree(polynomial) !== degree || !isPrimitivePolynomial(polynomial, degree)) continue;
        if (!primitivePolynomials.some((entry) => entry.polynomial === polynomial)) {
          primitivePolynomials.push({ polynomial, degree });
        }
      }
    }
    return primitivePolynomials[index];
  }

  function generatedSobolParameter(dimension) {
    const { polynomial, degree } = primitivePolynomialAt(dimension - 1);
    const coefficient = (polynomial >>> 1) & ((1 << (degree - 1)) - 1);
    const initial = [];
    let hash = Math.imul(dimension + 1, 0x9e3779b1) >>> 0;
    for (let bit = 1; bit <= degree; bit += 1) {
      hash ^= hash << 13;
      hash ^= hash >>> 17;
      hash ^= hash << 5;
      initial.push(((hash >>> 0) & ((2 ** bit) - 1)) | 1);
    }
    return [degree, coefficient, initial];
  }

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

  function normalPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(TWO_PI);
  }

  function normalCdf(x) {
    const ax = Math.abs(x);
    let tail;
    if (ax > 37.0) {
      tail = 0.0;
    } else {
      const exponential = Math.exp(-0.5 * ax * ax);
      if (ax < 7.07106781186547) {
        let numerator = 3.52624965998911e-2;
        numerator = numerator * ax + 0.700383064443688;
        numerator = numerator * ax + 6.37396220353165;
        numerator = numerator * ax + 33.912866078383;
        numerator = numerator * ax + 112.079291497871;
        numerator = numerator * ax + 221.213596169931;
        numerator = numerator * ax + 220.206867912376;
        let denominator = 8.83883476483184e-2;
        denominator = denominator * ax + 1.75566716318264;
        denominator = denominator * ax + 16.064177579207;
        denominator = denominator * ax + 86.7807322029461;
        denominator = denominator * ax + 296.564248779674;
        denominator = denominator * ax + 637.333633378831;
        denominator = denominator * ax + 793.826512519948;
        denominator = denominator * ax + 440.413735824752;
        tail = exponential * numerator / denominator;
      } else {
        let fraction = ax + 0.65;
        fraction = ax + 4.0 / fraction;
        fraction = ax + 3.0 / fraction;
        fraction = ax + 2.0 / fraction;
        fraction = ax + 1.0 / fraction;
        tail = exponential / (fraction * Math.sqrt(TWO_PI));
      }
    }
    return x > 0.0 ? 1.0 - tail : tail;
  }

  function inverseNormalCdf(probability) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
      138.3577518672690, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
      66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398,
      2.445134137142996, 3.754408661907416];
    const p = Math.min(Math.max(probability, 1e-14), 1.0 - 1e-14);
    let x;
    if (p < 0.02425) {
      const q = Math.sqrt(-2.0 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    } else if (p <= 0.97575) {
      const q = p - 0.5;
      const r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
    } else {
      const q = Math.sqrt(-2.0 * Math.log(1.0 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    }
    const error = normalCdf(x) - p;
    const correction = error * Math.sqrt(TWO_PI) * Math.exp(0.5 * x * x);
    return x - correction / (1.0 + 0.5 * x * correction);
  }

  function bivariateNormalCdf(first, second, correlation) {
    if (first <= -10.0 || second <= -10.0) return 0.0;
    if (first >= 10.0) return normalCdf(second);
    if (second >= 10.0) return normalCdf(first);
    if (correlation >= 0.999999999) return normalCdf(Math.min(first, second));
    if (correlation <= -0.999999999) {
      return Math.max(normalCdf(first) - normalCdf(-second), 0.0);
    }
    if (Math.abs(correlation) < 1e-14) return normalCdf(first) * normalCdf(second);
    const lower = -10.0;
    const upper = Math.min(first, 10.0);
    const intervals = 512;
    const width = (upper - lower) / intervals;
    const scale = Math.sqrt(1.0 - correlation * correlation);
    const integrand = (x) => normalPdf(x) * normalCdf((second - correlation * x) / scale);
    let total = integrand(lower) + integrand(upper);
    for (let index = 1; index < intervals; index += 1) {
      total += (index % 2 ? 4.0 : 2.0) * integrand(lower + index * width);
    }
    return Math.min(Math.max(total * width / 3.0, 0.0), 1.0);
  }

  function sobolDirections(dimension) {
    if (sobolDirectionCache.has(dimension)) return sobolDirectionCache.get(dimension);
    const directions = new Uint32Array(32);
    if (dimension === 0) {
      for (let bit = 0; bit < 32; bit += 1) directions[bit] = (1 << (31 - bit)) >>> 0;
    } else {
      // Joe-Kuo-style seed parameters are retained for the first 16 dimensions.
      // Higher dimensions use distinct primitive GF(2) polynomials and valid odd
      // initial direction integers, keeping the construction a Sobol digital net.
      const parameter = SOBOL_PARAMETERS[dimension] || generatedSobolParameter(dimension);
      const [degree, coefficient, initial] = parameter;
      for (let bit = 1; bit <= degree; bit += 1) {
        directions[bit - 1] = (initial[bit - 1] << (32 - bit)) >>> 0;
      }
      for (let bit = degree + 1; bit <= 32; bit += 1) {
        let value = (directions[bit - degree - 1] ^
          (directions[bit - degree - 1] >>> degree)) >>> 0;
        for (let offset = 1; offset < degree; offset += 1) {
          if ((coefficient >>> (degree - 1 - offset)) & 1) {
            value ^= directions[bit - offset - 1];
          }
        }
        directions[bit - 1] = value >>> 0;
      }
    }
    sobolDirectionCache.set(dimension, directions);
    return directions;
  }

  function sobolUniform(index, dimension, shift = 0) {
    const gray = (index ^ (index >>> 1)) >>> 0;
    const directions = sobolDirections(dimension);
    let value = shift >>> 0;
    for (let bit = 0; bit < 32; bit += 1) {
      if ((gray >>> bit) & 1) value ^= directions[bit];
    }
    return ((value >>> 0) + 0.5) / UINT_SCALE;
  }

  function blackScholes(config) {
    const { spot, strike, rate, dividendYield, volatility, maturity, optionType = "call" } = config;
    if (volatility <= 0.0) {
      const forwardSpot = spot * Math.exp((rate - dividendYield) * maturity);
      const payoff = optionType === "call"
        ? Math.max(forwardSpot - strike, 0.0)
        : Math.max(strike - forwardSpot, 0.0);
      return Math.exp(-rate * maturity) * payoff;
    }
    const rootT = Math.sqrt(maturity);
    const d1 = (Math.log(spot / strike) +
      (rate - dividendYield + 0.5 * volatility * volatility) * maturity) /
      (volatility * rootT);
    const d2 = d1 - volatility * rootT;
    const discountedSpot = spot * Math.exp(-dividendYield * maturity);
    const discountedStrike = strike * Math.exp(-rate * maturity);
    return optionType === "call"
      ? discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2)
      : discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
  }

  function digitalClosedForm(config) {
    const rootT = Math.sqrt(config.maturity);
    const d2 = (Math.log(config.spot / config.strike) +
      (config.rate - config.dividendYield - 0.5 * config.volatility ** 2) * config.maturity) /
      (config.volatility * rootT);
    const probability = config.optionType === "call" ? normalCdf(d2) : normalCdf(-d2);
    return config.cashPayoff * Math.exp(-config.rate * config.maturity) * probability;
  }

  function barrierOutClosedForm(config) {
    const { spot: s, strike: k, barrier: h, rate: r, dividendYield: q,
      volatility: sigma, maturity: t, optionType, barrierDirection } = config;
    const isCall = optionType === "call";
    const isDown = barrierDirection === "down";
    if ((isDown && s <= h) || (!isDown && s >= h)) return 0.0;
    const phi = isCall ? 1.0 : -1.0;
    const eta = isDown ? 1.0 : -1.0;
    const carry = r - q;
    const variance = sigma * sigma;
    const rootVariance = sigma * Math.sqrt(t);
    const mu = (carry - 0.5 * variance) / variance;
    const x1 = Math.log(s / k) / rootVariance + (1.0 + mu) * rootVariance;
    const x2 = Math.log(s / h) / rootVariance + (1.0 + mu) * rootVariance;
    const y1 = Math.log(h * h / (s * k)) / rootVariance + (1.0 + mu) * rootVariance;
    const y2 = Math.log(h / s) / rootVariance + (1.0 + mu) * rootVariance;
    const spotDiscount = Math.exp((carry - r) * t);
    const strikeDiscount = Math.exp(-r * t);
    const imageAsset = Math.pow(h / s, 2.0 * (mu + 1.0));
    const imageCash = Math.pow(h / s, 2.0 * mu);
    const a = phi * s * spotDiscount * normalCdf(phi * x1) -
      phi * k * strikeDiscount * normalCdf(phi * x1 - phi * rootVariance);
    const b = phi * s * spotDiscount * normalCdf(phi * x2) -
      phi * k * strikeDiscount * normalCdf(phi * x2 - phi * rootVariance);
    const c = phi * s * spotDiscount * imageAsset * normalCdf(eta * y1) -
      phi * k * strikeDiscount * imageCash * normalCdf(eta * y1 - eta * rootVariance);
    const d = phi * s * spotDiscount * imageAsset * normalCdf(eta * y2) -
      phi * k * strikeDiscount * imageCash * normalCdf(eta * y2 - eta * rootVariance);
    let result;
    if (isCall && isDown) result = k > h ? a - c : b - d;
    else if (isCall && !isDown) result = k >= h ? 0.0 : a - b + c - d;
    else if (!isCall && isDown) result = k > h ? a - b + c - d : 0.0;
    else result = k > h ? b - d : a - c;
    return Math.max(result, 0.0);
  }

  function barrierClosedForm(config) {
    const vanilla = blackScholes(config);
    const out = barrierOutClosedForm(config);
    return config.barrierStyle === "in" ? Math.max(vanilla - out, 0.0) : out;
  }

  function doubleBarrierSpectral(config) {
    const vanilla = blackScholes(config);
    const { spot, lowerBarrier: lower, upperBarrier: upper, strike, rate,
      dividendYield, volatility, maturity, optionType } = config;
    if (spot <= lower || spot >= upper) return config.barrierStyle === "in" ? vanilla : 0.0;
    const logLower = Math.log(lower);
    const logUpper = Math.log(upper);
    const logSpot = Math.log(spot);
    const width = logUpper - logLower;
    const drift = rate - dividendYield - 0.5 * volatility * volatility;
    const tilt = drift / (volatility * volatility);
    const modes = 96;
    const intervals = 640;
    const dy = width / intervals;
    const spotSine = new Float64Array(modes);
    const damping = new Float64Array(modes);
    for (let mode = 1; mode <= modes; mode += 1) {
      const wave = mode * Math.PI / width;
      spotSine[mode - 1] = Math.sin(wave * (logSpot - logLower));
      damping[mode - 1] = Math.exp(-0.5 * volatility * volatility * wave * wave * maturity);
    }
    const integrand = (y) => {
      const terminal = Math.exp(y);
      const payoff = optionType === "call"
        ? Math.max(terminal - strike, 0.0)
        : Math.max(strike - terminal, 0.0);
      if (payoff === 0.0) return 0.0;
      let series = 0.0;
      for (let mode = 1; mode <= modes; mode += 1) {
        series += spotSine[mode - 1] * Math.sin(mode * Math.PI * (y - logLower) / width) *
          damping[mode - 1];
      }
      const density = 2.0 / width * Math.exp(
        tilt * (y - logSpot) - 0.5 * tilt * tilt * volatility * volatility * maturity,
      ) * series;
      return payoff * density;
    };
    let total = integrand(logLower) + integrand(logUpper);
    for (let index = 1; index < intervals; index += 1) {
      total += (index % 2 ? 4.0 : 2.0) * integrand(logLower + index * dy);
    }
    const out = Math.max(Math.exp(-rate * maturity) * total * dy / 3.0, 0.0);
    return config.barrierStyle === "in" ? Math.max(vanilla - out, 0.0) : out;
  }

  // ---- Discrete-monitoring and terminal barrier closed forms ------------
  //
  // Broadie-Glasserman-Kou continuity correction: a barrier monitored m
  // times per year is priced by the continuous formula with the barrier
  // shifted AWAY from spot by exp(beta * sigma * sqrt(1/m)), where
  // beta = -zeta(1/2)/sqrt(2*pi). Discrete monitoring makes a knock-out
  // less likely to trigger, which is exactly what the outward shift
  // encodes; knock-in follows through the same in = vanilla - out parity
  // used everywhere else in this file.
  const BGK_BETA = 0.5825971579390107;

  function bgkShiftedConfig(config, observationsPerYear) {
    const factor = Math.exp(BGK_BETA * config.volatility * Math.sqrt(1.0 / observationsPerYear));
    if (config.product === "double-barrier") {
      return {
        ...config,
        upperBarrier: config.upperBarrier * factor,
        lowerBarrier: config.lowerBarrier / factor,
      };
    }
    return {
      ...config,
      barrier: config.barrierDirection === "down"
        ? config.barrier / factor
        : config.barrier * factor,
    };
  }

  // PV of the vanilla payoff restricted to lowerBound < S_T < upperBound,
  // from the two Black-Scholes building blocks
  //   PV[S_T * 1{a<S_T<b}] = S e^{-qT} (N(d1(a)) - N(d1(b)))
  //   PV[K   * 1{a<S_T<b}] = K e^{-rT} (N(d2(a)) - N(d2(b)))
  // with d1/d2(x) = [ln(S/x) + (r - q +/- sigma^2/2) T] / (sigma sqrt(T)).
  // Folding the strike into the truncation bounds (max for calls, min for
  // puts) resolves every direction/type/strike-vs-barrier case at once.
  function truncatedVanilla(config, lowerBound, upperBound) {
    const { spot, strike, rate, dividendYield, volatility, maturity, optionType } = config;
    const rootVariance = volatility * Math.sqrt(maturity);
    const d2 = (x) => (Math.log(spot / x) +
      (rate - dividendYield - 0.5 * volatility * volatility) * maturity) / rootVariance;
    const cashMassAbove = (x) => (x <= 0.0 ? 1.0 : (Number.isFinite(x) ? normalCdf(d2(x)) : 0.0));
    const stockMassAbove = (x) => (
      x <= 0.0 ? 1.0 : (Number.isFinite(x) ? normalCdf(d2(x) + rootVariance) : 0.0));
    const isCall = optionType === "call";
    const lower = isCall ? Math.max(lowerBound, strike) : lowerBound;
    const upper = isCall ? upperBound : Math.min(upperBound, strike);
    if (upper <= lower) return 0.0;
    const stockLeg = spot * Math.exp(-dividendYield * maturity) *
      (stockMassAbove(lower) - stockMassAbove(upper));
    const cashLeg = strike * Math.exp(-rate * maturity) *
      (cashMassAbove(lower) - cashMassAbove(upper));
    return Math.max(isCall ? stockLeg - cashLeg : cashLeg - stockLeg, 0.0);
  }

  // "European barrier": the barrier is tested only at expiry, so the
  // knock-out is just the vanilla payoff truncated to the surviving
  // terminal region. The current spot's position relative to the barrier
  // is deliberately irrelevant here.
  function barrierTerminalClosedForm(config) {
    const out = config.barrierDirection === "down"
      ? truncatedVanilla(config, config.barrier, Infinity)
      : truncatedVanilla(config, 0.0, config.barrier);
    return config.barrierStyle === "in"
      ? Math.max(blackScholes(config) - out, 0.0)
      : out;
  }

  function doubleBarrierTerminalClosedForm(config) {
    const out = truncatedVanilla(config, config.lowerBarrier, config.upperBarrier);
    return config.barrierStyle === "in"
      ? Math.max(blackScholes(config) - out, 0.0)
      : out;
  }

  // ---- Automatic Monte Carlo error benchmark for the closed forms -------
  //
  // Every barrier closed form ships with a Sobol QMC estimate of the SAME
  // monitoring convention so the reported difference is the formula's
  // error, not a monitoring mismatch:
  //   continuous formulas  <-> bridge-corrected QMC (monteCarloPrice)
  //   BGK daily/weekly     <-> plain 0/1 indicator on the matching grid,
  //                            run on the ORIGINAL (unshifted) barriers
  //   barrier-at-maturity  <-> single-step terminal indicator
  // Fixed path count and no digital shift keep the benchmark reproducible
  // without any seed plumbing.
  const BENCHMARK_PATHS = 32768;

  function discreteBarrierQmc(config, steps) {
    const shifts = new Uint32Array(steps);
    const samples = new Float64Array(BENCHMARK_PATHS);
    const discount = Math.exp(-config.rate * config.maturity);
    const isDouble = config.product === "double-barrier";
    for (let pathIndex = 0; pathIndex < BENCHMARK_PATHS; pathIndex += 1) {
      const normals = pathNormals(pathIndex, steps, "qmc", null, shifts);
      const path = simulateGbmPath(config, normals);
      let knocked = false;
      for (const value of path) {
        const hit = isDouble
          ? (value <= config.lowerBarrier || value >= config.upperBarrier)
          : (config.barrierDirection === "down"
            ? value <= config.barrier : value >= config.barrier);
        if (hit) {
          knocked = true;
          break;
        }
      }
      const pays = config.barrierStyle === "in" ? knocked : !knocked;
      samples[pathIndex] = pays
        ? discount * vanillaPayoff(path[path.length - 1], config.strike, config.optionType)
        : 0.0;
    }
    const summary = summarizeSamples(samples, "mc");
    return {
      price: summary.price,
      standardError: summary.standardError,
      samples: summary.samples,
    };
  }

  function attachBarrierBenchmark(config, closedFormPrice, kind, steps) {
    const mc = kind === "bridge-qmc"
      ? monteCarloPrice(
        { ...config, paths: BENCHMARK_PATHS, monitoringSteps: 24, randomizedQmc: false }, "qmc")
      : discreteBarrierQmc(config, steps);
    const standardError = mc.standardError ?? (
      mc.standardDeviation != null ? mc.standardDeviation / Math.sqrt(BENCHMARK_PATHS) : null);
    return {
      price: mc.price,
      standardError,
      difference: closedFormPrice - mc.price,
      kind,
      samples: BENCHMARK_PATHS,
    };
  }

  function compoundClosedForm(config) {
    if (config.compoundStrike <= 1e-12) return blackScholes(config);
    const remaining = config.maturity - config.decisionTime;
    const callAtDecision = (underlyingSpot) => blackScholes({
      ...config,
      spot: underlyingSpot,
      maturity: remaining,
      optionType: "call",
    });
    let low = 1e-10;
    let high = Math.max(config.spot, config.strike) * 4.0;
    while (callAtDecision(high) < config.compoundStrike && high < 1e10) high *= 2.0;
    for (let iteration = 0; iteration < 120; iteration += 1) {
      const middle = 0.5 * (low + high);
      if (callAtDecision(middle) > config.compoundStrike) high = middle;
      else low = middle;
    }
    const critical = 0.5 * (low + high);
    const sigma = config.volatility;
    const b = config.rate - config.dividendYield;
    const t1 = config.decisionTime;
    const t2 = config.maturity;
    const a1 = (Math.log(config.spot / critical) + (b + 0.5 * sigma * sigma) * t1) /
      (sigma * Math.sqrt(t1));
    const a2 = a1 - sigma * Math.sqrt(t1);
    const b1 = (Math.log(config.spot / config.strike) + (b + 0.5 * sigma * sigma) * t2) /
      (sigma * Math.sqrt(t2));
    const b2 = b1 - sigma * Math.sqrt(t2);
    const correlation = Math.sqrt(t1 / t2);
    return config.spot * Math.exp(-config.dividendYield * t2) *
        bivariateNormalCdf(a1, b1, correlation)
      - config.strike * Math.exp(-config.rate * t2) *
        bivariateNormalCdf(a2, b2, correlation)
      - config.compoundStrike * Math.exp(-config.rate * t1) * normalCdf(a2);
  }

  function vanillaPayoff(spot, strike, optionType) {
    return optionType === "call" ? Math.max(spot - strike, 0.0) : Math.max(strike - spot, 0.0);
  }

  function digitalPayoff(terminal, strike, optionType, cashPayoff = 1.0) {
    const succeeds = optionType === "call" ? terminal > strike : terminal < strike;
    return succeeds ? cashPayoff : 0.0;
  }

  function barrierPayoff(terminal, strike, optionType, survivalProbability, barrierStyle) {
    const survival = Math.min(Math.max(survivalProbability, 0.0), 1.0);
    const weight = barrierStyle === "in" ? 1.0 - survival : survival;
    return vanillaPayoff(terminal, strike, optionType) * weight;
  }

  function singleBarrierPayoff(terminal, strike, optionType, survivalProbability, barrierStyle) {
    return barrierPayoff(terminal, strike, optionType, survivalProbability, barrierStyle);
  }

  function doubleBarrierPayoff(terminal, strike, optionType, survivalProbability, barrierStyle) {
    return barrierPayoff(terminal, strike, optionType, survivalProbability, barrierStyle);
  }

  function bermudanExercisePayoff(spot, strike, optionType) {
    return vanillaPayoff(spot, strike, optionType);
  }

  function rainbowPayoff(terminals, strike, optionType, rainbowStyle) {
    const basket = rainbowStyle === "worst" ? Math.min(...terminals) : Math.max(...terminals);
    return vanillaPayoff(basket, strike, optionType);
  }

  function autocallablePayoff(path, config) {
    for (let index = 0; index < path.length; index += 1) {
      if (path[index] >= config.autocallBarrier * config.initialSpot) {
        return {
          amount: config.notional * (1.0 + config.coupon * (index + 1)),
          time: config.maturity * (index + 1) / path.length,
          event: `Autocalled at observation ${index + 1}`,
        };
      }
    }
    const terminal = path[path.length - 1];
    if (terminal >= config.protectionBarrier * config.initialSpot) {
      return {
        amount: config.notional * (1.0 + config.coupon * path.length),
        time: config.maturity,
        event: "Protected maturity redemption",
      };
    }
    return {
      amount: config.notional * terminal / config.initialSpot,
      time: config.maturity,
      event: "Downside-linked maturity redemption",
    };
  }

  function himalayanPayoff(selectedReturns, notional, returnStrike) {
    const averageReturn = selectedReturns.reduce((sum, value) => sum + value, 0.0) /
      selectedReturns.length;
    return notional * Math.max(averageReturn - returnStrike, 0.0);
  }

  function lookbackPayoff(path, strike, optionType) {
    let extremum = path[0];
    for (let index = 1; index < path.length; index += 1) {
      extremum = optionType === "call"
        ? Math.max(extremum, path[index])
        : Math.min(extremum, path[index]);
    }
    return vanillaPayoff(extremum, strike, optionType);
  }

  function ladderPayoff(path, strike, optionType, ladderRungs) {
    let locked = 0.0;
    const rungs = ladderRungs.filter((value) => Number.isFinite(value));
    for (const value of path) {
      for (const rung of rungs) {
        if (optionType === "call" && value >= rung) locked = Math.max(locked, rung - strike);
        if (optionType === "put" && value <= rung) locked = Math.max(locked, strike - rung);
      }
    }
    return Math.max(locked, vanillaPayoff(path[path.length - 1], strike, optionType));
  }

  function compoundPayoff(underlyingOptionValue, compoundStrike, outerType = "call") {
    return outerType === "call"
      ? Math.max(underlyingOptionValue - compoundStrike, 0.0)
      : Math.max(compoundStrike - underlyingOptionValue, 0.0);
  }

  const PAYOFF_DEFINITIONS = Object.freeze({
    vanilla: {
      label: "Vanilla / American exercise",
      formula: "Call: max(S - K, 0); Put: max(K - S, 0)",
      description: "The baseline intrinsic value used by European, American, and Bermudan exercise decisions.",
    },
    digital: {
      label: "Digital / binary",
      formula: "Cash x indicator(S_T > K) for a call; Cash x indicator(S_T < K) for a put",
      description: "Pays a fixed cash amount only when the terminal price finishes strictly beyond the strike.",
    },
    barrier: {
      label: "Single barrier",
      formula: "Vanilla payoff x survival for knock-out; vanilla payoff x (1 - survival) for knock-in",
      description: "A deterministic hit is represented by survival 0; Brownian-bridge Monte Carlo can use a fractional survival weight.",
    },
    "double-barrier": {
      label: "Double barrier",
      formula: "Vanilla payoff x survival inside both barriers, or its knock-in complement",
      description: "The payoff vanishes after either boundary is hit for a double knock-out and activates for a double knock-in.",
    },
    bermudan: {
      label: "Bermudan exercise",
      formula: "max(S_t - K, 0) or max(K - S_t, 0) on an allowed exercise date",
      description: "The immediate exercise amount is vanilla intrinsic value; pricing compares it with continuation value.",
    },
    rainbow: {
      label: "Rainbow best / worst of two",
      formula: "Vanilla payoff on max(S1, S2) for best-of or min(S1, S2) for worst-of",
      description: "Selects the relevant asset performance first, then applies the call or put strike.",
    },
    autocallable: {
      label: "Autocallable note",
      formula: "Early notional plus accrued coupons; otherwise protected or downside-linked redemption at maturity",
      description: "The first observation above the call barrier redeems the note; missed calls continue to maturity.",
    },
    himalayan: {
      label: "Himalayan",
      formula: "Notional x max(average selected return - return strike, 0)",
      description: "Each observation locks the best remaining asset return; the selected returns are averaged.",
    },
    lookback: {
      label: "Fixed-strike lookback",
      formula: "Call: max(path maximum - K, 0); Put: max(K - path minimum, 0)",
      description: "Uses the most favorable monitored price over the path rather than only the terminal price.",
    },
    ladder: {
      label: "Ladder",
      formula: "max(highest locked rung value, terminal vanilla intrinsic value)",
      description: "Crossed rungs lock gains that cannot be lost if the terminal price later reverses.",
    },
    compound: {
      label: "Compound option",
      formula: "Outer call: max(V_inner - Kc, 0); Outer put: max(Kc - V_inner, 0)",
      description: "The inner option can be a call or put, and the outer option can independently be a call or put.",
    },
  });

  function pathNormals(pathIndex, dimensions, source, rng, shifts) {
    const values = new Float64Array(dimensions);
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      const uniform = source === "qmc"
        ? sobolUniform(pathIndex + 1, dimension, shifts[dimension])
        : rng.uniform();
      values[dimension] = inverseNormalCdf(uniform);
    }
    return values;
  }

  function simulateGbmPath(config, normals) {
    const steps = normals.length;
    const dt = config.maturity / steps;
    const drift = (config.rate - config.dividendYield - 0.5 * config.volatility ** 2) * dt;
    const diffusion = config.volatility * Math.sqrt(dt);
    const values = new Float64Array(steps);
    let current = config.spot;
    for (let step = 0; step < steps; step += 1) {
      current *= Math.exp(drift + diffusion * normals[step]);
      values[step] = current;
    }
    return values;
  }

  function equicorrelatedNormals(independent, correlation) {
    const count = independent.length;
    if (count === 1) return Float64Array.from(independent);
    const lower = Array.from({ length: count }, () => new Float64Array(count));
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column <= row; column += 1) {
        let value = row === column ? 1.0 : correlation;
        for (let offset = 0; offset < column; offset += 1) {
          value -= lower[row][offset] * lower[column][offset];
        }
        // Semidefinite pivot guard: at |rho| = 1 the matrix is rank-1 and
        // the diagonal pivot hits exactly zero -- dividing would give 0/0
        // NaNs. Zeroing the column instead yields the correct comonotone
        // limit (every asset driven by the first normal).
        lower[row][column] = row === column
          ? Math.sqrt(Math.max(value, 0.0))
          : (Math.abs(lower[column][column]) > 1e-14 ? value / lower[column][column] : 0.0);
      }
    }
    const correlated = new Float64Array(count);
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column <= row; column += 1) {
        correlated[row] += lower[row][column] * independent[column];
      }
    }
    return correlated;
  }

  // Assets beyond the primary (index 0, which reuses the single Underlying
  // asset(s) dialog's spot/volatility/dividendYield) come from the
  // arbitrary-length assetSpots/assetVolatilities/assetDividendYields
  // arrays -- rainbow and himalayan are no longer hardcoded to 2/3 assets.
  function basketSpots(config) { return [config.spot, ...config.assetSpots]; }
  function basketVolatilities(config) { return [config.volatility, ...config.assetVolatilities]; }
  function basketDividendYields(config) { return [config.dividendYield, ...config.assetDividendYields]; }

  function bridgeSurvival(previous, current, barrier, direction, varianceDt) {
    if (direction === "up") {
      if (previous >= barrier || current >= barrier) return 0.0;
      const hit = Math.exp(-2.0 * Math.log(barrier / previous) *
        Math.log(barrier / current) / varianceDt);
      return Math.max(1.0 - hit, 0.0);
    }
    if (previous <= barrier || current <= barrier) return 0.0;
    const hit = Math.exp(-2.0 * Math.log(previous / barrier) *
      Math.log(current / barrier) / varianceDt);
    return Math.max(1.0 - hit, 0.0);
  }

  function singlePathPresentValue(config, source, pathIndex, rng, shifts) {
    if (config.product === "digital") {
      const z = pathNormals(pathIndex, 1, source, rng, shifts)[0];
      const terminal = config.spot * Math.exp(
        (config.rate - config.dividendYield - 0.5 * config.volatility ** 2) * config.maturity +
        config.volatility * Math.sqrt(config.maturity) * z,
      );
      return Math.exp(-config.rate * config.maturity) *
        digitalPayoff(terminal, config.strike, config.optionType, config.cashPayoff);
    }
    if (config.product === "compound") {
      if (config.compoundStrike <= 1e-12) {
        const z = pathNormals(pathIndex, 1, source, rng, shifts)[0];
        const terminal = config.spot * Math.exp(
          (config.rate - config.dividendYield - 0.5 * config.volatility ** 2) * config.maturity +
          config.volatility * Math.sqrt(config.maturity) * z,
        );
        return Math.exp(-config.rate * config.maturity) *
          compoundPayoff(vanillaPayoff(terminal, config.strike, "call"), 0.0);
      }
      const z = pathNormals(pathIndex, 1, source, rng, shifts)[0];
      const decisionSpot = config.spot * Math.exp(
        (config.rate - config.dividendYield - 0.5 * config.volatility ** 2) * config.decisionTime +
        config.volatility * Math.sqrt(config.decisionTime) * z,
      );
      const underlyingCall = blackScholes({
        ...config,
        spot: decisionSpot,
        maturity: config.maturity - config.decisionTime,
        optionType: "call",
      });
      return Math.exp(-config.rate * config.decisionTime) *
        compoundPayoff(underlyingCall, config.compoundStrike);
    }
    if (config.product === "rainbow") {
      const assets = config.assetCount;
      const normals = pathNormals(pathIndex, assets, source, rng, shifts);
      const correlated = equicorrelatedNormals(normals, config.correlation);
      const spots = basketSpots(config).slice(0, assets);
      const vols = basketVolatilities(config).slice(0, assets);
      const dividends = basketDividendYields(config).slice(0, assets);
      const terminals = spots.map((spot, index) => spot * Math.exp(
        (config.rate - dividends[index] - 0.5 * vols[index] ** 2) * config.maturity +
        vols[index] * Math.sqrt(config.maturity) * correlated[index],
      ));
      return Math.exp(-config.rate * config.maturity) *
        rainbowPayoff(terminals, config.strike, config.optionType, config.rainbowStyle);
    }
    if (config.product === "himalayan") {
      const assets = config.assetCount;
      const observations = Math.min(config.observations, assets);
      const normals = pathNormals(pathIndex, assets * observations, source, rng, shifts);
      const spots = basketSpots(config).slice(0, assets);
      const vols = basketVolatilities(config).slice(0, assets);
      const dividends = basketDividendYields(config).slice(0, assets);
      const active = new Set(Array.from({ length: assets }, (_, index) => index));
      const dt = config.maturity / observations;
      const selectedReturns = [];
      for (let observation = 0; observation < observations; observation += 1) {
        const previous = spots.slice();
        const independent = normals.slice(
          observation * assets, (observation + 1) * assets,
        );
        const correlated = equicorrelatedNormals(independent, config.correlation);
        for (let asset = 0; asset < assets; asset += 1) {
          spots[asset] *= Math.exp(
            (config.rate - dividends[asset] - 0.5 * vols[asset] ** 2) * dt +
            vols[asset] * Math.sqrt(dt) * correlated[asset],
          );
        }
        let bestAsset = -1;
        let bestReturn = -Infinity;
        for (const asset of active) {
          const intervalReturn = spots[asset] / previous[asset] - 1.0;
          if (intervalReturn > bestReturn) {
            bestReturn = intervalReturn;
            bestAsset = asset;
          }
        }
        selectedReturns.push(bestReturn);
        active.delete(bestAsset);
      }
      return Math.exp(-config.rate * config.maturity) *
        himalayanPayoff(selectedReturns, config.notional, config.returnStrike);
    }

    const steps = config.monitoringSteps;
    const normals = pathNormals(pathIndex, steps, source, rng, shifts);
    const path = simulateGbmPath(config, normals);
    const terminal = path[path.length - 1];
    if (config.product === "lookback") {
      return Math.exp(-config.rate * config.maturity) *
        lookbackPayoff(path, config.strike, config.optionType);
    }
    if (config.product === "ladder") {
      return Math.exp(-config.rate * config.maturity) *
        ladderPayoff(path, config.strike, config.optionType, config.ladderRungs);
    }
    if (config.product === "autocallable") {
      const redemption = autocallablePayoff(path, {
        initialSpot: config.spot,
        notional: config.notional,
        coupon: config.coupon,
        autocallBarrier: config.autocallBarrier,
        protectionBarrier: config.protectionBarrier,
        maturity: config.maturity,
      });
      return Math.exp(-config.rate * redemption.time) * redemption.amount;
    }
    if (config.product === "barrier" || config.product === "double-barrier") {
      const dt = config.maturity / steps;
      const varianceDt = config.volatility ** 2 * dt;
      let survival = 1.0;
      let previous = config.spot;
      for (const value of path) {
        if (config.product === "barrier") {
          survival *= bridgeSurvival(previous, value, config.barrier,
            config.barrierDirection, varianceDt);
        } else {
          survival *= bridgeSurvival(previous, value, config.upperBarrier, "up", varianceDt);
          survival *= bridgeSurvival(previous, value, config.lowerBarrier, "down", varianceDt);
        }
        previous = value;
      }
      const payoffFunction = config.product === "barrier"
        ? singleBarrierPayoff
        : doubleBarrierPayoff;
      return Math.exp(-config.rate * config.maturity) * payoffFunction(
        terminal, config.strike, config.optionType, survival, config.barrierStyle,
      );
    }
    throw new Error(`Monte Carlo is not configured for ${config.product}.`);
  }

  function summarizeSamples(samples, source) {
    const count = samples.length;
    const mean = samples.reduce((sum, value) => sum + value, 0.0) / count;
    const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0.0) /
      Math.max(count - 1, 1);
    return {
      price: mean,
      standardDeviation: Math.sqrt(Math.max(variance, 0.0)),
      standardError: source === "qmc" ? null : Math.sqrt(Math.max(variance, 0.0) / count),
      samples: count,
    };
  }

  function monteCarloPrice(config, source) {
    if (config.product === "bermudan") return bermudanLsm(config, source);
    let dimensions;
    if (["digital", "compound"].includes(config.product)) dimensions = 1;
    else if (config.product === "rainbow") dimensions = config.assetCount;
    else if (config.product === "himalayan") dimensions = config.assetCount *
      Math.min(config.observations, config.assetCount);
    else dimensions = config.monitoringSteps;
    const rng = new Pcg32(config.seed);
    const shifts = new Uint32Array(dimensions);
    if (source === "qmc" && config.randomizedQmc) {
      for (let dimension = 0; dimension < dimensions; dimension += 1) shifts[dimension] = rng.nextU32();
    }
    const samples = new Float64Array(config.paths);
    for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
      samples[pathIndex] = singlePathPresentValue(config, source, pathIndex, rng, shifts);
    }
    return summarizeSamples(samples, source);
  }

  function solveThreeByThree(matrix, vector) {
    const augmented = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < 3; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < 3; row += 1) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
      }
      [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
      if (Math.abs(augmented[column][column]) < 1e-12) return [0, 0, 0];
      const scale = augmented[column][column];
      for (let item = column; item < 4; item += 1) augmented[column][item] /= scale;
      for (let row = 0; row < 3; row += 1) {
        if (row === column) continue;
        const factor = augmented[row][column];
        for (let item = column; item < 4; item += 1) {
          augmented[row][item] -= factor * augmented[column][item];
        }
      }
    }
    return augmented.map((row) => row[3]);
  }

  function bermudanLsm(config, source) {
    const dates = config.exerciseDates;
    const rng = new Pcg32(config.seed);
    const shifts = new Uint32Array(dates);
    if (source === "qmc" && config.randomizedQmc) {
      for (let dimension = 0; dimension < dates; dimension += 1) shifts[dimension] = rng.nextU32();
    }
    const paths = Array.from({ length: config.paths }, () => new Float64Array(dates));
    for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
      const normals = pathNormals(pathIndex, dates, source, rng, shifts);
      paths[pathIndex] = simulateGbmPath({ ...config, monitoringSteps: dates }, normals);
    }
    const cashflow = new Float64Array(config.paths);
    const exerciseTime = new Float64Array(config.paths);
    for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
      cashflow[pathIndex] = bermudanExercisePayoff(
        paths[pathIndex][dates - 1], config.strike, config.optionType,
      );
      exerciseTime[pathIndex] = config.maturity;
    }
    const dt = config.maturity / dates;
    for (let dateIndex = dates - 2; dateIndex >= 0; dateIndex -= 1) {
      const time = (dateIndex + 1) * dt;
      const rows = [];
      for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
        const spot = paths[pathIndex][dateIndex];
        const intrinsic = bermudanExercisePayoff(spot, config.strike, config.optionType);
        if (intrinsic > 0.0) {
          rows.push({
            pathIndex,
            x: spot / config.strike,
            intrinsic,
            y: cashflow[pathIndex] * Math.exp(-config.rate * (exerciseTime[pathIndex] - time)),
          });
        }
      }
      const sums = [0, 0, 0, 0, 0];
      const targets = [0, 0, 0];
      for (const row of rows) {
        const powers = [1, row.x, row.x * row.x, row.x ** 3, row.x ** 4];
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
        const continuation = coefficients[0] + coefficients[1] * row.x +
          coefficients[2] * row.x * row.x;
        if (row.intrinsic > continuation) {
          cashflow[row.pathIndex] = row.intrinsic;
          exerciseTime[row.pathIndex] = time;
        }
      }
    }
    const presentValues = new Float64Array(config.paths);
    for (let pathIndex = 0; pathIndex < config.paths; pathIndex += 1) {
      presentValues[pathIndex] = cashflow[pathIndex] *
        Math.exp(-config.rate * exerciseTime[pathIndex]);
    }
    return summarizeSamples(presentValues, source);
  }

  function bermudanTree(config) {
    const steps = config.treeSteps;
    const dt = config.maturity / steps;
    const up = Math.exp(config.volatility * Math.sqrt(dt));
    const down = 1.0 / up;
    const probability = (Math.exp((config.rate - config.dividendYield) * dt) - down) /
      (up - down);
    if (probability < 0.0 || probability > 1.0) throw new Error("Invalid CRR probability.");
    const discount = Math.exp(-config.rate * dt);
    const values = new Float64Array(steps + 1);
    let terminal = config.spot * down ** steps;
    const ratio = up / down;
    for (let node = 0; node <= steps; node += 1) {
      values[node] = bermudanExercisePayoff(terminal, config.strike, config.optionType);
      terminal *= ratio;
    }
    const exerciseLevels = new Set();
    for (let date = 1; date < config.exerciseDates; date += 1) {
      exerciseLevels.add(Math.round(date * steps / config.exerciseDates));
    }
    for (let level = steps - 1; level >= 0; level -= 1) {
      let nodeSpot = config.spot * down ** level;
      for (let node = 0; node <= level; node += 1) {
        const continuation = discount *
          (probability * values[node + 1] + (1.0 - probability) * values[node]);
        values[node] = exerciseLevels.has(level)
          ? Math.max(continuation, bermudanExercisePayoff(nodeSpot, config.strike, config.optionType))
          : continuation;
        nodeSpot *= ratio;
      }
    }
    return { price: values[0], standardError: null, standardDeviation: null, samples: steps };
  }

  function thomasSolve(lower, diagonal, upper, right) {
    const count = diagonal.length;
    const cPrime = new Float64Array(count);
    const dPrime = new Float64Array(count);
    cPrime[0] = upper[0] / diagonal[0];
    dPrime[0] = right[0] / diagonal[0];
    for (let index = 1; index < count; index += 1) {
      const denominator = diagonal[index] - lower[index] * cPrime[index - 1];
      cPrime[index] = index === count - 1 ? 0.0 : upper[index] / denominator;
      dPrime[index] = (right[index] - lower[index] * dPrime[index - 1]) / denominator;
    }
    const solution = new Float64Array(count);
    solution[count - 1] = dPrime[count - 1];
    for (let index = count - 2; index >= 0; index -= 1) {
      solution[index] = dPrime[index] - cPrime[index] * solution[index + 1];
    }
    return solution;
  }

  function buildSpatialGrid(minimum, maximum, points, type = "uniform", focus = 0.0,
    concentration = 0.12) {
    if (!(maximum > minimum) || !Number.isInteger(points) || points < 2) {
      throw new Error("PDE grid requires an increasing domain and at least two intervals.");
    }
    const grid = new Float64Array(points + 1);
    if (type === "uniform") {
      const spacing = (maximum - minimum) / points;
      for (let index = 0; index <= points; index += 1) grid[index] = minimum + index * spacing;
      return grid;
    }
    if (!["sinh-strike", "sinh-spot"].includes(type)) throw new Error("Unknown PDE grid type.");
    const center = Math.min(Math.max(focus, minimum), maximum);
    const scale = Math.max((maximum - minimum) * concentration, (maximum - minimum) * 1e-6);
    const lowerCoordinate = Math.asinh((minimum - center) / scale);
    const upperCoordinate = Math.asinh((maximum - center) / scale);
    for (let index = 0; index <= points; index += 1) {
      const coordinate = lowerCoordinate + (upperCoordinate - lowerCoordinate) * index / points;
      grid[index] = center + scale * Math.sinh(coordinate);
    }
    grid[0] = minimum;
    grid[points] = maximum;
    return grid;
  }

  function interpolateOnGrid(grid, values, point) {
    if (point <= grid[0]) return values[0];
    const last = grid.length - 1;
    if (point >= grid[last]) return values[last];
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (grid[middle] <= point) low = middle;
      else high = middle;
    }
    const weight = (point - grid[low]) / (grid[high] - grid[low]);
    return values[low] * (1.0 - weight) + values[high] * weight;
  }

  function finiteDifferenceCoefficients(config, grid, index) {
    const asset = grid[index];
    const leftSpacing = asset - grid[index - 1];
    const rightSpacing = grid[index + 1] - asset;
    const firstLeft = -rightSpacing / (leftSpacing * (leftSpacing + rightSpacing));
    const firstCenter = (rightSpacing - leftSpacing) / (leftSpacing * rightSpacing);
    const firstRight = leftSpacing / (rightSpacing * (leftSpacing + rightSpacing));
    const secondLeft = 2.0 / (leftSpacing * (leftSpacing + rightSpacing));
    const secondCenter = -2.0 / (leftSpacing * rightSpacing);
    const secondRight = 2.0 / (rightSpacing * (leftSpacing + rightSpacing));
    const diffusion = 0.5 * config.volatility ** 2 * asset ** 2;
    const drift = (config.rate - config.dividendYield) * asset;
    return {
      lower: diffusion * secondLeft + drift * firstLeft,
      diagonal: diffusion * secondCenter + drift * firstCenter - config.rate,
      upper: diffusion * secondRight + drift * firstRight,
    };
  }

  function averageTerminalPayoff(config, left, right) {
    const width = Math.max(right - left, 1e-14);
    if (config.product === "digital") {
      const favorable = config.optionType === "call"
        ? Math.max(right - Math.max(left, config.strike), 0.0)
        : Math.max(Math.min(right, config.strike) - left, 0.0);
      return config.cashPayoff * favorable / width;
    }
    if (config.optionType === "call") {
      if (right <= config.strike) return 0.0;
      const start = Math.max(left, config.strike);
      return 0.5 * ((right - config.strike) ** 2 - (start - config.strike) ** 2) / width;
    }
    if (left >= config.strike) return 0.0;
    const end = Math.min(right, config.strike);
    return (config.strike * (end - left) - 0.5 * (end ** 2 - left ** 2)) / width;
  }

  function terminalGridValues(config, grid) {
    const last = grid.length - 1;
    const values = new Float64Array(grid.length);
    for (let index = 0; index <= last; index += 1) {
      if (config.pdePayoffSmoothing === "cell-average") {
        const left = index === 0 ? grid[0] : 0.5 * (grid[index - 1] + grid[index]);
        const right = index === last ? grid[last] : 0.5 * (grid[index] + grid[index + 1]);
        values[index] = averageTerminalPayoff(config, left, right);
      } else if (config.product === "digital") {
        values[index] = digitalPayoff(grid[index], config.strike, config.optionType, config.cashPayoff);
      } else {
        values[index] = vanillaPayoff(grid[index], config.strike, config.optionType);
      }
    }
    return values;
  }

  function projectedSolve(lower, diagonal, upper, right, obstacle) {
    const solution = thomasSolve(lower, diagonal, upper, right);
    for (let index = 0; index < solution.length; index += 1) {
      solution[index] = Math.max(solution[index], obstacle[index]);
    }
    return { solution, iterations: 1, converged: true };
  }

  function psorSolve(lower, diagonal, upper, right, obstacle, initial, config) {
    const solution = Float64Array.from(initial);
    let converged = false;
    let iteration = 0;
    for (; iteration < config.pdeMaxIterations; iteration += 1) {
      let maximumChange = 0.0;
      for (let index = 0; index < solution.length; index += 1) {
        const before = solution[index];
        const left = index > 0 ? lower[index] * solution[index - 1] : 0.0;
        const rightValue = index + 1 < solution.length ? upper[index] * solution[index + 1] : 0.0;
        const gaussSeidel = (right[index] - left - rightValue) / diagonal[index];
        solution[index] = Math.max(
          obstacle[index],
          before + config.pdeSorOmega * (gaussSeidel - before),
        );
        maximumChange = Math.max(maximumChange, Math.abs(solution[index] - before));
      }
      if (maximumChange <= config.pdeTolerance) {
        converged = true;
        iteration += 1;
        break;
      }
    }
    return { solution, iterations: iteration, converged };
  }

  function penaltySolve(lower, diagonal, upper, right, obstacle, initial, config) {
    let solution = Float64Array.from(initial);
    let converged = false;
    let iteration = 0;
    for (; iteration < config.pdeMaxIterations; iteration += 1) {
      const penalizedDiagonal = Float64Array.from(diagonal);
      const penalizedRight = Float64Array.from(right);
      const active = [];
      for (let index = 0; index < solution.length; index += 1) {
        // The active set is a complementarity classification, not a convergence
        // test.  Using the user tolerance here can make a node oscillate between
        // active and inactive when the finite penalty gap is of the same order.
        if (solution[index] < obstacle[index]) {
          penalizedDiagonal[index] += config.pdePenalty;
          penalizedRight[index] += config.pdePenalty * obstacle[index];
          active.push(index);
        }
      }
      const next = thomasSolve(lower, penalizedDiagonal, upper, penalizedRight);
      let maximumChange = 0.0;
      for (let index = 0; index < solution.length; index += 1) {
        maximumChange = Math.max(maximumChange, Math.abs(next[index] - solution[index]));
      }
      solution = next;
      let maximumResidual = 0.0;
      let residualScale = 1.0;
      for (let index = 0; index < solution.length; index += 1) {
        const matrixValue = diagonal[index] * solution[index] +
          (index > 0 ? lower[index] * solution[index - 1] : 0.0) +
          (index + 1 < solution.length ? upper[index] * solution[index + 1] : 0.0);
        const residual = matrixValue - right[index] -
          config.pdePenalty * Math.max(obstacle[index] - solution[index], 0.0);
        maximumResidual = Math.max(maximumResidual, Math.abs(residual));
        residualScale = Math.max(residualScale, Math.abs(right[index]));
      }
      if (maximumResidual <= config.pdeTolerance * residualScale ||
        maximumChange <= config.pdeTolerance * 0.1) {
        converged = true;
        iteration += 1;
        break;
      }
    }
    for (let index = 0; index < solution.length; index += 1) {
      solution[index] = Math.max(solution[index], obstacle[index]);
    }
    return { solution, iterations: iteration, converged };
  }

  function pdeSolve(config, requestedSolver = config.pdeAmericanSolver) {
    const gridPoints = config.pdeGrid;
    const timeSteps = config.pdeTimeSteps;
    let minimum = 0.0;
    let maximum = Math.max(config.spot, config.strike) * 4.0;
    let lowerKnockout = false;
    let upperKnockout = false;
    if (config.product === "barrier") {
      if (config.barrierDirection === "down") {
        minimum = config.barrier;
        lowerKnockout = true;
      } else {
        maximum = config.barrier;
        upperKnockout = true;
      }
    } else if (config.product === "double-barrier") {
      minimum = config.lowerBarrier;
      maximum = config.upperBarrier;
      lowerKnockout = true;
      upperKnockout = true;
    }
    if (config.spot <= minimum || config.spot >= maximum) {
      const knockedOut = 0.0;
      const price = ((config.product === "barrier" || config.product === "double-barrier") &&
        config.barrierStyle === "in") ? blackScholes(config) : knockedOut;
      return {
        price,
        grid: new Float64Array(),
        diagnostics: {
          solver: "boundary-hit", gridType: config.pdeGridType,
          payoffSmoothing: config.pdePayoffSmoothing, rannacherSteps: config.pdeRannacherSteps,
          totalIterations: 0, maximumIterations: 0, converged: true,
        },
      };
    }
    const focus = config.pdeGridType === "sinh-spot" ? config.spot : config.strike;
    const grid = buildSpatialGrid(
      minimum, maximum, gridPoints, config.pdeGridType, focus, config.pdeGridConcentration,
    );
    const dt = config.maturity / timeSteps;
    const interior = gridPoints - 1;
    let values = terminalGridValues(config, grid);
    if (lowerKnockout) values[0] = 0.0;
    if (upperKnockout) values[gridPoints] = 0.0;
    const exerciseLevels = new Set();
    if (config.product === "bermudan") {
      for (let date = 1; date < config.exerciseDates; date += 1) {
        const calendarLevel = Math.round(date * timeSteps / config.exerciseDates);
        exerciseLevels.add(timeSteps - calendarLevel);
      }
    }
    const solver = requestedSolver || "projection";
    if (config.product === "american" && !["projection", "psor", "penalty"].includes(solver)) {
      throw new Error("American PDE solver must be projection, psor, or penalty.");
    }
    let totalIterations = 0;
    let maximumIterations = 0;
    let allConverged = true;
    let dampingRemaining = config.pdeRannacherSteps;
    const boundary = (isLower, tau) => {
        if ((isLower && lowerKnockout) || (!isLower && upperKnockout)) return 0.0;
        if (config.product === "digital") {
          const favorable = (isLower && config.optionType === "put") ||
            (!isLower && config.optionType === "call");
          return favorable ? config.cashPayoff * Math.exp(-config.rate * tau) : 0.0;
        }
        if (config.product === "american") {
          return vanillaPayoff(isLower ? minimum : maximum, config.strike, config.optionType);
        }
        if (isLower) return config.optionType === "put"
          ? config.strike * Math.exp(-config.rate * tau) : 0.0;
        return config.optionType === "call"
          ? maximum * Math.exp(-config.dividendYield * tau) -
            config.strike * Math.exp(-config.rate * tau)
          : 0.0;
      };

    const advance = (stepSize, theta, oldTau, newTau) => {
      const oldLower = boundary(true, oldTau);
      const oldUpper = boundary(false, oldTau);
      const newLower = boundary(true, newTau);
      const newUpper = boundary(false, newTau);
      values[0] = oldLower;
      values[gridPoints] = oldUpper;
      const lower = new Float64Array(interior);
      const diagonal = new Float64Array(interior);
      const upper = new Float64Array(interior);
      const right = new Float64Array(interior);
      for (let row = 0; row < interior; row += 1) {
        const index = row + 1;
        const coefficients = finiteDifferenceCoefficients(config, grid, index);
        lower[row] = -theta * stepSize * coefficients.lower;
        diagonal[row] = 1.0 - theta * stepSize * coefficients.diagonal;
        upper[row] = -theta * stepSize * coefficients.upper;
        const explicitWeight = 1.0 - theta;
        right[row] = explicitWeight * stepSize * coefficients.lower * values[index - 1] +
          (1.0 + explicitWeight * stepSize * coefficients.diagonal) * values[index] +
          explicitWeight * stepSize * coefficients.upper * values[index + 1];
      }
      right[0] -= lower[0] * newLower;
      right[interior - 1] -= upper[interior - 1] * newUpper;
      lower[0] = 0.0;
      upper[interior - 1] = 0.0;
      let solved;
      if (config.product === "american") {
        const obstacle = Float64Array.from(
          { length: interior }, (_, row) => vanillaPayoff(grid[row + 1], config.strike, config.optionType),
        );
        const initial = values.slice(1, gridPoints);
        if (solver === "psor") solved = psorSolve(lower, diagonal, upper, right, obstacle, initial, config);
        else if (solver === "penalty") solved = penaltySolve(lower, diagonal, upper, right, obstacle, initial, config);
        else solved = projectedSolve(lower, diagonal, upper, right, obstacle);
        totalIterations += solved.iterations;
        maximumIterations = Math.max(maximumIterations, solved.iterations);
        allConverged = allConverged && solved.converged;
      } else {
        solved = { solution: thomasSolve(lower, diagonal, upper, right), iterations: 1, converged: true };
      }
      values[0] = newLower;
      values[gridPoints] = newUpper;
      for (let row = 0; row < interior; row += 1) values[row + 1] = solved.solution[row];
    };

    for (let timeIndex = 1; timeIndex <= timeSteps; timeIndex += 1) {
      const oldTau = (timeIndex - 1) * dt;
      const newTau = timeIndex * dt;
      if (dampingRemaining > 0) {
        advance(0.5 * dt, 1.0, oldTau, oldTau + 0.5 * dt);
        advance(0.5 * dt, 1.0, oldTau + 0.5 * dt, newTau);
        dampingRemaining -= 1;
      } else {
        advance(dt, 0.5, oldTau, newTau);
      }
      if (config.product === "bermudan" && exerciseLevels.has(timeIndex)) {
        for (let index = 1; index < gridPoints; index += 1) {
          values[index] = Math.max(values[index], vanillaPayoff(
            grid[index], config.strike, config.optionType,
          ));
        }
        dampingRemaining = config.pdeRannacherSteps;
      }
    }
    const outPrice = interpolateOnGrid(grid, values, config.spot);
    const price = ((config.product === "barrier" || config.product === "double-barrier") &&
      config.barrierStyle === "in")
      ? Math.max(blackScholes(config) - outPrice, 0.0)
      : outPrice;
    return {
      price,
      grid,
      diagnostics: {
        solver: config.product === "american" ? solver : "linear-thomas",
        gridType: config.pdeGridType,
        payoffSmoothing: config.pdePayoffSmoothing,
        rannacherSteps: config.pdeRannacherSteps,
        totalIterations,
        maximumIterations,
        converged: allConverged,
      },
    };
  }

  function pdePrice(config, solver) {
    return pdeSolve(config, solver).price;
  }

  const PRODUCT_METHODS = {
    american: ["pde-projection", "pde-psor", "pde-penalty"],
    digital: ["closed-form", "pde", "mc", "qmc"],
    barrier: ["closed-form", "closed-form-daily", "closed-form-weekly", "closed-form-terminal",
      "pde", "mc", "qmc"],
    "double-barrier": ["semi-closed", "closed-form-daily", "closed-form-weekly",
      "closed-form-terminal", "pde", "mc", "qmc"],
    bermudan: ["tree", "pde", "mc", "qmc"],
    rainbow: ["mc", "qmc"],
    autocallable: ["mc", "qmc"],
    himalayan: ["mc", "qmc"],
    lookback: ["mc", "qmc"],
    ladder: ["mc", "qmc"],
    compound: ["closed-form", "mc", "qmc"],
  };

  const PRODUCT_DESCRIPTIONS = {
    american: "Continuously exercisable vanilla call or put solved as a Black-Scholes PDE complementarity problem.",
    digital: "Cash-or-nothing binary payoff: cash × 1{call: S(T)>K; put: S(T)<K}.",
    barrier: "Single continuously monitored knock-in or knock-out vanilla payoff.",
    "double-barrier": "Vanilla payoff survives only while the asset remains between two barriers.",
    bermudan: "Vanilla call or put exercisable on a finite set of scheduled dates.",
    rainbow: "Call or put on the best or worst of two correlated assets.",
    autocallable: "Coupon note redeemed early when an observation meets the call barrier; otherwise capital protection applies at maturity.",
    himalayan: "At each fixing the best remaining asset return is locked and that asset is removed; payoff uses the average locked return.",
    lookback: "Discrete fixed-strike lookback on the monitored maximum (call) or minimum (put).",
    ladder: "Vanilla payoff with intrinsic value locked when monitored ladder rungs are reached.",
    compound: "European call on a European call, valued with the Geske bivariate-normal formula.",
  };

  function normalizeConfig(input) {
    const config = {
      product: input.product || "digital",
      spot: Number(input.spot ?? 100),
      strike: Number(input.strike ?? 100),
      rate: Number(input.rate ?? 0.05),
      dividendYield: Number(input.dividendYield ?? 0.0),
      volatility: Number(input.volatility ?? 0.2),
      maturity: Number(input.maturity ?? 1.0),
      optionType: input.optionType || "call",
      paths: Math.trunc(Number(input.paths ?? 50000)),
      seed: Math.trunc(Number(input.seed ?? 42)),
      randomizedQmc: Boolean(input.randomizedQmc),
      monitoringSteps: Math.trunc(Number(input.monitoringSteps ?? 12)),
      pdeGrid: Math.trunc(Number(input.pdeGrid ?? 220)),
      pdeTimeSteps: Math.trunc(Number(input.pdeTimeSteps ?? 400)),
      pdeGridType: input.pdeGridType || "uniform",
      pdeGridConcentration: Number(input.pdeGridConcentration ?? 0.12),
      pdePayoffSmoothing: input.pdePayoffSmoothing ||
        ((input.product || "digital") === "digital" ? "cell-average" : "none"),
      pdeRannacherSteps: Math.trunc(Number(input.pdeRannacherSteps ?? 2)),
      pdeAmericanSolver: input.pdeAmericanSolver || "projection",
      pdeSorOmega: Number(input.pdeSorOmega ?? 1.2),
      pdeTolerance: Number(input.pdeTolerance ?? 1e-8),
      pdeMaxIterations: Math.trunc(Number(input.pdeMaxIterations ?? 10000)),
      pdePenalty: Number(input.pdePenalty ?? 1e6),
      treeSteps: Math.trunc(Number(input.treeSteps ?? 600)),
      cashPayoff: Number(input.cashPayoff ?? 10),
      barrier: Number(input.barrier ?? 125),
      barrierDirection: input.barrierDirection || "up",
      barrierStyle: input.barrierStyle || "out",
      lowerBarrier: Number(input.lowerBarrier ?? 70),
      upperBarrier: Number(input.upperBarrier ?? 130),
      exerciseDates: Math.trunc(Number(input.exerciseDates ?? 4)),
      spot2: Number(input.spot2 ?? 100),
      volatility2: Number(input.volatility2 ?? 0.25),
      dividendYield2: Number(input.dividendYield2 ?? 0.0),
      spot3: Number(input.spot3 ?? 100),
      volatility3: Number(input.volatility3 ?? 0.3),
      dividendYield3: Number(input.dividendYield3 ?? 0.0),
      correlation: Number(input.correlation ?? 0.5),
      rainbowStyle: input.rainbowStyle || "best",
      notional: Number(input.notional ?? 100),
      coupon: Number(input.coupon ?? 0.02),
      autocallBarrier: Number(input.autocallBarrier ?? 1.0),
      protectionBarrier: Number(input.protectionBarrier ?? 0.7),
      observations: Math.trunc(Number(input.observations ?? 3)),
      assetCount: Math.trunc(Number(input.assetCount ??
        (input.product === "rainbow" || input.product === "basket" ? 2 : 3))),
      // Assets beyond the primary, for rainbow/himalayan -- arbitrary length,
      // not capped at the old spot2/spot3-only 3-asset basket. Falls back to
      // spot2/spot3 (as a 2-entry array) when the caller hasn't supplied the
      // new arrays, so exotics.html's still-2/3-field basket UI keeps working.
      assetSpots: Array.isArray(input.assetSpots)
        ? input.assetSpots.map(Number) : [Number(input.spot2 ?? 100), Number(input.spot3 ?? 100)],
      assetVolatilities: Array.isArray(input.assetVolatilities)
        ? input.assetVolatilities.map(Number) : [Number(input.volatility2 ?? 0.25), Number(input.volatility3 ?? 0.3)],
      assetDividendYields: Array.isArray(input.assetDividendYields)
        ? input.assetDividendYields.map(Number) : [Number(input.dividendYield2 ?? 0.0), Number(input.dividendYield3 ?? 0.0)],
      returnStrike: Number(input.returnStrike ?? 0.0),
      ladderRungs: Array.isArray(input.ladderRungs)
        ? input.ladderRungs.map(Number)
        : String(input.ladderRungs ?? "110,120,130").split(",").map((value) => Number(value.trim())),
      decisionTime: Number(input.decisionTime ?? 0.5),
      compoundStrike: Number(input.compoundStrike ?? 5.0),
    };
    if (!(config.spot > 0 && config.strike > 0 && config.maturity > 0 && config.volatility > 0)) {
      throw new Error("Spot, strike, maturity, and volatility must be positive.");
    }
    if (config.paths < 100 || config.paths > 500000) throw new Error("Paths must be between 100 and 500,000.");
    if (config.product === "rainbow" || config.product === "himalayan"
      || config.product === "basket") {
      // Floor of 1, not 2: a one-asset basket is a legitimate degenerate
      // case (himalayan reduces to a single locked return, rainbow to the
      // vanilla) and the payoff-reduction test suite exercises it. The UI
      // keeps min=2 on its input; only the engine accepts 1.
      if (config.assetCount < 1 || config.assetCount > 20) {
        throw new Error("Basket asset count must be between 1 and 20.");
      }
      if (config.assetSpots.length < config.assetCount - 1
        || config.assetVolatilities.length < config.assetCount - 1
        || config.assetDividendYields.length < config.assetCount - 1) {
        throw new Error("Not enough basket asset entries were supplied for the selected asset count.");
      }
    }
    if (config.monitoringSteps < 1 || config.monitoringSteps > 16) {
      throw new Error("Monitoring steps must be between 1 and 16.");
    }
    if (config.exerciseDates < 1 || config.exerciseDates > 16) {
      throw new Error("Exercise dates must be between 1 and 16.");
    }
    if (config.pdeGrid < 20 || config.pdeGrid > 2000 || config.pdeTimeSteps < 10 || config.pdeTimeSteps > 10000) {
      throw new Error("PDE grid/time dimensions are outside the supported range.");
    }
    if (!["uniform", "sinh-strike", "sinh-spot"].includes(config.pdeGridType)) {
      throw new Error("PDE grid type must be uniform, sinh-strike, or sinh-spot.");
    }
    if (!(config.pdeGridConcentration >= 0.01 && config.pdeGridConcentration <= 1.0)) {
      throw new Error("PDE grid concentration must lie between 0.01 and 1.0.");
    }
    if (!["none", "cell-average"].includes(config.pdePayoffSmoothing)) {
      throw new Error("Unknown PDE payoff smoothing method.");
    }
    if (config.pdeRannacherSteps < 0 || config.pdeRannacherSteps > 8) {
      throw new Error("Rannacher damping intervals must lie between 0 and 8.");
    }
    if (!(config.pdeSorOmega > 0 && config.pdeSorOmega < 2) || !(config.pdeTolerance > 0) ||
      config.pdeMaxIterations < 1 || !(config.pdePenalty > 0)) {
      throw new Error("Invalid American PDE iteration controls.");
    }
    if (config.lowerBarrier >= config.upperBarrier) throw new Error("Lower barrier must be below upper barrier.");
    if (config.decisionTime <= 0 || config.decisionTime >= config.maturity) {
      throw new Error("Compound decision time must lie between zero and maturity.");
    }
    return config;
  }

  function price(input, method) {
    const config = normalizeConfig(input);
    if (!PRODUCT_METHODS[config.product]?.includes(method)) {
      throw new Error(`${method} is not available for ${config.product}.`);
    }
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    let result;
    if (method === "mc" || method === "qmc") result = monteCarloPrice(config, method);
    else if (method === "pde" || method.startsWith("pde-")) {
      const solver = method.startsWith("pde-") ? method.slice(4) : config.pdeAmericanSolver;
      const solved = pdeSolve(config, solver);
      result = {
        price: solved.price, standardError: null, standardDeviation: null,
        samples: config.pdeGrid * config.pdeTimeSteps,
        pdeDiagnostics: solved.diagnostics,
      };
    }
    else if (method === "tree") result = bermudanTree(config);
    // The new-method branches must sit BEFORE the product fallbacks below:
    // the tail of this chain dispatches on product, not method, so a late
    // insertion would silently return the unadjusted continuous price.
    else if (method === "closed-form-daily" || method === "closed-form-weekly" ||
      method === "closed-form-terminal") {
      const isDouble = config.product === "double-barrier";
      let value;
      let benchmarkKind;
      let benchmarkSteps;
      if (method === "closed-form-terminal") {
        value = isDouble
          ? doubleBarrierTerminalClosedForm(config)
          : barrierTerminalClosedForm(config);
        benchmarkKind = "terminal-qmc";
        benchmarkSteps = 1;
      } else {
        const frequency = method === "closed-form-daily" ? 252 : 52;
        const shifted = bgkShiftedConfig(config, frequency);
        value = isDouble ? doubleBarrierSpectral(shifted) : barrierClosedForm(shifted);
        benchmarkKind = "discrete-qmc";
        benchmarkSteps = Math.max(1, Math.round(frequency * config.maturity));
      }
      result = {
        price: value, standardError: null, standardDeviation: null, samples: 0,
        benchmark: attachBarrierBenchmark(config, value, benchmarkKind, benchmarkSteps),
      };
    }
    else if (config.product === "digital") result = {
      price: digitalClosedForm(config), standardError: null, standardDeviation: null, samples: 0,
    };
    else if (config.product === "barrier") {
      const value = barrierClosedForm(config);
      result = {
        price: value, standardError: null, standardDeviation: null, samples: 0,
        benchmark: attachBarrierBenchmark(config, value, "bridge-qmc"),
      };
    }
    else if (config.product === "double-barrier") {
      const value = doubleBarrierSpectral(config);
      result = {
        price: value, standardError: null, standardDeviation: null, samples: 96,
        benchmark: attachBarrierBenchmark(config, value, "bridge-qmc"),
      };
    }
    else if (config.product === "compound") result = {
      price: compoundClosedForm(config), standardError: null, standardDeviation: null, samples: 0,
    };
    else throw new Error("Unsupported method.");
    const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
    return { ...result, elapsedMs: ended - started, config, method };
  }

  function makePayoffUnitTest(product, name, inputs, expected, evaluate, rationale, tolerance = 1e-12) {
    try {
      const actual = evaluate();
      const absoluteError = Math.abs(actual - expected);
      return {
        product, name, inputs, expected, actual, absoluteError, tolerance,
        passed: Number.isFinite(actual) && absoluteError <= tolerance,
        rationale,
      };
    } catch (error) {
      return {
        product, name, inputs, expected, actual: null, absoluteError: null, tolerance,
        passed: false, rationale, error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function runPayoffUnitTests() {
    const rows = [];
    const add = (product, name, inputs, expected, evaluate, rationale, tolerance) => {
      rows.push(makePayoffUnitTest(
        product, name, inputs, expected, evaluate, rationale, tolerance,
      ));
    };

    add("vanilla", "Call finishes in the money", { spot: 115, strike: 100, type: "call" },
      15, () => vanillaPayoff(115, 100, "call"),
      "An in-the-money call is worth spot minus strike.");
    add("vanilla", "Put finishes in the money", { spot: 82, strike: 100, type: "put" },
      18, () => vanillaPayoff(82, 100, "put"),
      "An in-the-money put is worth strike minus spot.");
    add("vanilla", "Out-of-the-money option is floored", { spot: 95, strike: 100, type: "call" },
      0, () => vanillaPayoff(95, 100, "call"),
      "Option exercise value cannot be negative.");
    add("vanilla", "At-the-money call has zero exercise value", { spot: 100, strike: 100, type: "call" },
      0, () => vanillaPayoff(100, 100, "call"),
      "At the strike, immediate call exercise produces neither a gain nor a loss.");
    add("vanilla", "At-the-money put has zero exercise value", { spot: 100, strike: 100, type: "put" },
      0, () => vanillaPayoff(100, 100, "put"),
      "At the strike, immediate put exercise produces neither a gain nor a loss.");
    add("vanilla", "Deep in-the-money low-strike call", { spot: 140, strike: 60, type: "call" },
      80, () => vanillaPayoff(140, 60, "call"),
      "The call receives the full 80-point terminal intrinsic value.");
    add("vanilla", "Deep in-the-money high-strike put", { spot: 45, strike: 120, type: "put" },
      75, () => vanillaPayoff(45, 120, "put"),
      "The put receives the full 75-point terminal intrinsic value.");
    add("vanilla", "Pointwise call-put payoff parity", { terminal: 115, strike: 100 },
      15, () => vanillaPayoff(115, 100, "call") - vanillaPayoff(115, 100, "put"),
      "At every terminal price, call payoff minus put payoff equals S(T) minus K.");

    add("digital", "Cash call succeeds above strike",
      { terminal: 110, strike: 100, type: "call", cash: 10 },
      10, () => digitalPayoff(110, 100, "call", 10),
      "A cash-or-nothing call pays the full fixed amount above strike.");
    add("digital", "At-the-money call does not trigger",
      { terminal: 100, strike: 100, type: "call", cash: 10 },
      0, () => digitalPayoff(100, 100, "call", 10),
      "The contract uses a strict greater-than trigger at maturity.");
    add("digital", "Cash put succeeds below strike",
      { terminal: 90, strike: 100, type: "put", cash: 7 },
      7, () => digitalPayoff(90, 100, "put", 7),
      "A cash-or-nothing put pays the full fixed amount below strike.");
    add("digital", "At-the-money put does not trigger",
      { terminal: 100, strike: 100, type: "put", cash: 10 },
      0, () => digitalPayoff(100, 100, "put", 10),
      "The cash put also uses a strict inequality at the strike.");
    add("digital", "Out-of-the-money cash call is zero",
      { terminal: 75, strike: 120, type: "call", cash: 13 },
      0, () => digitalPayoff(75, 120, "call", 13),
      "A terminal level below a high strike does not trigger a digital call.");
    add("digital", "Out-of-the-money cash put is zero",
      { terminal: 140, strike: 80, type: "put", cash: 13 },
      0, () => digitalPayoff(140, 80, "put", 13),
      "A terminal level above a low strike does not trigger a digital put.");
    add("digital", "Complementary cash call and put", { terminal: 115, strike: 100, cash: 10 },
      10, () => digitalPayoff(115, 100, "call", 10) + digitalPayoff(115, 100, "put", 10),
      "Away from the strike, exactly one complementary cash-or-nothing option pays.");

    add("barrier", "Knock-out survives without a hit",
      { terminal: 120, strike: 100, type: "call", survival: 1, style: "out" },
      20, () => singleBarrierPayoff(120, 100, "call", 1, "out"),
      "Without a barrier hit, a knock-out retains the vanilla payoff.");
    add("barrier", "Knock-out vanishes after a hit",
      { terminal: 120, strike: 100, type: "call", survival: 0, style: "out" },
      0, () => singleBarrierPayoff(120, 100, "call", 0, "out"),
      "A barrier hit extinguishes a knock-out contract.");
    add("barrier", "Knock-in stays dormant without a hit",
      { terminal: 120, strike: 100, type: "call", survival: 1, style: "in" },
      0, () => singleBarrierPayoff(120, 100, "call", 1, "in"),
      "A knock-in has no payoff when the activation barrier is never hit.");
    add("barrier", "Bridge survival weight is complementary",
      { terminal: 120, strike: 100, type: "call", survival: 0.25, style: "in" },
      15, () => singleBarrierPayoff(120, 100, "call", 0.25, "in"),
      "A 25% survival probability gives a knock-in weight of 75%.");
    add("barrier", "Put knock-out survives without a hit",
      { terminal: 70, strike: 110, type: "put", survival: 1, style: "out" },
      40, () => singleBarrierPayoff(70, 110, "put", 1, "out"),
      "A surviving down-and-out or up-and-out put retains its 40-point intrinsic payoff.");
    add("barrier", "Put knock-out vanishes after a hit",
      { terminal: 70, strike: 110, type: "put", survival: 0, style: "out" },
      0, () => singleBarrierPayoff(70, 110, "put", 0, "out"),
      "A barrier hit removes the put payoff regardless of terminal moneyness.");
    add("barrier", "Call knock-in activates after a hit",
      { terminal: 135, strike: 90, type: "call", survival: 0, style: "in" },
      45, () => singleBarrierPayoff(135, 90, "call", 0, "in"),
      "A fully hit knock-in receives the complete low-strike call payoff.");
    add("barrier", "Fractional-survival put knock-in",
      { terminal: 70, strike: 110, type: "put", survival: 0.4, style: "in" },
      24, () => singleBarrierPayoff(70, 110, "put", 0.4, "in"),
      "A 60% knock-in weight applied to a 40-point put produces 24.");
    add("barrier", "Call knock-in/out payoff parity",
      { terminal: 135, strike: 90, type: "call", survival: 0.35 },
      45, () => singleBarrierPayoff(135, 90, "call", 0.35, "in") +
        singleBarrierPayoff(135, 90, "call", 0.35, "out"),
      "Complementary knock-in and knock-out weights reconstruct the vanilla call payoff.");
    add("barrier", "Put knock-in/out payoff parity",
      { terminal: 70, strike: 110, type: "put", survival: 0.65 },
      40, () => singleBarrierPayoff(70, 110, "put", 0.65, "in") +
        singleBarrierPayoff(70, 110, "put", 0.65, "out"),
      "Complementary knock-in and knock-out weights reconstruct the vanilla put payoff.");

    add("double-barrier", "Double knock-out survives inside the corridor",
      { terminal: 120, strike: 100, type: "call", survival: 1, style: "out" },
      20, () => doubleBarrierPayoff(120, 100, "call", 1, "out"),
      "Staying between both barriers preserves the vanilla payoff.");
    add("double-barrier", "Either boundary knocks out the claim",
      { terminal: 120, strike: 100, type: "call", survival: 0, style: "out" },
      0, () => doubleBarrierPayoff(120, 100, "call", 0, "out"),
      "Touching either boundary extinguishes a double knock-out.");
    add("double-barrier", "Double knock-in activates after a hit",
      { terminal: 80, strike: 100, type: "put", survival: 0, style: "in" },
      20, () => doubleBarrierPayoff(80, 100, "put", 0, "in"),
      "A hit activates the full vanilla put payoff for a double knock-in.");
    add("double-barrier", "Double knock-in is dormant inside the corridor",
      { terminal: 80, strike: 100, type: "put", survival: 1, style: "in" },
      0, () => doubleBarrierPayoff(80, 100, "put", 1, "in"),
      "No boundary hit means no activation for a double knock-in.");
    add("double-barrier", "Double knock-out put survives inside corridor",
      { terminal: 72, strike: 115, type: "put", survival: 1, style: "out" },
      43, () => doubleBarrierPayoff(72, 115, "put", 1, "out"),
      "With neither boundary hit, the high-strike put remains active.");
    add("double-barrier", "Double knock-out put vanishes on a boundary hit",
      { terminal: 72, strike: 115, type: "put", survival: 0, style: "out" },
      0, () => doubleBarrierPayoff(72, 115, "put", 0, "out"),
      "Either boundary hit extinguishes the otherwise in-the-money put.");
    add("double-barrier", "Double-barrier call in/out payoff parity",
      { terminal: 135, strike: 90, type: "call", survival: 0.2 },
      45, () => doubleBarrierPayoff(135, 90, "call", 0.2, "in") +
        doubleBarrierPayoff(135, 90, "call", 0.2, "out"),
      "Double knock-in and knock-out weights sum to the vanilla call payoff.");
    add("double-barrier", "Double-barrier put in/out payoff parity",
      { terminal: 65, strike: 115, type: "put", survival: 0.8 },
      50, () => doubleBarrierPayoff(65, 115, "put", 0.8, "in") +
        doubleBarrierPayoff(65, 115, "put", 0.8, "out"),
      "Double knock-in and knock-out weights sum to the vanilla put payoff.");

    add("bermudan", "Call exercise amount", { spot: 115, strike: 100, type: "call" },
      15, () => bermudanExercisePayoff(115, 100, "call"),
      "Exercise receives the call intrinsic value on an allowed date.");
    add("bermudan", "Put exercise amount", { spot: 85, strike: 100, type: "put" },
      15, () => bermudanExercisePayoff(85, 100, "put"),
      "Exercise receives the put intrinsic value on an allowed date.");
    add("bermudan", "Out-of-the-money exercise is worthless",
      { spot: 95, strike: 100, type: "call" },
      0, () => bermudanExercisePayoff(95, 100, "call"),
      "The holder would not exercise for a negative amount.");
    add("bermudan", "Low-strike call exercise", { spot: 150, strike: 70, type: "call" },
      80, () => bermudanExercisePayoff(150, 70, "call"),
      "On an exercise date, a deep in-the-money call receives spot less strike.");
    add("bermudan", "High-strike put exercise", { spot: 55, strike: 130, type: "put" },
      75, () => bermudanExercisePayoff(55, 130, "put"),
      "On an exercise date, a deep in-the-money put receives strike less spot.");

    add("rainbow", "Best-of call selects the higher asset",
      { asset1: 120, asset2: 90, strike: 100, type: "call", style: "best" },
      20, () => rainbowPayoff([120, 90], 100, "call", "best"),
      "The best-of call uses the 120 asset and pays 20.");
    add("rainbow", "Worst-of call selects the lower asset",
      { asset1: 120, asset2: 90, strike: 100, type: "call", style: "worst" },
      0, () => rainbowPayoff([120, 90], 100, "call", "worst"),
      "The lower asset is below strike, so the worst-of call expires worthless.");
    add("rainbow", "Best-of put selects the higher asset",
      { asset1: 120, asset2: 90, strike: 100, type: "put", style: "best" },
      0, () => rainbowPayoff([120, 90], 100, "put", "best"),
      "The higher asset is above strike, so the best-of put expires worthless.");
    add("rainbow", "Worst-of put selects the lower asset",
      { asset1: 120, asset2: 90, strike: 100, type: "put", style: "worst" },
      10, () => rainbowPayoff([120, 90], 100, "put", "worst"),
      "The worst-of put uses the 90 asset and pays 10.");

    const autocallConfig = {
      initialSpot: 100, notional: 100, coupon: 0.02,
      autocallBarrier: 1.0, protectionBarrier: 0.7, maturity: 1.0,
    };
    add("autocallable", "First observation triggers early redemption",
      { path: [105, 90, 80, 70], ...autocallConfig },
      102, () => autocallablePayoff([105, 90, 80, 70], autocallConfig).amount,
      "The first observation meets the call barrier and pays notional plus one coupon.");
    add("autocallable", "Protected maturity redemption accrues all coupons",
      { path: [95, 98, 99, 90], ...autocallConfig },
      108, () => autocallablePayoff([95, 98, 99, 90], autocallConfig).amount,
      "No call occurs, but the terminal level remains above protection and earns four coupons.");
    add("autocallable", "Protection breach links redemption to downside",
      { path: [95, 90, 80, 60], ...autocallConfig },
      60, () => autocallablePayoff([95, 90, 80, 60], autocallConfig).amount,
      "Below the protection barrier, redemption follows the 60% terminal performance.");

    add("himalayan", "Average selected return exceeds strike",
      { selectedReturns: [0.10, 0.05, -0.02], notional: 100, returnStrike: 0.02 },
      7 / 3, () => himalayanPayoff([0.10, 0.05, -0.02], 100, 0.02),
      "The 4.333% selected-return average exceeds the 2% strike by 2.333%.");
    add("himalayan", "Return floor prevents a negative payoff",
      { selectedReturns: [-0.05, 0.00], notional: 100, returnStrike: 0.01 },
      0, () => himalayanPayoff([-0.05, 0.00], 100, 0.01),
      "An average return below the strike cannot create a negative option payoff.");

    add("lookback", "Call uses the monitored maximum",
      { path: [90, 120, 105], strike: 100, type: "call" },
      20, () => lookbackPayoff([90, 120, 105], 100, "call"),
      "The path maximum is 120 even though the terminal value falls back to 105.");
    add("lookback", "Put uses the monitored minimum",
      { path: [110, 80, 95], strike: 100, type: "put" },
      20, () => lookbackPayoff([110, 80, 95], 100, "put"),
      "The path minimum is 80 even though the terminal value recovers to 95.");
    add("lookback", "One fixing reduces to vanilla",
      { path: [115], strike: 100, type: "call" },
      15, () => lookbackPayoff([115], 100, "call"),
      "With only the terminal fixing, the lookback payoff is the vanilla payoff.");

    add("ladder", "Crossed call rung locks a gain",
      { path: [105, 125, 103], strike: 100, type: "call", rungs: [110, 120, 130] },
      20, () => ladderPayoff([105, 125, 103], 100, "call", [110, 120, 130]),
      "Crossing 120 locks 20 even after the terminal price falls to 103.");
    add("ladder", "Unreached rung reduces to terminal vanilla",
      { path: [105, 108, 112], strike: 100, type: "call", rungs: [130] },
      12, () => ladderPayoff([105, 108, 112], 100, "call", [130]),
      "When no rung is crossed, the terminal call intrinsic value remains.");
    add("ladder", "Crossed put rung locks a gain",
      { path: [95, 78, 96], strike: 100, type: "put", rungs: [90, 80, 70] },
      20, () => ladderPayoff([95, 78, 96], 100, "put", [90, 80, 70]),
      "Falling through 80 locks 20 even after the terminal price recovers to 96.");

    add("compound", "Underlying option value exceeds compound strike",
      { underlyingOptionValue: 12, compoundStrike: 5 },
      7, () => compoundPayoff(12, 5),
      "Exercising the compound option buys a 12-valued call for 5.");
    add("compound", "Underlying option value is below compound strike",
      { underlyingOptionValue: 4, compoundStrike: 5 },
      0, () => compoundPayoff(4, 5),
      "The holder lets the compound option expire instead of paying more than the call is worth.");
    add("compound", "Put on call pays below the compound strike",
      { innerType: "call", outerType: "put", underlyingOptionValue: 4, compoundStrike: 5 },
      1, () => compoundPayoff(4, 5, "put"),
      "A put on a call pays when the call value is below the compound strike.");
    add("compound", "Put on put is floored above the compound strike",
      { innerType: "put", outerType: "put", underlyingOptionValue: 7, compoundStrike: 5 },
      0, () => compoundPayoff(7, 5, "put"),
      "A put on a put expires when the underlying put is worth more than the sale strike.");

    return rows;
  }

  function benchmark(
    name,
    reference,
    candidate,
    tolerance,
    reduction,
    category = "method-benchmarks",
    inputs = {},
  ) {
    const absoluteError = Math.abs(reference - candidate);
    return {
      name, reference, candidate, absoluteError, tolerance,
      passed: absoluteError <= tolerance,
      reduction,
      category,
      inputs,
    };
  }

  function runBenchmarks() {
    const rows = [];
    const base = normalizeConfig({ paths: 32768, monitoringSteps: 12, randomizedQmc: false });
    const vanillaCall = blackScholes(base);
    const vanillaPutConfig = { ...base, optionType: "put" };
    const vanillaPut = blackScholes(vanillaPutConfig);

    const digital = normalizeConfig({ ...base, product: "digital", cashPayoff: 10 });
    rows.push(benchmark(
      "Digital: closed form vs PDE",
      digitalClosedForm(digital), pdePrice(digital), 0.08,
      "Cash digital is the negative strike derivative of a vanilla call.",
    ));
    const spreadWidth = 0.05;
    const digitalUnit = digitalClosedForm({ ...digital, cashPayoff: 1.0 });
    const callSpread = (
      blackScholes({ ...base, strike: base.strike - spreadWidth }) -
      blackScholes({ ...base, strike: base.strike + spreadWidth })
    ) / (2.0 * spreadWidth);
    rows.push(benchmark(
      "Digital cash-or-nothing call-spread reduction",
      digitalUnit, callSpread, 2e-6,
      "A cash digital is the negative strike derivative of a vanilla call.",
    ));

    const barrier = normalizeConfig({
      ...base, product: "barrier", barrier: 130, barrierDirection: "up", barrierStyle: "out",
    });
    rows.push(benchmark(
      "Up-and-out: closed form vs bridge QMC",
      barrierClosedForm(barrier), monteCarloPrice(barrier, "qmc").price, 0.12,
      "Knock-in + knock-out equals the vanilla option.",
    ));
    const barrierIn = { ...barrier, barrierStyle: "in" };
    rows.push(benchmark(
      "Single barrier in/out parity",
      vanillaCall, barrierClosedForm(barrier) + barrierClosedForm(barrierIn), 1e-10,
      "C_in + C_out = C_vanilla.",
    ));

    const doubleOut = normalizeConfig({
      ...base, product: "double-barrier", lowerBarrier: 70, upperBarrier: 140,
      barrierStyle: "out",
    });
    const doubleIn = { ...doubleOut, barrierStyle: "in" };
    rows.push(benchmark(
      "Double barrier in/out parity",
      vanillaCall, doubleBarrierSpectral(doubleOut) + doubleBarrierSpectral(doubleIn), 1e-9,
      "Double knock-in + double knock-out equals vanilla.",
    ));
    rows.push(benchmark(
      "Double knock-out: spectral vs bridge QMC",
      doubleBarrierSpectral(doubleOut), monteCarloPrice(doubleOut, "qmc").price, 0.16,
      "Independent semi-closed and path-simulation implementations.",
    ));

    const bermudan = normalizeConfig({
      ...vanillaPutConfig, product: "bermudan", exerciseDates: 1, treeSteps: 600,
    });
    rows.push(benchmark(
      "Bermudan one-date reduction",
      vanillaPut, bermudanTree(bermudan).price, 0.015,
      "With maturity as its only exercise date, a Bermudan is European.",
    ));
    const bermudanFour = normalizeConfig({
      ...vanillaPutConfig, product: "bermudan", exerciseDates: 4,
      treeSteps: 600, paths: 32768,
    });
    rows.push(benchmark(
      "Bermudan: CRR tree vs Sobol LSM",
      bermudanTree(bermudanFour).price, monteCarloPrice(bermudanFour, "qmc").price, 0.16,
      "Independent lattice and Longstaff-Schwartz continuation estimates.",
    ));

    const lookback = normalizeConfig({
      ...base, product: "lookback", monitoringSteps: 1,
    });
    rows.push(benchmark(
      "Lookback one-fixing reduction",
      vanillaCall, monteCarloPrice(lookback, "qmc").price, 0.035,
      "A fixed-strike lookback monitored only at maturity is vanilla.",
    ));

    const ladder = normalizeConfig({
      ...base, product: "ladder", ladderRungs: [1e9], monitoringSteps: 8,
    });
    rows.push(benchmark(
      "Ladder unreachable-rung reduction",
      vanillaCall, monteCarloPrice(ladder, "qmc").price, 0.04,
      "With no reachable rung, the ladder payoff is vanilla.",
    ));

    // The second asset must be identical to the first. `base` is already a
    // normalized config, so it carries assetSpots/assetVolatilities/
    // assetDividendYields arrays that would SHADOW any spot2/volatility2
    // scalar overrides (normalizeConfig prefers the array form) -- pass the
    // arrays explicitly so the reduction actually holds, and pin assetCount
    // to 2 (base's default of 3 would add a third, differently-vol asset).
    const rainbow = normalizeConfig({
      ...base, product: "rainbow", assetCount: 2,
      assetSpots: [base.spot], assetVolatilities: [base.volatility],
      assetDividendYields: [base.dividendYield], correlation: 1.0, rainbowStyle: "best",
    });
    rows.push(benchmark(
      "Rainbow identical-assets reduction",
      vanillaCall, monteCarloPrice(rainbow, "qmc").price, 0.035,
      "Best-of two identical perfectly correlated assets is a vanilla option.",
    ));

    const compound = normalizeConfig({
      ...base, product: "compound", compoundStrike: 0.0, decisionTime: 0.5,
    });
    rows.push(benchmark(
      "Compound zero-strike reduction",
      vanillaCall, compoundClosedForm(compound), 1e-12,
      "A call on a call with zero compound strike is the underlying call.",
    ));

    const himalayan = normalizeConfig({
      ...base, product: "himalayan", assetCount: 1, observations: 1,
      returnStrike: 0.0, notional: 100,
    });
    const scaledVanilla = 100 / base.spot * blackScholes({ ...base, strike: base.spot });
    rows.push(benchmark(
      "Himalayan one-asset/one-fixing reduction",
      scaledVanilla, monteCarloPrice(himalayan, "qmc").price, 0.035,
      "One asset and one fixing reduces to a scaled vanilla call.",
    ));

    const autocall = normalizeConfig({
      ...base, product: "autocallable", autocallBarrier: 1e9,
      protectionBarrier: 0.0, coupon: 0.0, notional: 100, monitoringSteps: 4,
    });
    rows.push(benchmark(
      "Autocall no-call/full-protection reduction",
      100 * Math.exp(-base.rate * base.maturity),
      monteCarloPrice(autocall, "qmc").price, 1e-10,
      "With no call, no coupon, and full protection, it is a zero-coupon note.",
    ));

    const compoundRegular = normalizeConfig({
      ...base, product: "compound", compoundStrike: 5, decisionTime: 0.5,
    });
    rows.push(benchmark(
      "Compound: Geske vs Sobol QMC",
      compoundClosedForm(compoundRegular), monteCarloPrice(compoundRegular, "qmc").price, 0.035,
      "Independent method benchmark for the semi-analytic bivariate formula.",
    ));

    const americanPut = normalizeConfig({
      ...vanillaPutConfig,
      product: "american",
      pdeGrid: 160,
      pdeTimeSteps: 240,
      pdeGridType: "sinh-strike",
      pdePayoffSmoothing: "cell-average",
      pdeRannacherSteps: 2,
    });
    const americanTreeConfig = normalizeConfig({
      ...americanPut, product: "bermudan", exerciseDates: 16, treeSteps: 1200,
    });
    const americanTreePrice = bermudanTree({
      ...americanTreeConfig, exerciseDates: americanTreeConfig.treeSteps,
    }).price;
    for (const [solver, label] of [
      ["projection", "projected Crank-Nicolson"],
      ["psor", "PSOR complementarity"],
      ["penalty", "penalty complementarity"],
    ]) {
      rows.push(benchmark(
        `American put: ${label} PDE vs CRR`,
        americanTreePrice,
        pdePrice(americanPut, solver),
        0.025,
        "A continuously exercisable finite-difference solution is compared with a 1,200-step American CRR lattice.",
        "method-benchmarks",
        { optionType: "put", solver, gridType: "sinh-strike", smoothing: "cell-average" },
      ));
    }
    const americanCall = { ...americanPut, optionType: "call", dividendYield: 0.0 };
    for (const [solver, label] of [
      ["projection", "projected Crank-Nicolson"],
      ["psor", "PSOR complementarity"],
      ["penalty", "penalty complementarity"],
    ]) {
      rows.push(benchmark(
        `American no-dividend call: ${label} PDE reduction`,
        blackScholes(americanCall),
        pdePrice(americanCall, solver),
        0.02,
        "With no dividends and a non-negative rate, early exercise has no value and the American call reduces to European Black-Scholes.",
        "method-benchmarks",
        { optionType: "call", solver, dividendYield: 0, gridType: "sinh-strike" },
      ));
    }

    const europeanCases = [
      { spot: 100, strike: 80, rate: 0.05, dividendYield: 0.02, volatility: 0.15, maturity: 0.25 },
      { spot: 100, strike: 100, rate: 0.03, dividendYield: 0.01, volatility: 0.20, maturity: 1.0 },
      { spot: 100, strike: 120, rate: 0.07, dividendYield: 0.00, volatility: 0.35, maturity: 3.0 },
      { spot: 75, strike: 100, rate: 0.01, dividendYield: 0.04, volatility: 0.50, maturity: 2.0 },
    ];
    europeanCases.forEach((raw) => {
      const call = normalizeConfig({
        ...base,
        ...raw,
        decisionTime: raw.maturity * 0.5,
        optionType: "call",
      });
      const put = { ...call, optionType: "put" };
      const parityRight = call.spot * Math.exp(-call.dividendYield * call.maturity)
        - call.strike * Math.exp(-call.rate * call.maturity);
      const label = `K=${call.strike}, T=${call.maturity}y`;
      rows.push(benchmark(
        `European call-put parity · ${label}`,
        parityRight,
        blackScholes(call) - blackScholes(put),
        2e-11,
        "C - P = S exp(-qT) - K exp(-rT).",
        "pricing-identities",
        raw,
      ));

      const dualPut = normalizeConfig({
        ...call,
        spot: call.strike,
        strike: call.spot,
        rate: call.dividendYield,
        dividendYield: call.rate,
        optionType: "put",
      });
      rows.push(benchmark(
        `European call-put duality · ${label}`,
        blackScholes(call),
        blackScholes(dualPut),
        2e-11,
        "C(S,K,r,q) = P(K,S,q,r) under Black-Scholes symmetry.",
        "pricing-duality",
        raw,
      ));
    });

    [
      { spot: 100, strike: 80, rate: 0.05, dividendYield: 0.02, volatility: 0.15, maturity: 0.25 },
      { spot: 100, strike: 100, rate: 0.03, dividendYield: 0.01, volatility: 0.20, maturity: 1.0 },
      { spot: 100, strike: 120, rate: 0.07, dividendYield: 0.00, volatility: 0.35, maturity: 3.0 },
    ].forEach((raw) => {
      ["call", "put"].forEach((optionType) => {
        const config = normalizeConfig({
          ...base,
          ...raw,
          decisionTime: raw.maturity * 0.5,
          product: "bermudan",
          exerciseDates: 1,
          optionType,
        });
        rows.push(benchmark(
          `European ${optionType}: closed form vs PDE · K=${config.strike}, T=${config.maturity}y`,
          blackScholes(config),
          pdePrice(config),
          0.08,
          "Independent Black-Scholes formula and finite-difference PDE implementations.",
          "method-benchmarks",
          { ...raw, optionType },
        ));
      });
    });

    const singleBarrierCases = [
      { optionType: "call", spot: 100, strike: 85, barrier: 125, barrierDirection: "up", rate: 0.05, dividendYield: 0.02, volatility: 0.18, maturity: 0.25 },
      { optionType: "put", spot: 100, strike: 115, barrier: 75, barrierDirection: "down", rate: 0.05, dividendYield: 0.02, volatility: 0.18, maturity: 0.25 },
      { optionType: "call", spot: 100, strike: 100, barrier: 140, barrierDirection: "up", rate: 0.03, dividendYield: 0.01, volatility: 0.25, maturity: 1.0 },
      { optionType: "put", spot: 100, strike: 100, barrier: 65, barrierDirection: "down", rate: 0.03, dividendYield: 0.01, volatility: 0.25, maturity: 1.0 },
      { optionType: "call", spot: 80, strike: 100, barrier: 150, barrierDirection: "up", rate: 0.06, dividendYield: 0.00, volatility: 0.40, maturity: 2.0 },
      { optionType: "put", spot: 125, strike: 100, barrier: 55, barrierDirection: "down", rate: 0.01, dividendYield: 0.04, volatility: 0.30, maturity: 3.0 },
    ];
    singleBarrierCases.forEach((raw) => {
      const out = normalizeConfig({
        ...base,
        ...raw,
        decisionTime: raw.maturity * 0.5,
        product: "barrier",
        barrierStyle: "out",
      });
      const knockIn = { ...out, barrierStyle: "in" };
      const vanilla = blackScholes({ ...out, product: "vanilla" });
      const label = `${out.barrierDirection}-${out.barrierStyle} ${out.optionType}, K=${out.strike}, H=${out.barrier}, T=${out.maturity}y`;
      rows.push(benchmark(
        `Single barrier in/out parity · ${label}`,
        vanilla,
        barrierClosedForm(out) + barrierClosedForm(knockIn),
        2e-10,
        "Knock-in plus knock-out reproduces the matching vanilla option.",
        "pricing-identities",
        raw,
      ));
      rows.push(benchmark(
        `Single barrier formula vs bridge QMC · ${label}`,
        barrierClosedForm(out),
        monteCarloPrice({ ...out, paths: 32768, monitoringSteps: 24 }, "qmc").price,
        0.16,
        "Continuous-monitoring closed form is compared with Brownian-bridge Sobol QMC.",
        "method-benchmarks",
        raw,
      ));
    });

    const doubleBarrierCases = [
      { optionType: "call", spot: 100, strike: 90, lowerBarrier: 60, upperBarrier: 160, rate: 0.05, dividendYield: 0.02, volatility: 0.18, maturity: 0.25 },
      { optionType: "put", spot: 100, strike: 110, lowerBarrier: 70, upperBarrier: 140, rate: 0.03, dividendYield: 0.01, volatility: 0.22, maturity: 1.0 },
      { optionType: "call", spot: 100, strike: 100, lowerBarrier: 75, upperBarrier: 135, rate: 0.04, dividendYield: 0.00, volatility: 0.25, maturity: 2.0 },
      { optionType: "put", spot: 125, strike: 100, lowerBarrier: 55, upperBarrier: 190, rate: 0.01, dividendYield: 0.04, volatility: 0.30, maturity: 3.0 },
    ];
    doubleBarrierCases.forEach((raw) => {
      const out = normalizeConfig({
        ...base,
        ...raw,
        decisionTime: raw.maturity * 0.5,
        product: "double-barrier",
        barrierStyle: "out",
      });
      const knockIn = { ...out, barrierStyle: "in" };
      const vanilla = blackScholes({ ...out, product: "vanilla" });
      const label = `${out.optionType}, K=${out.strike}, L=${out.lowerBarrier}, U=${out.upperBarrier}, T=${out.maturity}y`;
      rows.push(benchmark(
        `Double barrier in/out parity · ${label}`,
        vanilla,
        doubleBarrierSpectral(out) + doubleBarrierSpectral(knockIn),
        2e-9,
        "Double knock-in plus double knock-out reproduces the matching vanilla option.",
        "pricing-identities",
        raw,
      ));
      rows.push(benchmark(
        `Double barrier spectral vs bridge QMC · ${label}`,
        doubleBarrierSpectral(out),
        monteCarloPrice({ ...out, paths: 32768, monitoringSteps: 24 }, "qmc").price,
        0.18,
        "Independent spectral-series and Brownian-bridge Sobol QMC implementations.",
        "method-benchmarks",
        raw,
      ));
    });
    return rows;
  }

  return {
    PRODUCT_METHODS,
    PRODUCT_DESCRIPTIONS,
    PAYOFF_DEFINITIONS,
    normalizeConfig,
    price,
    runBenchmarks,
    runPayoffUnitTests,
    blackScholes,
    vanillaPayoff,
    digitalPayoff,
    singleBarrierPayoff,
    doubleBarrierPayoff,
    bermudanExercisePayoff,
    rainbowPayoff,
    autocallablePayoff,
    himalayanPayoff,
    lookbackPayoff,
    ladderPayoff,
    compoundPayoff,
    digitalClosedForm,
    barrierClosedForm,
    doubleBarrierSpectral,
    bgkShiftedConfig,
    truncatedVanilla,
    barrierTerminalClosedForm,
    doubleBarrierTerminalClosedForm,
    discreteBarrierQmc,
    compoundClosedForm,
    pdePrice,
    pdeSolve,
    buildSpatialGrid,
    interpolateOnGrid,
    finiteDifferenceCoefficients,
    averageTerminalPayoff,
    monteCarloPrice,
    bermudanTree,
    normalCdf,
    inverseNormalCdf,
    sobolUniform,
    bivariateNormalCdf,
  };
}));
