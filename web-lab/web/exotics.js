"use strict";

const form = document.querySelector("#exotic-form");
const languageSelect = document.querySelector("#language");
const productSelect = document.querySelector("#product");
const volatilitySelect = document.querySelector("#volatilityModel");
const methodSelect = document.querySelector("#method");
const productFields = document.querySelector("#product-fields");
const volatilityFields = document.querySelector("#volatility-fields");
const basketFields = document.querySelector("#basket-fields");
const underlyingSelect = document.querySelector("#underlyingMode");
const productNote = document.querySelector("#product-note");
const languageNote = document.querySelector("#language-note");
const volatilityNote = document.querySelector("#volatility-note");
const methodNote = document.querySelector("#method-note");
const optionTypeField = document.querySelector("#option-type-field");
const engineStatus = document.querySelector("#engine-status");
const priceButton = document.querySelector("#price-button");
const benchmarkButton = document.querySelector("#benchmark-button");
const volRegressionButton = document.querySelector("#vol-regression-button");
const formError = document.querySelector("#form-error");
const resultPanel = document.querySelector("#result-panel");
const benchmarkPanel = document.querySelector("#benchmark-panel");
const benchmarkBody = document.querySelector("#benchmark-body");

const productLabels = {
  american: "American vanilla · PDE",
  digital: "Digital / binary", barrier: "Single barrier", "double-barrier": "Double barrier",
  bermudan: "Bermudan", rainbow: "Rainbow / order statistic", autocallable: "Autocallable",
  "phoenix-autocall": "Phoenix autocall", "yield-seeker": "Yield seeker", himalayan: "Himalayan",
  asian: "Discrete arithmetic Asian", lookback: "Lookback", ladder: "Ladder",
  compound: "Compound option", "variance-swap": "Variance swap", "volatility-swap": "Volatility swap",
  "variance-option": "Option on variance", "volatility-option": "Option on volatility",
  accumulator: "Accumulator",
};

const fallbackDescriptions = {
  american: "Continuously exercisable vanilla solved as a Black-Scholes PDE complementarity problem.",
  digital: "Cash-or-nothing binary payoff on the selected effective underlying.",
  barrier: "Single knock-in or knock-out option with discrete path monitoring.",
  "double-barrier": "Double knock-in or knock-out option with discrete path monitoring.",
  bermudan: "Early exercise is permitted only on the supplied observation schedule.",
  rainbow: "Best- or worst-performing asset payoff.",
  autocallable: "Coupon note callable on scheduled observations with protected or downside-linked redemption.",
  "phoenix-autocall": "Conditional coupons, optional memory, scheduled autocall, and barrier-linked redemption.",
  "yield-seeker": "Conditional high-coupon barrier note without autocall; maturity principal is downside linked below protection.",
  himalayan: "Sequentially locks asset performances and averages the locked returns.",
  asian: "Discrete fixed-strike arithmetic average using an explicit, possibly uneven observation schedule.",
  lookback: "Fixed-strike payoff on the monitored maximum or minimum.",
  ladder: "Locks the highest monitored rung before applying the terminal strike payoff.",
  compound: "Call or put on an underlying call or put; all four type combinations are supported.",
  "variance-swap": "Notional times annualized realized variance less the variance strike.",
  "volatility-swap": "Notional times realized volatility less the volatility strike.",
  "variance-option": "Call or put on annualized realized variance.",
  "volatility-option": "Call or put on annualized realized volatility.",
  accumulator: "Scheduled purchases at the strike, downside gearing, and an upper knock-out.",
};

const languageDefinitions = {
  js: { label: "JavaScript", detail: "JavaScript reference", url: "exotic-worker.js?v=6", type: "classic", timeout: 10000,
    note: "Reference engine: product formulas, tree/PDE methods, PCG Monte Carlo, and Sobol QMC." },
  cpp: { label: "C++", detail: "C++ / WebAssembly", url: "advanced-cpp-worker.js?v=2", type: "classic", timeout: 10000,
    note: "Native C++ path engine: every listed payoff and volatility model through seeded Monte Carlo." },
  rust: { label: "Rust", detail: "Rust / WebAssembly", url: "advanced-rust-worker.js?v=2", type: "classic", timeout: 10000,
    note: "Native Rust path engine: every listed payoff and volatility model through seeded Monte Carlo." },
  python: { label: "Python", detail: "Python / Pyodide", url: "advanced-python-worker.mjs?v=2", type: "module", timeout: 45000,
    note: "Python runs inside Pyodide. Its first load is larger; later runs reuse the loaded worker." },
  csharp: { label: "C#", detail: "C# / .NET WebAssembly", url: "advanced-csharp-worker.mjs?v=2", type: "module", timeout: 45000,
    note: "C# runs in the browser's .NET WebAssembly runtime. Its first load is larger than C++ or Rust." },
};

const volatilityLabels = {
  constant: "Constant volatility", term: "Linear term volatility", local: "Term + local volatility",
  heston: "Heston stochastic volatility", slv: "Stochastic local volatility",
};

const volatilityNotes = {
  constant: "A single Black–Scholes volatility is used at every time and state.",
  term: "Instantaneous volatility interpolates linearly from the initial value to the maturity value.",
  local: "The term volatility is multiplied by (S/S₀)^β, bounded for numerical stability.",
  heston: "Full-truncation Euler variance with common κ, long-run volatility, vol-of-vol, and spot/variance correlation.",
  slv: "Heston instantaneous volatility multiplied by the local leverage. Setting β=0 reduces to Heston.",
};

const methodLabels = {
  "pde-projection": "American PDE · projected CN",
  "pde-psor": "American PDE · PSOR LCP",
  "pde-penalty": "American PDE · penalty",
  "closed-form": "Closed / semi-closed form", "semi-closed": "Semi-closed spectral series",
  tree: "CRR exercise tree", pde: "Crank–Nicolson PDE", mc: "Monte Carlo · PCG32", qmc: "Sobol QMC",
  levy: "Levy two-moment lognormal", "shifted-lognormal": "Shifted lognormal moment match",
  curran: "Curran geometric conditioning", "curran-two-moment": "Curran conditional two-moment",
  "ju-taylor": "Ju (2002) Taylor expansion through volatility order 6", adi: "Discrete-fixing PDE / ADI split",
  "static-replication": "Static OTM option replication",
};

const methodNotes = {
  "pde-projection": "Crank–Nicolson continuation solve followed by projection to the American exercise obstacle.",
  "pde-psor": "Projected SOR solves the American linear-complementarity problem at every time step.",
  "pde-penalty": "A semi-smooth active-set penalty iteration enforces the American exercise obstacle.",
  "closed-form": "Analytic or semi-analytic constant-volatility formula.",
  "semi-closed": "Absorbing-boundary spectral series with numerical payoff integration.",
  tree: "Recombining lattice; Bermudan exercise occurs only on configured dates.",
  pde: "One-factor Black–Scholes finite-difference PDE.",
  mc: "Path simulation with a reported payoff standard deviation and estimator standard error.",
  qmc: "Sobol low-discrepancy paths; optionally randomized with a digital shift.",
  levy: "Matches the first two moments of the uneven discrete arithmetic average.",
  "shifted-lognormal": "Uses the first three moments to fit a shifted lognormal average.",
  curran: "Conditions the arithmetic average on its geometric average.",
  "curran-two-moment": "Adds a conditional two-moment fit to Curran conditioning.",
  "ju-taylor": "Published Ju lognormal characteristic-function correction through volatility order 6; supports uneven Asian fixings and positive-weight price/return baskets up to 320 stochastic components.",
  adi: "Two-state spot/running-sum PDE with fixing-date jump operators and Crank–Nicolson spot steps.",
  "static-replication": "Numerically integrates out-of-the-money Black–Scholes options across strike.",
};

const referenceMethods = {
  american: ["pde-projection", "pde-psor", "pde-penalty"],
  digital: ["closed-form", "mc", "qmc"], barrier: ["closed-form", "pde", "mc", "qmc"],
  "double-barrier": ["semi-closed", "pde", "mc", "qmc"], bermudan: ["tree", "pde", "mc", "qmc"],
  rainbow: ["closed-form", "mc", "qmc"], autocallable: ["mc", "qmc"], himalayan: ["mc", "qmc"],
  lookback: ["closed-form", "mc", "qmc"], ladder: ["mc", "qmc"],
  compound: ["closed-form", "mc", "qmc"],
  asian: ["levy", "shifted-lognormal", "curran", "curran-two-moment", "ju-taylor", "adi", "mc", "qmc"],
  "phoenix-autocall": ["mc", "qmc"], "yield-seeker": ["mc", "qmc"],
  "variance-swap": ["static-replication", "mc", "qmc"], "volatility-swap": ["mc", "qmc"],
  "variance-option": ["mc", "qmc"], "volatility-option": ["mc", "qmc"], accumulator: ["mc", "qmc"],
};

const percent = (name, label, value, extra = {}) => ({ name, label, value, suffix: "%", transform: "percent", min: 0, step: "any", ...extra });
const select = (name, label, options, value) => ({ name, label, type: "select", options, value });
const scheduleFields = (count = 12, countLabel = "Equal observation dates") => [
  { name: "monitoringSteps", label: countLabel, value: count, min: 1, max: 260, step: 1 },
  select("scheduleMode", "Observation schedule", [["equal", "Equally spaced"], ["business-monthly", "Monthly business day"], ["custom", "Custom business dates"]], "equal"),
  { name: "valuationDate", label: "Valuation date", type: "date", value: "2026-08-03" },
  { name: "observationDates", label: "Custom dates · comma separated", type: "text", value: "2026-09-01, 2026-10-15, 2027-01-04, 2027-08-02" },
];

const fieldsByProduct = {
  american: [],
  digital: [{ name: "cashPayoff", label: "Cash payoff", value: 10, min: 0, step: "any" }],
  barrier: [
    { name: "barrier", label: "Barrier level", value: 125, min: 0.0001, step: "any" },
    select("barrierDirection", "Barrier direction", [["up", "Up"], ["down", "Down"]]),
    select("barrierStyle", "Barrier style", [["out", "Knock-out"], ["in", "Knock-in"]]), ...scheduleFields(),
  ],
  "double-barrier": [
    { name: "lowerBarrier", label: "Lower barrier", value: 70, min: 0.0001, step: "any" },
    { name: "upperBarrier", label: "Upper barrier", value: 130, min: 0.0001, step: "any" },
    select("barrierStyle", "Barrier style", [["out", "Knock-out"], ["in", "Knock-in"]]), ...scheduleFields(),
  ],
  bermudan: [
    { name: "exerciseDates", label: "Equal exercise dates", value: 4, min: 1, max: 260, step: 1 },
    { name: "treeSteps", label: "Tree steps", value: 600, min: 50, max: 2000, step: 1 },
    select("scheduleMode", "Exercise schedule", [["equal", "Equally spaced"], ["business-monthly", "Monthly business day"], ["custom", "Custom business dates"]], "equal"),
    { name: "valuationDate", label: "Valuation date", type: "date", value: "2026-08-03" },
    { name: "observationDates", label: "Custom dates · comma separated", type: "text", value: "2026-11-02, 2027-02-03, 2027-05-03, 2027-08-02" },
  ],
  rainbow: [
    select("rainbowStyle", "Order statistic", [["best", "Best performer"], ["worst", "Worst performer"]]),
    select("assetCount", "Asset count", [["2", "Two"], ["3", "Three"]], "2"),
  ],
  autocallable: [
    { name: "notional", label: "Notional", value: 100, min: 0.01, step: "any" }, percent("coupon", "Coupon per observation", 2),
    { name: "autocallBarrier", label: "Autocall barrier / initial", value: 1, min: 0, step: 0.01 },
    { name: "protectionBarrier", label: "Protection barrier / initial", value: 0.7, min: 0, step: 0.01 }, ...scheduleFields(4),
  ],
  "phoenix-autocall": [
    { name: "notional", label: "Notional", value: 100, min: 0.01, step: "any" }, percent("coupon", "Coupon per observation", 2),
    { name: "couponBarrier", label: "Coupon barrier / initial", value: 0.7, min: 0, step: 0.01 },
    { name: "autocallBarrier", label: "Autocall barrier / initial", value: 1, min: 0, step: 0.01 },
    { name: "protectionBarrier", label: "Protection barrier / initial", value: 0.7, min: 0, step: 0.01 },
    { name: "memoryCoupon", label: "Memory coupon", type: "checkbox", checked: true }, ...scheduleFields(4),
  ],
  "yield-seeker": [
    { name: "notional", label: "Notional", value: 100, min: 0.01, step: "any" }, percent("coupon", "Coupon per observation", 2),
    { name: "couponBarrier", label: "Coupon barrier / initial", value: 0.7, min: 0, step: 0.01 },
    { name: "protectionBarrier", label: "Protection barrier / initial", value: 0.7, min: 0, step: 0.01 },
    { name: "memoryCoupon", label: "Memory coupon", type: "checkbox", checked: true }, ...scheduleFields(4),
  ],
  himalayan: [
    select("assetCount", "Asset count", [["1", "One"], ["2", "Two"], ["3", "Three"]], "3"),
    { name: "observations", label: "Lock-in observations", value: 3, min: 1, max: 3, step: 1 },
    { name: "notional", label: "Notional", value: 100, min: 0.01, step: "any" }, percent("returnStrike", "Return strike", 0), ...scheduleFields(3),
  ],
  asian: [{ name: "includeInitialFixing", label: "Include initial spot fixing", type: "checkbox", checked: false }, ...scheduleFields(12, "Equal fixing dates")],
  lookback: [...scheduleFields(24)],
  ladder: [{ name: "ladderRungs", label: "Ladder rungs · comma separated", type: "text", value: "110,120,130" }, ...scheduleFields(24)],
  compound: [
    select("compoundOuterType", "Compound option type", [["call", "Call on inner"], ["put", "Put on inner"]]),
    select("compoundInnerType", "Underlying option type", [["call", "Call"], ["put", "Put"]]),
    { name: "decisionTime", label: "Compound decision time", value: 0.5, min: 0.001, step: "any", suffix: "years" },
    { name: "compoundStrike", label: "Compound strike", value: 5, min: 0, step: "any" },
  ],
  "variance-swap": [percent("varianceStrike", "Variance strike · variance × 100", 4),
    { name: "varianceNotional", label: "Variance notional", value: 1000, min: 0, step: "any" },
    { name: "annualization", label: "Annualization factor", value: 1, min: 0.001, step: "any" }, ...scheduleFields(252, "Return observations")],
  "volatility-swap": [percent("volatilityStrike", "Volatility strike", 20),
    { name: "varianceNotional", label: "Volatility notional", value: 1000, min: 0, step: "any" },
    { name: "annualization", label: "Annualization factor", value: 1, min: 0.001, step: "any" }, ...scheduleFields(252, "Return observations")],
  "variance-option": [percent("varianceStrike", "Variance strike · variance × 100", 4),
    { name: "varianceNotional", label: "Option notional", value: 1000, min: 0, step: "any" },
    { name: "annualization", label: "Annualization factor", value: 1, min: 0.001, step: "any" }, ...scheduleFields(252, "Return observations")],
  "volatility-option": [percent("volatilityStrike", "Volatility strike", 20),
    { name: "varianceNotional", label: "Option notional", value: 1000, min: 0, step: "any" },
    { name: "annualization", label: "Annualization factor", value: 1, min: 0.001, step: "any" }, ...scheduleFields(252, "Return observations")],
  accumulator: [
    { name: "accumulatorQuantity", label: "Base quantity per fixing", value: 1, min: 0, step: "any" },
    { name: "accumulatorGearing", label: "Downside gearing", value: 2, min: 0, step: "any" },
    { name: "accumulatorKnockOut", label: "Knock-out / initial", value: 1.1, min: 0, step: 0.01 }, ...scheduleFields(12),
  ],
};

const volatilityFieldDefinitions = {
  constant: [],
  term: [percent("termVolatility", "Volatility at maturity", 24, { min: 0.01 })],
  local: [percent("termVolatility", "Volatility at maturity", 24, { min: 0.01 }),
    { name: "localBeta", label: "Local leverage exponent β", value: -0.25, step: 0.01 }],
  heston: [
    { name: "hestonKappa", label: "Mean reversion κ", value: 2, min: 0, step: 0.01 },
    percent("hestonLongRunVol", "Long-run volatility", 20, { min: 0.01 }),
    percent("hestonVolOfVol", "Volatility of variance", 40),
    { name: "hestonRho", label: "Spot / variance correlation", value: -0.6, min: -1, max: 1, step: 0.01 },
  ],
  slv: [
    percent("termVolatility", "Local term volatility at maturity", 24, { min: 0.01 }),
    { name: "localBeta", label: "Local leverage exponent β", value: -0.25, step: 0.01 },
    { name: "hestonKappa", label: "Mean reversion κ", value: 2, min: 0, step: 0.01 },
    percent("hestonLongRunVol", "Long-run volatility", 20, { min: 0.01 }),
    percent("hestonVolOfVol", "Volatility of variance", 40),
    { name: "hestonRho", label: "Spot / variance correlation", value: -0.6, min: -1, max: 1, step: 0.01 },
  ],
};

const basketFieldDefinitions = [
  select("basketAssetCount", "Basket asset count", [["2", "Two"], ["3", "Three"]], "3"),
  { name: "basketWeights", label: "Weights · comma separated", type: "text", value: "0.5,0.3,0.2" },
  select("basketOrder", "Performance order statistic", [["1", "1 · best"], ["2", "2 · middle / worst of two"], ["3", "3 · worst of three"]], "1"),
  { name: "spot2", label: "Asset 2 spot", value: 100, min: 0.0001, step: "any" },
  percent("volatility2", "Asset 2 initial volatility", 25, { min: 0.01 }), percent("dividendYield2", "Asset 2 dividend yield", 0),
  { name: "spot3", label: "Asset 3 spot", value: 100, min: 0.0001, step: "any" },
  percent("volatility3", "Asset 3 initial volatility", 30, { min: 0.01 }), percent("dividendYield3", "Asset 3 dividend yield", 0),
  { name: "correlation", label: "Common asset correlation", value: 0.35, min: -0.49, max: 0.99, step: 0.01 },
];

let requestId = 0;
let metadata = { methods: referenceMethods, descriptions: fallbackDescriptions };
let currentBusy = false;
const engines = new Map();

function createField(definition) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  wrapper.dataset.fieldName = definition.name;
  const label = document.createElement("label");
  label.htmlFor = definition.name;
  label.textContent = definition.label;
  wrapper.append(label);
  let control;
  if (definition.type === "select") {
    control = document.createElement("select");
    for (const [value, text] of definition.options) control.append(new Option(text, value));
    control.value = String(definition.value ?? definition.options[0][0]);
    wrapper.append(control);
  } else if (definition.type === "checkbox") {
    wrapper.classList.add("checkbox-field");
    control = document.createElement("input");
    control.type = "checkbox";
    control.checked = definition.checked !== false;
    label.prepend(control);
    label.classList.add("checkbox");
  } else {
    const inputWrap = document.createElement("div");
    inputWrap.className = "input-wrap";
    control = document.createElement("input");
    control.type = definition.type || "number";
    control.value = definition.value;
    if (definition.min !== undefined) control.min = definition.min;
    if (definition.max !== undefined) control.max = definition.max;
    if (definition.step !== undefined) control.step = definition.step;
    inputWrap.append(control);
    if (definition.suffix) {
      const suffix = document.createElement("span");
      suffix.className = "suffix";
      suffix.textContent = definition.suffix;
      inputWrap.append(suffix);
    }
    wrapper.append(inputWrap);
  }
  control.id = definition.name;
  control.name = definition.name;
  if (definition.transform) control.dataset.transform = definition.transform;
  if (definition.name === "scheduleMode") control.addEventListener("change", updateScheduleFields);
  return wrapper;
}

function renderVolatilityFields() {
  if (productSelect.value === "american" && volatilitySelect.value !== "constant") {
    volatilitySelect.value = "constant";
  }
  volatilityFields.replaceChildren(...volatilityFieldDefinitions[volatilitySelect.value].map(createField));
  volatilityNote.textContent = volatilityNotes[volatilitySelect.value];
  updateMethodOptions();
}

function renderBasketFields() {
  const method = methodSelect.value;
  const pdeSelected = method === "pde" || method === "adi" || method.startsWith("pde-");
  if (pdeSelected && underlyingSelect.value !== "single") underlyingSelect.value = "single";
  const visible = underlyingSelect.value !== "single" || ["rainbow", "himalayan"].includes(productSelect.value);
  basketFields.hidden = !visible;
  basketFields.replaceChildren(...(visible ? basketFieldDefinitions.map(createField) : []));
  const order = basketFields.querySelector("[data-field-name='basketOrder']");
  if (order) order.hidden = underlyingSelect.value !== "order-performance";
}

function renderProductFields() {
  const product = productSelect.value;
  productFields.replaceChildren(...fieldsByProduct[product].map(createField));
  productNote.textContent = metadata.descriptions[product] || fallbackDescriptions[product];
  optionTypeField.hidden = ["autocallable", "phoenix-autocall", "yield-seeker", "himalayan", "compound",
    "variance-swap", "volatility-swap", "accumulator"].includes(product);
  updateScheduleFields();
  renderBasketFields();
  updateMethodOptions();
}

function updateScheduleFields() {
  const mode = form.elements.scheduleMode?.value || "equal";
  for (const element of productFields.querySelectorAll("[data-field-name]")) {
    const name = element.dataset.fieldName;
    if (name === "monitoringSteps" || name === "exerciseDates") element.hidden = mode !== "equal";
    if (name === "valuationDate") element.hidden = mode === "equal";
    if (name === "observationDates") element.hidden = mode !== "custom";
  }
}

function availableMethods() {
  if (languageSelect.value !== "js") return ["mc"];
  const methods = metadata.methods[productSelect.value] || referenceMethods[productSelect.value] || ["mc"];
  if (volatilitySelect.value === "constant") return methods;
  if (productSelect.value === "variance-swap" && volatilitySelect.value === "term") {
    return methods.filter((method) => ["static-replication", "mc", "qmc"].includes(method));
  }
  return methods.filter((method) => ["mc", "qmc"].includes(method));
}

function updateMethodOptions() {
  const previous = methodSelect.value;
  const methods = availableMethods();
  methodSelect.replaceChildren(...methods.map((method) => new Option(methodLabels[method] || method, method)));
  if (methods.includes(previous)) methodSelect.value = previous;
  updateMethodFields();
}

function updateMethodFields() {
  const method = methodSelect.value;
  const isPde = method === "pde" || method === "adi" || method.startsWith("pde-");
  if (isPde && underlyingSelect.value !== "single") {
    underlyingSelect.value = "single";
    renderBasketFields();
  }
  methodNote.textContent = methodNotes[method] || "";
  document.querySelectorAll("[data-numeric-field='simulation']").forEach((element) => {
    element.hidden = !["mc", "qmc"].includes(method);
  });
  document.querySelectorAll("[data-numeric-field='pde']").forEach((element) => {
    element.hidden = !isPde;
  });
  document.querySelectorAll("[data-numeric-field='american-pde']").forEach((element) => {
    element.hidden = !method.startsWith("pde-");
  });
  document.querySelectorAll("[data-numeric-field='asian-pde']").forEach((element) => {
    element.hidden = method !== "adi";
  });
  document.querySelectorAll("[data-numeric-field='qmc']").forEach((element) => {
    element.hidden = method !== "qmc";
  });
}

function utcDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function followingWeekday(date) {
  const result = new Date(date.getTime());
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function buildObservationTimes(data) {
  const mode = data.scheduleMode || "equal";
  if (mode === "equal") return [];
  const start = utcDate(data.valuationDate);
  const maturity = Number(data.maturity);
  const end = new Date(start.getTime() + Math.round(365 * maturity) * 86400000);
  let dates = [];
  if (mode === "business-monthly") {
    for (let month = 1; month <= Math.ceil(maturity * 12); month += 1) {
      const date = followingWeekday(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, start.getUTCDate())));
      if (date < end) dates.push(date);
    }
  } else {
    dates = String(data.observationDates || "").split(",").map((value) => value.trim()).filter(Boolean).map(utcDate);
  }
  const times = dates.map((date) => (date - start) / (365 * 86400000))
    .filter((time) => time > 0 && time < maturity - 1e-10).sort((a, b) => a - b);
  const unique = times.filter((time, index) => index === 0 || time - times[index - 1] > 1e-10);
  unique.push(maturity);
  if (unique.length > PolyglotContract.MAX_SCHEDULE) throw new Error(`At most ${PolyglotContract.MAX_SCHEDULE} observation dates are supported.`);
  return unique;
}

function readConfig() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.rate = Number(data.rate) / 100;
  data.dividendYield = Number(data.dividendYield) / 100;
  data.volatility = Number(data.volatility) / 100;
  form.querySelectorAll("[data-transform='percent']").forEach((input) => { data[input.name] = Number(input.value) / 100; });
  data.randomizedQmc = form.elements.randomizedQmc.checked;
  data.includeInitialFixing = Boolean(form.elements.includeInitialFixing?.checked);
  data.memoryCoupon = form.elements.memoryCoupon ? form.elements.memoryCoupon.checked : true;
  data.ladderRungs = String(data.ladderRungs || "").split(",").map(Number).filter(Number.isFinite);
  data.basketWeights = String(data.basketWeights || "0.5,0.3,0.2").split(",").map(Number).filter(Number.isFinite);
  data.pdeSpotGrid = Number(data.pdeGrid);
  data.observationTimes = buildObservationTimes(data);
  return data;
}

function setBusy(busy, label = "Working…") {
  currentBusy = busy;
  const ready = engines.get(languageSelect.value)?.state === "ready";
  priceButton.disabled = busy || !ready;
  benchmarkButton.disabled = busy;
  volRegressionButton.disabled = busy;
  priceButton.textContent = busy ? label : `Price with ${languageDefinitions[languageSelect.value].label}`;
}

function setStatus(text, state) {
  engineStatus.textContent = text;
  engineStatus.dataset.state = state;
}

function ensureEngine(language, retry = false) {
  const definition = languageDefinitions[language];
  let entry = engines.get(language);
  if (entry && !retry) return entry;
  if (entry?.worker) entry.worker.terminate();
  const worker = new Worker(definition.url, { type: definition.type });
  entry = { worker, state: "loading", timer: 0 };
  engines.set(language, entry);
  entry.timer = window.setTimeout(() => {
    if (entry.state !== "loading") return;
    entry.state = "error";
    if (languageSelect.value === language) {
      setStatus(`${definition.detail} did not finish loading`, "error");
      formError.textContent = `The ${definition.label} runtime exceeded ${definition.timeout / 1000} seconds. Re-select it to retry, or use C++/Rust/JavaScript immediately.`;
      setBusy(false);
    }
  }, definition.timeout);
  worker.addEventListener("message", (event) => handleWorkerMessage(language, event.data));
  worker.addEventListener("error", () => handleEngineError(language, `The ${definition.detail} worker could not start.`));
  return entry;
}

function handleEngineError(language, message) {
  const entry = engines.get(language);
  if (entry) {
    window.clearTimeout(entry.timer);
    entry.state = "error";
  }
  if (languageSelect.value === language) {
    setStatus(`${languageDefinitions[language].detail} failed to load`, "error");
    formError.textContent = `${message} Open this page through http://127.0.0.1:8000/exotics.html, not as a file.`;
    setBusy(false);
  }
}

function handleWorkerMessage(language, message) {
  const entry = engines.get(language);
  if (message.type === "ready") {
    window.clearTimeout(entry.timer);
    entry.state = "ready";
    if (language === "js" && message.methods) {
      metadata = { methods: message.methods, descriptions: message.descriptions || fallbackDescriptions };
      renderProductFields();
    }
    if (languageSelect.value === language) {
      formError.textContent = "";
      setStatus(`${languageDefinitions[language].detail} ready locally`, "ready");
      updateMethodOptions();
      setBusy(false);
    }
    return;
  }
  if (message.type === "error" && message.requestId === undefined) {
    handleEngineError(language, message.message);
    return;
  }
  if (message.requestId !== requestId) return;
  setBusy(false);
  if (message.type === "error") {
    formError.textContent = message.message;
    return;
  }
  formError.textContent = "";
  if (message.type === "result") renderResult({ ...message.result, language });
  if (message.type === "benchmarks") renderBenchmarks(message.rows, false);
  if (message.type === "volatility-regressions") renderBenchmarks(message.rows, true);
}

function activateLanguage() {
  if (productSelect.value === "american" && languageSelect.value !== "js") {
    languageSelect.value = "js";
  }
  const language = languageSelect.value;
  const definition = languageDefinitions[language];
  languageNote.textContent = definition.note;
  formError.textContent = "";
  let entry = engines.get(language);
  if (entry?.state === "error") entry = ensureEngine(language, true);
  else entry = ensureEngine(language);
  updateMethodOptions();
  if (entry.state === "ready") setStatus(`${definition.detail} ready locally`, "ready");
  else setStatus(`Loading ${definition.detail}…`, "working");
  setBusy(false);
}

function formatNumber(value, digits = 8) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.abs(value) < 0.01 ? 6 : 2 }).format(value);
}

function renderResult(result) {
  const config = result.config;
  document.querySelector("#price-output").textContent = formatNumber(result.price);
  document.querySelector("#uncertainty-output").textContent = result.standardError === null
    ? "Deterministic estimate"
    : `SE ${formatNumber(result.standardError)} · payoff σ ${formatNumber(result.standardDeviation)}`;
  document.querySelector("#product-output").textContent = productLabels[config.product];
  document.querySelector("#method-output").textContent = `${languageDefinitions[result.language].label} · ${methodLabels[result.method] || result.method}`;
  document.querySelector("#volatility-output").textContent = volatilityLabels[config.volatilityModel];
  document.querySelector("#underlying-output").textContent = config.underlyingMode === "single" ? "Single asset" : config.underlyingMode.replaceAll("-", " ");
  document.querySelector("#runtime-output").textContent = `${result.elapsedMs.toFixed(1)} ms`;
  document.querySelector("#payoff-output").textContent = metadata.descriptions[config.product] || fallbackDescriptions[config.product];
  let workload = "Formula evaluation";
  if (["mc", "qmc"].includes(result.method)) workload = `${new Intl.NumberFormat("en-US").format(result.samples)} paths`;
  else if (result.method === "pde" || result.method === "adi" || result.method.startsWith("pde-")) {
    workload = `${config.pdeSpotGrid || config.pdeGrid} × ${config.pdeAverageGrid || config.pdeTimeSteps} grid · ${config.pdeGridType}`;
    if (result.pdeDiagnostics?.maximumIterations) {
      workload += ` · max ${result.pdeDiagnostics.maximumIterations} iterations`;
    }
  }
  else if (result.method === "tree") workload = `${config.treeSteps} tree steps`;
  else if (result.method === "semi-closed") workload = "96 spectral modes";
  else if (result.method === "static-replication") workload = "Numerical OTM option strip";
  document.querySelector("#workload-output").textContent = workload;
  resultPanel.hidden = false;
}

function renderBenchmarks(rows, volatilityRegression) {
  document.querySelector("#benchmark-title").textContent = volatilityRegression ? "Volatility-model limit regressions" : "Reduction & benchmark suite";
  document.querySelector("#benchmark-description").textContent = volatilityRegression
    ? "Each payoff is replayed with identical random numbers so nested-model limits must agree path by path."
    : "Independent methods or simplified payoffs are compared with vanilla, barrier-parity, or note reductions.";
  benchmarkBody.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    const status = document.createElement("span");
    status.className = `pass-badge${row.passed ? "" : " fail"}`;
    status.textContent = row.passed ? "PASS" : "FAIL";
    const cells = [row.name, status, formatNumber(row.reference), formatNumber(row.candidate), Number(row.absoluteError).toExponential(2),
      row.reduction || row.name.split(": ").at(-1)];
    for (const value of cells) {
      const td = document.createElement("td");
      if (value instanceof Node) td.append(value); else td.textContent = value;
      tr.append(td);
    }
    return tr;
  }));
  benchmarkPanel.hidden = false;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const language = languageSelect.value;
    const entry = engines.get(language);
    if (entry?.state !== "ready") {
      activateLanguage();
      return;
    }
    const config = readConfig();
    requestId += 1;
    setBusy(true, `Pricing with ${languageDefinitions[language].label}…`);
    if (language === "js") entry.worker.postMessage({ type: "price", requestId, method: methodSelect.value, config });
    else entry.worker.postMessage({
      type: "price", requestId, method: "mc", config,
      parameters: PolyglotContract.pack(config), paths: Math.trunc(Number(config.paths)), seed: Math.trunc(Number(config.seed)),
    });
  } catch (error) {
    formError.textContent = error.message || String(error);
    setBusy(false);
  }
});

function runReferenceSuite(type) {
  const entry = ensureEngine("js");
  if (entry.state !== "ready") {
    formError.textContent = "The JavaScript reference engine is still loading; try again in a moment.";
    return;
  }
  requestId += 1;
  setBusy(true, "Testing…");
  entry.worker.postMessage({ type, requestId, paths: 1024 });
}

benchmarkButton.addEventListener("click", () => runReferenceSuite("benchmark"));
volRegressionButton.addEventListener("click", () => runReferenceSuite("volatility-regression"));
languageSelect.addEventListener("change", activateLanguage);
productSelect.addEventListener("change", () => {
  const requiresReferencePde = productSelect.value === "american" && languageSelect.value !== "js";
  if (productSelect.value === "american" && volatilitySelect.value !== "constant") {
    volatilitySelect.value = "constant";
    renderVolatilityFields();
  }
  renderProductFields();
  if (requiresReferencePde) activateLanguage();
});
volatilitySelect.addEventListener("change", renderVolatilityFields);
underlyingSelect.addEventListener("change", renderBasketFields);
methodSelect.addEventListener("change", updateMethodFields);

renderVolatilityFields();
renderProductFields();
activateLanguage();
