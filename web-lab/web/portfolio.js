(function () {
  "use strict";

  const STORAGE_KEY = "quantkiller.portfolio.v1";
  const VANILLA_METHODS = ["closed-form", "mc", "qmc"];
  const PRODUCT_LABELS = {
    vanilla: "European vanilla",
    american: "American vanilla · PDE",
    digital: "Digital / binary",
    barrier: "Single barrier",
    "double-barrier": "Double barrier",
    bermudan: "Bermudan",
    rainbow: "Rainbow",
    autocallable: "Autocallable",
    himalayan: "Himalayan",
    lookback: "Lookback",
    ladder: "Ladder",
    compound: "Compound",
    asian: "Discrete arithmetic Asian",
    "phoenix-autocall": "Phoenix autocall",
    "variance-swap": "Variance swap",
    "volatility-swap": "Volatility swap",
    "variance-option": "Variance option",
    "volatility-option": "Volatility option",
    accumulator: "Accumulator",
    "yield-seeker": "Yield seeker",
  };
  const METHOD_LABELS = {
    "pde-projection": "American PDE · projected CN",
    "pde-psor": "American PDE · PSOR LCP",
    "pde-penalty": "American PDE · penalty",
    "closed-form": "Closed / semi-closed form",
    "semi-closed": "Semi-closed form",
    "static-replication": "Static replication",
    tree: "CRR tree",
    pde: "PDE",
    mc: "Monte Carlo",
    qmc: "Sobol QMC",
    levy: "Levy moment match",
    "shifted-lognormal": "Shifted lognormal",
    curran: "Curran conditioning",
    "curran-two-moment": "Curran two-moment",
    "ju-taylor": "Ju order-six expansion",
    adi: "ADI PDE",
  };
  const OVERRIDE_EXAMPLES = {
    barrier: { barrier: 130, barrierDirection: "up", barrierStyle: "out" },
    "double-barrier": { lowerBarrier: 70, upperBarrier: 140, barrierStyle: "out" },
    bermudan: { exerciseDates: 4, treeSteps: 600 },
    rainbow: { spot2: 95, volatility2: 0.25, correlation: 0.4, rainbowStyle: "best" },
    autocallable: { notional: 100, coupon: 0.02, autocallBarrier: 1, protectionBarrier: 0.7 },
    himalayan: { assetCount: 3, observations: 3, returnStrike: 0, notional: 100 },
    ladder: { ladderRungs: [110, 120, 130] },
    compound: { compoundStrike: 5, decisionTime: 0.5, compoundOuterType: "call", compoundInnerType: "call" },
    asian: { observationTimes: [0.08, 0.21, 0.43, 0.68, 1], includeInitialFixing: true },
    "phoenix-autocall": { notional: 100, coupon: 0.02, couponBarrier: 0.7, autocallBarrier: 1, protectionBarrier: 0.7 },
    "variance-swap": { varianceStrike: 0.04, varianceNotional: 1000 },
    "volatility-swap": { volatilityStrike: 0.2, varianceNotional: 1000 },
    "variance-option": { varianceStrike: 0.04, varianceNotional: 1000 },
    "volatility-option": { volatilityStrike: 0.2, varianceNotional: 1000 },
    accumulator: { accumulatorQuantity: 1, accumulatorGearing: 2, accumulatorKnockOut: 1.1 },
    "yield-seeker": { notional: 100, coupon: 0.02, couponBarrier: 0.7, protectionBarrier: 0.7 },
  };

  const form = document.querySelector("#deal-form");
  const productSelect = document.querySelector("#product");
  const methodSelect = document.querySelector("#method");
  const overridesInput = document.querySelector("#overrides");
  const methodHelp = document.querySelector("#method-help");
  const formError = document.querySelector("#form-error");
  const portfolioBody = document.querySelector("#portfolio-body");
  const emptyState = document.querySelector("#portfolio-empty");
  const saveButton = document.querySelector("#save-deal");
  const cancelButton = document.querySelector("#cancel-edit");
  const editorTitle = document.querySelector("#editor-title");
  const priceButton = document.querySelector("#price-portfolio");
  const batchStatus = document.querySelector("#batch-status");

  let deals = [];
  let editingId = null;
  let requestId = 0;
  let busy = false;
  const worker = new Worker("portfolio-worker.js?v=3");

  function newId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `deal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function formatNumber(value, digits = 8) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: digits,
      minimumFractionDigits: Math.min(2, digits),
    }).format(value);
  }

  function methodsFor(product) {
    if (product === "vanilla") return VANILLA_METHODS;
    return AdvancedPricer.PRODUCT_METHODS[product] || [];
  }

  function updateMethodOptions(preferred) {
    const methods = methodsFor(productSelect.value);
    methodSelect.replaceChildren(...methods.map((method) => {
      const option = document.createElement("option");
      option.value = method;
      option.textContent = METHOD_LABELS[method] || method;
      return option;
    }));
    if (preferred && methods.includes(preferred)) methodSelect.value = preferred;
    const description = productSelect.value === "vanilla"
      ? "European vanilla supports a formula and one-fixing MC/QMC reductions."
      : AdvancedPricer.PRODUCT_DESCRIPTIONS[productSelect.value];
    methodHelp.textContent = `${description || ""} Available methods: ${methods.map((method) => METHOD_LABELS[method] || method).join(", ")}.`;
    const example = OVERRIDE_EXAMPLES[productSelect.value];
    overridesInput.placeholder = example ? JSON.stringify(example) : "{}";
  }

  function initializeProducts() {
    productSelect.replaceChildren(...Object.entries(PRODUCT_LABELS).map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    updateMethodOptions();
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deals.map((deal) => ({
        ...deal,
        result: undefined,
        status: "unpriced",
        error: "",
      }))));
    } catch (_) {
      // The portfolio still works when storage is disabled.
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) deals = saved;
    } catch (_) {
      deals = [];
    }
  }

  function statusBadge(deal) {
    const badge = document.createElement("span");
    if (deal.status === "priced") {
      badge.className = "pass-badge";
      badge.textContent = "PRICED";
    } else if (deal.status === "error") {
      badge.className = "pass-badge fail";
      badge.textContent = "ERROR";
    } else if (deal.status === "pricing") {
      badge.className = "pass-badge";
      badge.textContent = "RUNNING";
    } else {
      badge.className = "group-status";
      badge.textContent = "UNPRICED";
    }
    return badge;
  }

  function actionButton(action, label, id) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-button";
    button.dataset.action = action;
    button.dataset.id = id;
    button.textContent = label;
    return button;
  }

  function render() {
    portfolioBody.replaceChildren();
    let totalPv = 0;
    let priced = 0;
    deals.forEach((deal) => {
      const row = document.createElement("tr");
      const title = document.createElement("td");
      title.className = "deal-title";
      title.textContent = deal.name;
      const market = document.createElement("span");
      market.className = "deal-subtitle";
      market.textContent = `S=${deal.config.spot}, K=${deal.config.strike}, T=${deal.config.maturity}`;
      title.appendChild(market);

      const product = document.createElement("td");
      product.textContent = PRODUCT_LABELS[deal.config.product] || deal.config.product;
      const method = document.createElement("span");
      method.className = "deal-subtitle";
      method.textContent = METHOD_LABELS[deal.method] || deal.method;
      product.appendChild(method);

      const quantity = document.createElement("td");
      quantity.className = "numeric-cell";
      quantity.textContent = formatNumber(deal.quantity, 4);
      const unitPv = document.createElement("td");
      unitPv.className = "numeric-cell";
      unitPv.textContent = formatNumber(deal.result?.price);
      const standardError = document.createElement("td");
      standardError.className = "numeric-cell";
      standardError.textContent = formatNumber(deal.result?.standardError);
      const positionPv = document.createElement("td");
      positionPv.className = "numeric-cell";
      if (deal.status === "priced") {
        const value = deal.quantity * deal.result.price;
        positionPv.textContent = formatNumber(value);
        totalPv += value;
        priced += 1;
      } else {
        positionPv.textContent = "—";
      }
      const status = document.createElement("td");
      status.appendChild(statusBadge(deal));
      if (deal.error) {
        const detail = document.createElement("span");
        detail.className = "deal-subtitle error-cell";
        detail.textContent = deal.error;
        status.appendChild(detail);
      }
      const actions = document.createElement("td");
      const actionWrap = document.createElement("div");
      actionWrap.className = "row-actions";
      actionWrap.append(
        actionButton("edit", "Edit", deal.id),
        actionButton("duplicate", "Copy", deal.id),
        actionButton("remove", "Remove", deal.id),
      );
      actions.appendChild(actionWrap);
      row.append(title, product, quantity, unitPv, standardError, positionPv, status, actions);
      portfolioBody.appendChild(row);
    });
    emptyState.hidden = deals.length > 0;
    document.querySelector("#deal-count").textContent = String(deals.length);
    document.querySelector("#priced-count").textContent = String(priced);
    document.querySelector("#portfolio-pv").textContent = priced ? formatNumber(totalPv) : "—";
    priceButton.disabled = busy || deals.length === 0;
  }

  function parseOverrides() {
    const source = overridesInput.value.trim();
    if (!source) return {};
    const value = JSON.parse(source);
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error("Product parameters must be a JSON object.");
    }
    return value;
  }

  function readDeal() {
    const data = new FormData(form);
    const maturity = Number(data.get("maturity"));
    const overrides = parseOverrides();
    const config = {
      ...overrides,
      product: data.get("product"),
      optionType: data.get("optionType"),
      spot: Number(data.get("spot")),
      strike: Number(data.get("strike")),
      maturity,
      rate: Number(data.get("rate")) / 100,
      dividendYield: Number(data.get("dividendYield")) / 100,
      borrow: Number(data.get("borrow")) / 100,
      volatility: Number(data.get("volatility")) / 100,
      paths: Math.trunc(Number(data.get("paths"))),
      seed: Math.trunc(Number(data.get("seed"))),
      decisionTime: Number(overrides.decisionTime ?? maturity * 0.5),
    };
    if (!Number.isFinite(Number(data.get("quantity")))) throw new Error("Quantity must be numeric.");
    if (config.product === "vanilla") {
      AdvancedPricer.normalizeConfig({ ...config, product: "lookback" });
    } else {
      AdvancedPricer.normalizeConfig(config);
    }
    return {
      id: editingId || newId(),
      name: String(data.get("dealName")).trim() || "Unnamed deal",
      quantity: Number(data.get("quantity")),
      method: data.get("method"),
      config,
      overrides,
      status: "unpriced",
      error: "",
    };
  }

  function resetEditor() {
    editingId = null;
    editorTitle.textContent = "Add a position";
    saveButton.textContent = "Add deal";
    cancelButton.hidden = true;
    form.reset();
    form.elements.dealName.value = "New deal";
    form.elements.product.value = "vanilla";
    form.elements.optionType.value = "call";
    form.elements.quantity.value = "1";
    form.elements.spot.value = "100";
    form.elements.strike.value = "100";
    form.elements.maturity.value = "1";
    form.elements.volatility.value = "20";
    form.elements.rate.value = "5";
    form.elements.dividendYield.value = "0";
    form.elements.borrow.value = "0";
    form.elements.paths.value = "32768";
    form.elements.seed.value = "42";
    overridesInput.value = "";
    updateMethodOptions("closed-form");
    formError.textContent = "";
  }

  function editDeal(deal) {
    editingId = deal.id;
    editorTitle.textContent = "Edit position";
    saveButton.textContent = "Save changes";
    cancelButton.hidden = false;
    form.elements.dealName.value = deal.name;
    form.elements.product.value = deal.config.product;
    updateMethodOptions(deal.method);
    form.elements.optionType.value = deal.config.optionType;
    form.elements.quantity.value = String(deal.quantity);
    form.elements.spot.value = String(deal.config.spot);
    form.elements.strike.value = String(deal.config.strike);
    form.elements.maturity.value = String(deal.config.maturity);
    form.elements.volatility.value = String(deal.config.volatility * 100);
    form.elements.rate.value = String(deal.config.rate * 100);
    form.elements.dividendYield.value = String(deal.config.dividendYield * 100);
    form.elements.borrow.value = String((deal.config.borrow || 0) * 100);
    form.elements.paths.value = String(deal.config.paths);
    form.elements.seed.value = String(deal.config.seed);
    overridesInput.value = Object.keys(deal.overrides || {}).length
      ? JSON.stringify(deal.overrides, null, 2)
      : "";
    formError.textContent = "";
    form.elements.dealName.focus();
  }

  function sampleDeal(name, product, method, quantity, extra = {}) {
    const maturity = Number(extra.maturity ?? 1);
    const overrides = extra.overrides || {};
    return {
      id: newId(),
      name,
      quantity,
      method,
      config: {
        ...overrides,
        product,
        optionType: extra.optionType || "call",
        spot: Number(extra.spot ?? 100),
        strike: Number(extra.strike ?? 100),
        rate: Number(extra.rate ?? 0.05),
        dividendYield: Number(extra.dividendYield ?? 0),
        volatility: Number(extra.volatility ?? 0.2),
        maturity,
        paths: Number(extra.paths ?? 32768),
        seed: Number(extra.seed ?? 42),
        decisionTime: Number(overrides.decisionTime ?? maturity * 0.5),
      },
      overrides,
      status: "unpriced",
      error: "",
    };
  }

  function loadSample() {
    deals.push(
      sampleDeal("ATM European call", "vanilla", "closed-form", 250),
      sampleDeal("Down-and-out hedge", "barrier", "closed-form", -80, {
        optionType: "put", strike: 105, maturity: 1.5,
        overrides: { barrier: 70, barrierDirection: "down", barrierStyle: "out" },
      }),
      sampleDeal("Quarterly Bermudan put", "bermudan", "tree", 120, {
        optionType: "put", strike: 100,
        overrides: { exerciseDates: 4, treeSteps: 800 },
      }),
      sampleDeal("Uneven Asian call", "asian", "ju-taylor", 175, {
        strike: 102,
        overrides: { observationTimes: [0.08, 0.21, 0.43, 0.68, 1], includeInitialFixing: true },
      }),
      sampleDeal("Protected Phoenix", "phoenix-autocall", "qmc", 10, {
        paths: 32768,
        overrides: { notional: 100, coupon: 0.02, couponBarrier: 0.7, autocallBarrier: 1, protectionBarrier: 0.7 },
      }),
    );
    persist();
    render();
    batchStatus.textContent = "Sample positions added. Click Price portfolio to value all five deals.";
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function exportCsv() {
    const header = ["deal", "product", "method", "option_type", "quantity", "spot", "strike", "maturity", "unit_pv", "standard_error", "position_pv", "status"];
    const rows = deals.map((deal) => [
      deal.name,
      deal.config.product,
      deal.method,
      deal.config.optionType,
      deal.quantity,
      deal.config.spot,
      deal.config.strike,
      deal.config.maturity,
      deal.result?.price ?? "",
      deal.result?.standardError ?? "",
      deal.status === "priced" ? deal.quantity * deal.result.price : "",
      deal.status,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "quantkiller-portfolio.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function pricePortfolio() {
    if (!deals.length || busy) return;
    busy = true;
    requestId += 1;
    deals = deals.map((deal) => ({ ...deal, status: "pricing", result: undefined, error: "" }));
    document.querySelector("#portfolio-runtime").textContent = "—";
    batchStatus.textContent = `Pricing 0 of ${deals.length} deals...`;
    render();
    // Borrow folds into effective dividend at the carry, so the worker (and
    // the wasm engines behind it) stay borrow-unaware. The stored deals keep
    // borrow raw for the editor round-trip.
    const dealsForWorker = deals.map((deal) => ({
      ...deal,
      config: {
        ...deal.config,
        dividendYield: (Number(deal.config.dividendYield) || 0) + (Number(deal.config.borrow) || 0),
      },
    }));
    worker.postMessage({ type: "price-portfolio", requestId, deals: dealsForWorker });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const deal = readDeal();
      const existing = deals.findIndex((item) => item.id === deal.id);
      if (existing >= 0) deals[existing] = deal;
      else deals.push(deal);
      persist();
      render();
      resetEditor();
      batchStatus.textContent = existing >= 0 ? "Deal updated; reprice the portfolio to refresh totals." : "Deal added to the portfolio.";
    } catch (error) {
      formError.textContent = error?.message || String(error);
    }
  });

  productSelect.addEventListener("change", () => updateMethodOptions());
  cancelButton.addEventListener("click", resetEditor);
  document.querySelector("#load-sample").addEventListener("click", loadSample);
  document.querySelector("#export-csv").addEventListener("click", exportCsv);
  document.querySelector("#clear-portfolio").addEventListener("click", () => {
    if (!deals.length || !window.confirm("Remove every deal from this local portfolio?")) return;
    deals = [];
    persist();
    render();
    resetEditor();
    batchStatus.textContent = "Portfolio cleared.";
  });
  priceButton.addEventListener("click", pricePortfolio);

  portfolioBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const index = deals.findIndex((deal) => deal.id === button.dataset.id);
    if (index < 0) return;
    if (button.dataset.action === "edit") editDeal(deals[index]);
    else if (button.dataset.action === "duplicate") {
      const duplicate = JSON.parse(JSON.stringify(deals[index]));
      duplicate.id = newId();
      duplicate.name = `${duplicate.name} copy`;
      duplicate.status = "unpriced";
      duplicate.result = undefined;
      duplicate.error = "";
      deals.splice(index + 1, 0, duplicate);
      persist();
      render();
    } else if (button.dataset.action === "remove") {
      deals.splice(index, 1);
      persist();
      render();
    }
  });

  worker.addEventListener("message", (event) => {
    const message = event.data;
    if (message.requestId !== requestId) return;
    if (message.type === "portfolio-progress") {
      batchStatus.textContent = `Pricing ${message.completed} of ${message.total} deals...`;
      return;
    }
    if (message.type !== "portfolio-result") return;
    const resultById = new Map(message.results.map((result) => [result.id, result]));
    deals = deals.map((deal) => {
      const priced = resultById.get(deal.id);
      if (!priced) return { ...deal, status: "error", error: "No result returned." };
      if (priced.status === "priced") return { ...deal, status: "priced", result: priced.result, error: "" };
      return { ...deal, status: "error", result: undefined, error: priced.error };
    });
    busy = false;
    document.querySelector("#portfolio-runtime").textContent = `${message.elapsedMs.toFixed(1)} ms`;
    const failures = deals.filter((deal) => deal.status === "error").length;
    batchStatus.textContent = failures
      ? `${deals.length - failures} deals priced; ${failures} failed validation.`
      : `All ${deals.length} deals priced locally.`;
    persist();
    render();
  });

  worker.addEventListener("error", () => {
    busy = false;
    deals = deals.map((deal) => deal.status === "pricing"
      ? { ...deal, status: "error", error: "The batch worker stopped unexpectedly." }
      : deal);
    batchStatus.textContent = "The batch pricing worker stopped unexpectedly.";
    render();
  });

  initializeProducts();
  restore();
  render();
  resetEditor();
}());
