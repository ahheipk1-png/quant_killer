(function () {
  "use strict";

  const report = document.querySelector("#payoff-report");
  const index = document.querySelector("#payoff-index");
  const summaryTitle = document.querySelector("#summary-title");
  const summaryNote = document.querySelector("#summary-note");
  const passedCount = document.querySelector("#passed-count");
  const totalCount = document.querySelector("#total-count");
  const payoffCount = document.querySelector("#payoff-count");
  const reportError = document.querySelector("#report-error");

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    if (Math.abs(value) < 1e-12) return "0";
    return Number(value.toPrecision(11)).toString();
  }

  function renderCase(row) {
    const tr = document.createElement("tr");
    const name = element("td", "case-name", row.name);
    const inputs = element("td", "case-inputs");
    inputs.appendChild(element("code", "input-code", JSON.stringify(row.inputs)));
    const expected = element("td", "numeric-cell", formatNumber(row.expected));
    const actual = element("td", "numeric-cell", formatNumber(row.actual));
    const status = element("td", "status-cell");
    status.appendChild(element(
      "span",
      `pass-badge${row.passed ? "" : " fail"}`,
      row.passed ? "PASS" : "FAIL",
    ));
    const rationale = element("td", "rationale-cell", row.error || row.rationale);
    tr.append(name, inputs, expected, actual, status, rationale);
    return tr;
  }

  function renderGroup(key, definition, rows, position) {
    const card = element("article", "panel payoff-card");
    card.id = `payoff-${key}`;

    const heading = element("header", "payoff-heading");
    const titleWrap = element("div", "payoff-title-wrap");
    titleWrap.appendChild(element("span", "payoff-number", String(position).padStart(2, "0")));
    const titleText = element("div");
    titleText.appendChild(element("p", "eyebrow", definition.kind || "Payoff unit"));
    titleText.appendChild(element("h2", "", definition.label));
    titleWrap.appendChild(titleText);
    const passed = rows.filter((row) => row.passed).length;
    heading.appendChild(titleWrap);
    heading.appendChild(element(
      "span",
      `group-status${passed === rows.length ? "" : " fail"}`,
      `${passed} / ${rows.length} passed`,
    ));
    card.appendChild(heading);

    const definitionBlock = element("div", "payoff-definition");
    const formula = element("p", "payoff-formula");
    formula.appendChild(element("span", "definition-label", definition.formulaLabel || "Payoff"));
    formula.appendChild(element("code", "", definition.formula));
    definitionBlock.appendChild(formula);
    definitionBlock.appendChild(element("p", "payoff-description", definition.description));
    card.appendChild(definitionBlock);

    const tableWrap = element("div", "table-wrap");
    const table = element("table", "benchmark-table payoff-table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Test case", "Inputs", "Expected", "Actual", "Result", "Why it makes sense"].forEach((label) => {
      headerRow.appendChild(element("th", "", label));
    });
    thead.appendChild(headerRow);
    const tbody = document.createElement("tbody");
    rows.forEach((row) => tbody.appendChild(renderCase(row)));
    table.append(thead, tbody);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);
    return card;
  }

  async function runReport() {
    try {
      if (!window.ExoticPricer) throw new Error("The local pricing engine did not load.");
      if (!window.AdvancedPricer) throw new Error("The advanced local pricing engine did not load.");
      if (!window.VolatilityModels) throw new Error("The volatility calibration engine did not load.");
      if (!window.PricingRegression) throw new Error("The pricing regression suite did not load.");
      summaryTitle.textContent = "Running payoff, calibration, and pricing regressions...";
      summaryNote.textContent = "The volatility fits, C++ WebAssembly duality checks, and JavaScript benchmark matrices are running locally.";

      const pricingTests = await window.PricingRegression.run();
      const definitions = {
        ...window.ExoticPricer.PAYOFF_DEFINITIONS,
        ...window.AdvancedPricer.ADVANCED_PAYOFF_DEFINITIONS,
        "volatility-calibration": window.VolatilityModels.VOLATILITY_TEST_DEFINITION,
        ...window.PricingRegression.DEFINITIONS,
      };
      const tests = [
        ...window.ExoticPricer.runPayoffUnitTests(),
        ...window.AdvancedPricer.runAdvancedPayoffUnitTests(),
        ...window.VolatilityModels.runVolatilityUnitTests(),
        ...pricingTests,
      ];
      const groups = Object.entries(definitions);
      const passed = tests.filter((row) => row.passed).length;

      passedCount.textContent = String(passed);
      totalCount.textContent = String(tests.length);
      payoffCount.textContent = String(groups.length);
      summaryTitle.textContent = passed === tests.length
        ? "All executable tests passed."
        : `${tests.length - passed} test${tests.length - passed === 1 ? "" : "s"} failed.`;
      summaryNote.textContent = passed === tests.length
        ? "Direct payoffs, volatility calibration, parity, duality, barrier reductions, and independent numerical methods are consistent within their stated tolerances."
        : "Review the failed rows below before relying on the affected payoff or pricing method.";
      document.documentElement.dataset.testState = passed === tests.length ? "passed" : "failed";

      groups.forEach(([key, definition], groupIndex) => {
        const rows = tests.filter((row) => row.product === key);
        const link = element("a", "", `${String(groupIndex + 1).padStart(2, "0")} ${definition.label}`);
        link.href = `#payoff-${key}`;
        index.appendChild(link);
        report.appendChild(renderGroup(key, definition, rows, groupIndex + 1));
      });
    } catch (error) {
      summaryTitle.textContent = "The executable tests could not run.";
      summaryNote.textContent = "Reload this page through the local server and try again.";
      reportError.textContent = error instanceof Error ? error.message : String(error);
      document.documentElement.dataset.testState = "failed";
    }
  }

  runReport();
}());
