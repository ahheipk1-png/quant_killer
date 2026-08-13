// Shared exotic-payoff schema and form-rendering helpers. Originally lived
// entirely inside exotics.js; extracted so index.html's instrument builder
// can drive the exact same 18-product field catalog and pricing metadata
// without a second, drifting copy. exotics.js still owns the DOM-wiring
// orchestration (which elements to show/hide, when) — this module only
// owns the data and the pure/DOM-generic pieces.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ExoticFields = api;
}(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const productLabels = {
    american: "American vanilla · PDE",
    digital: "Digital / binary", barrier: "Single barrier", "double-barrier": "Double barrier",
    bermudan: "Bermudan", rainbow: "Rainbow / order statistic", basket: "Weighted basket",
    autocallable: "Autocallable",
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
    basket: "Call or put on the weighted sum of correlated assets at maturity; four moment-matching approximations plus MC.",
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
    js: { label: "JavaScript", detail: "JavaScript reference", url: "exotic-worker.js?v=8", type: "classic", timeout: 10000,
      note: "Reference engine: product formulas, tree/PDE methods, PCG Monte Carlo, and Sobol QMC." },
    cpp: { label: "C++", detail: "C++ / WebAssembly", url: "advanced-cpp-worker.js?v=2", type: "classic", timeout: 10000,
      note: "Native C++ path engine: every listed payoff and volatility model through seeded Monte Carlo." },
    rust: { label: "Rust", detail: "Rust / WebAssembly", url: "advanced-rust-worker.js?v=2", type: "classic", timeout: 10000,
      note: "Native Rust path engine: every listed payoff and volatility model through seeded Monte Carlo." },
    python: { label: "Python", detail: "Python / Pyodide", url: "advanced-python-worker.mjs?v=6", type: "module", timeout: 45000,
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
    "closed-form-daily": "Closed form · daily BGK",
    "closed-form-weekly": "Closed form · weekly BGK",
    "closed-form-terminal": "Closed form · barrier at maturity",
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
    "closed-form": "Analytic or semi-analytic constant-volatility formula (continuous monitoring for barriers). For a basket barrier this prices the moment-matched effective GBM, and its Monte Carlo check is that same effective GBM run through the bridge-corrected single-asset engine — so the check validates the formula against its own approximation, NOT how closely that approximation tracks the true multi-asset basket.",
    "semi-closed": "Absorbing-boundary spectral series with numerical payoff integration (continuous monitoring).",
    "closed-form-daily": "Continuous formula with the Broadie–Glasserman–Kou barrier shift exp(±0.5826·σ·√Δt), Δt = 1/252. A matched 252-obs/yr Sobol MC error check is attached to the result.",
    "closed-form-weekly": "Continuous formula with the Broadie–Glasserman–Kou barrier shift exp(±0.5826·σ·√Δt), Δt = 1/52. A matched 52-obs/yr Sobol MC error check is attached to the result.",
    "closed-form-terminal": "European barrier: tested only at expiry, priced as truncated Black–Scholes integrals over the surviving terminal region.",
    tree: "Recombining lattice; Bermudan exercise occurs only on configured dates.",
    pde: "One-factor Black–Scholes finite-difference PDE.",
    mc: "Path simulation with a reported payoff standard deviation and estimator standard error.",
    qmc: "Sobol low-discrepancy paths; optionally randomized with a digital shift.",
    levy: "Matches the first two moments of the arithmetic average or weighted basket sum with a lognormal.",
    "shifted-lognormal": "Fits a shifted lognormal to the first three moments of the average or weighted basket sum.",
    curran: "Conditions the arithmetic average or weighted basket on its geometric counterpart.",
    "curran-two-moment": "Adds a conditional two-moment fit to Curran conditioning.",
    "ju-taylor": "Published Ju lognormal characteristic-function correction through volatility order 6; supports uneven Asian fixings and positive-weight price/return baskets up to 320 stochastic components.",
    adi: "Two-state spot/running-sum PDE with fixing-date jump operators and Crank–Nicolson spot steps.",
    "static-replication": "Numerically integrates out-of-the-money Black–Scholes options across strike.",
  };

  const referenceMethods = {
    american: ["pde-projection", "pde-psor", "pde-penalty"],
    digital: ["closed-form", "mc", "qmc"],
    barrier: ["closed-form", "closed-form-daily", "closed-form-weekly", "closed-form-terminal", "pde", "mc", "qmc"],
    "double-barrier": ["semi-closed", "closed-form-daily", "closed-form-weekly", "closed-form-terminal", "pde", "mc", "qmc"],
    bermudan: ["tree", "pde", "mc", "qmc"],
    rainbow: ["closed-form", "mc", "qmc"], autocallable: ["mc", "qmc"], himalayan: ["mc", "qmc"],
    // Default/fallback list for the basket product before a sub-mode is
    // known -- the actual dropdown always narrows via basketMethodsFor().
    basket: ["levy", "shifted-lognormal", "curran", "curran-two-moment", "ju-taylor", "mc", "qmc"],
    lookback: ["closed-form", "mc", "qmc"], ladder: ["mc", "qmc"],
    compound: ["closed-form", "mc", "qmc"],
    asian: ["levy", "shifted-lognormal", "curran", "curran-two-moment", "ju-taylor", "adi", "mc", "qmc"],
    "phoenix-autocall": ["mc", "qmc"], "yield-seeker": ["mc", "qmc"],
    "variance-swap": ["static-replication", "mc", "qmc"], "volatility-swap": ["mc", "qmc"],
    "variance-option": ["mc", "qmc"], "volatility-option": ["mc", "qmc"], accumulator: ["mc", "qmc"],
  };

  // Basket sub-mode -> method list. Vanilla and digital share the full
  // moment-matching set (Ju digital rides a central finite difference in
  // strike on the vanilla Ju price). Barrier is deliberately narrower: only
  // the 2-moment effective-lognormal/effective-GBM route extends to a
  // path-dependent payoff -- Curran and Ju approximate the terminal
  // marginal only, with no running-maximum structure to hand a barrier
  // formula, and there is no plain-continuous entry because the basket
  // Monte Carlo benchmark has no Brownian-bridge correction to match it.
  const basketMethodsByPayoff = {
    vanilla: ["levy", "shifted-lognormal", "curran", "curran-two-moment", "ju-taylor", "mc", "qmc"],
    digital: ["levy", "shifted-lognormal", "curran", "curran-two-moment", "ju-taylor", "mc", "qmc"],
    barrier: ["closed-form", "closed-form-daily", "closed-form-weekly", "closed-form-terminal",
      "mc", "qmc"],
  };
  const basketMethodsFor = (payoffMode) => basketMethodsByPayoff[payoffMode] || basketMethodsByPayoff.vanilla;

  const percent = (name, label, value, extra = {}) => ({ name, label, value, suffix: "%", transform: "percent", min: 0, step: "any", ...extra });
  const select = (name, label, options, value) => ({ name, label, type: "select", options, value });

  // Rebate defaults to 0, which is a no-op in every closed form -- adding
  // these fields cannot move an existing price.
  const rebateFields = () => [
    { name: "rebate", label: "Rebate", value: 0, min: 0, step: "any" },
    select("rebateTiming", "Rebate timing", [
      ["hit", "Paid when barrier is hit"], ["expiry", "Paid at expiry"],
    ], "hit"),
  ];
  const scheduleFields = (count = 12, countLabel = "Equal observation dates") => [
    { name: "monitoringSteps", label: countLabel, value: count, min: 1, max: 260, step: 1 },
    select("scheduleMode", "Observation schedule", [["equal", "Equally spaced"], ["business-monthly", "Monthly business day"], ["custom", "Custom business dates"]], "equal"),
    { name: "valuationDate", label: "Start date", type: "date", value: "2026-08-03" },
    { name: "endDate", label: "End date", type: "date", value: "2027-08-03" },
    select("holidayCalendar", "Holiday calendar", HolidayCalendars.MARKETS, "weekends"),
    { name: "observationDates", label: "Custom dates · comma separated", type: "text", value: "2026-09-01, 2026-10-15, 2027-01-04, 2027-08-02" },
  ];

  const fieldsByProduct = {
    american: [],
    digital: [{ name: "cashPayoff", label: "Cash payoff", value: 10, min: 0, step: "any" }],
    barrier: [
      { name: "barrier", label: "Barrier level", value: 125, min: 0.0001, step: "any" },
      select("barrierDirection", "Barrier direction", [["up", "Up"], ["down", "Down"]]),
      select("barrierStyle", "Barrier style", [["out", "Knock-out"], ["in", "Knock-in"]]),
      ...rebateFields(), ...scheduleFields(),
    ],
    "double-barrier": [
      { name: "lowerBarrier", label: "Lower barrier", value: 70, min: 0.0001, step: "any" },
      { name: "upperBarrier", label: "Upper barrier", value: 130, min: 0.0001, step: "any" },
      select("barrierStyle", "Barrier style", [["out", "Knock-out"], ["in", "Knock-in"]]),
      ...rebateFields(), ...scheduleFields(),
    ],
    bermudan: [
      { name: "exerciseDates", label: "Equal exercise dates", value: 4, min: 1, max: 260, step: 1 },
      { name: "treeSteps", label: "Tree steps", value: 600, min: 50, max: 2000, step: 1 },
      select("scheduleMode", "Exercise schedule", [["equal", "Equally spaced"], ["business-monthly", "Monthly business day"], ["custom", "Custom business dates"]], "equal"),
      { name: "valuationDate", label: "Start date", type: "date", value: "2026-08-03" },
      { name: "endDate", label: "End date", type: "date", value: "2027-08-03" },
      select("holidayCalendar", "Holiday calendar", HolidayCalendars.MARKETS, "weekends"),
      { name: "observationDates", label: "Custom dates · comma separated", type: "text", value: "2026-11-02, 2027-02-03, 2027-05-03, 2027-08-02" },
    ],
    rainbow: [
      select("rainbowStyle", "Order statistic", [["best", "Best performer"], ["worst", "Worst performer"]]),
      select("assetCount", "Asset count", [["2", "Two"], ["3", "Three"]], "2"),
    ],
    basket: [
      select("assetCount", "Asset count", [["2", "Two"], ["3", "Three"]], "2"),
      select("basketPayoff", "Basket payoff", [
        ["vanilla", "Vanilla call/put"], ["digital", "Digital / binary"], ["barrier", "Barrier"],
      ], "vanilla"),
      { name: "cashPayoff", label: "Cash payoff", value: 10, min: 0, step: "any" },
      select("basketBarrierKind", "Barrier kind", [
        ["single", "Single barrier"], ["double", "Double barrier"],
      ], "single"),
      { name: "barrier", label: "Barrier level", value: 125, min: 0.0001, step: "any" },
      select("barrierDirection", "Barrier direction", [["up", "Up"], ["down", "Down"]]),
      { name: "lowerBarrier", label: "Lower barrier", value: 70, min: 0.0001, step: "any" },
      { name: "upperBarrier", label: "Upper barrier", value: 130, min: 0.0001, step: "any" },
      select("barrierStyle", "Barrier style", [["out", "Knock-out"], ["in", "Knock-in"]]),
      ...rebateFields(),
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
    percent("borrow2", "Asset 2 borrow cost", 0),
    { name: "spot3", label: "Asset 3 spot", value: 100, min: 0.0001, step: "any" },
    percent("volatility3", "Asset 3 initial volatility", 30, { min: 0.01 }), percent("dividendYield3", "Asset 3 dividend yield", 0),
    percent("borrow3", "Asset 3 borrow cost", 0),
    { name: "correlation", label: "Common asset correlation", value: 0.35, min: -0.49, max: 0.99, step: 0.01 },
    // Individually capped/floored components. The clip is on each asset's
    // performance ratio at every observation date, before the basket is
    // formed -- so it applies to any multi-asset mode, not just Asians.
    { name: "capComponents", label: "Cap / floor each component", type: "checkbox", checked: false },
    { name: "componentCap", label: "Component cap / initial", value: 1.3, min: 0, step: 0.01 },
    { name: "componentFloor", label: "Component floor / initial", value: 0.7, min: 0, step: 0.01 },
  ];

  // `onScheduleModeChange` is optional -- only the "scheduleMode" field (part
  // of scheduleFields()) ever wires it, and callers that never render a
  // schedule (volatility/basket fields) can omit it entirely.
  function createField(definition, onScheduleModeChange) {
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
    if (definition.name === "scheduleMode" && onScheduleModeChange) control.addEventListener("change", onScheduleModeChange);
    return wrapper;
  }

  function utcDate(value) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date: ${value}`);
    return date;
  }

  function followingWeekday(date) {
    return HolidayCalendars.followingBusinessDay(date, "weekends");
  }

  function buildObservationTimes(data) {
    const mode = data.scheduleMode || "equal";
    if (mode === "equal") return [];
    const start = utcDate(data.valuationDate);
    const maturity = Number(data.maturity);
    // End date only bounds the generated schedule window -- maturity is
    // still the authoritative pricing input (see the time-filter below),
    // so a mismatched end date can only drop dates early, never add ones
    // past maturity.
    const end = data.endDate ? utcDate(data.endDate) : new Date(start.getTime() + Math.round(365 * maturity) * 86400000);
    let dates = [];
    if (mode === "business-monthly") {
      const calendar = data.holidayCalendar || "weekends";
      for (let month = 1; month <= Math.ceil(maturity * 12); month += 1) {
        const date = HolidayCalendars.followingBusinessDay(
          new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, start.getUTCDate())), calendar,
        );
        if (date < end) dates.push(date);
      }
    } else {
      // index.html's dynamic date-row list sends an array directly;
      // exotics.html's single comma-separated text field still sends a string.
      dates = Array.isArray(data.observationDates)
        ? data.observationDates.filter(Boolean).map(utcDate)
        : String(data.observationDates || "").split(",").map((value) => value.trim()).filter(Boolean).map(utcDate);
    }
    const times = dates.map((date) => (date - start) / (365 * 86400000))
      .filter((time) => time > 0 && time < maturity - 1e-10).sort((a, b) => a - b);
    const unique = times.filter((time, index) => index === 0 || time - times[index - 1] > 1e-10);
    unique.push(maturity);
    if (unique.length > PolyglotContract.MAX_SCHEDULE) throw new Error(`At most ${PolyglotContract.MAX_SCHEDULE} observation dates are supported.`);
    return unique;
  }

  function formatNumber(value, digits = 8) {
    if (!Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.abs(value) < 0.01 ? 6 : 2 }).format(value);
  }

  return {
    productLabels, fallbackDescriptions, languageDefinitions,
    volatilityLabels, volatilityNotes, methodLabels, methodNotes, referenceMethods,
    fieldsByProduct, volatilityFieldDefinitions, basketFieldDefinitions,
    basketMethodsFor,
    createField, utcDate, followingWeekday, buildObservationTimes, formatNumber,
  };
}));
