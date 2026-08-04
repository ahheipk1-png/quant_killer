(function () {
  "use strict";

  const SAMPLE_QUOTES = `maturity,strike,iv,weight
0.25,80,0.310,0.7
0.25,90,0.270,1.0
0.25,100,0.235,1.4
0.25,110,0.220,1.0
0.25,120,0.215,0.7
0.50,80,0.290,0.7
0.50,90,0.255,1.0
0.50,100,0.225,1.4
0.50,110,0.212,1.0
0.50,120,0.210,0.7
1.00,80,0.270,0.7
1.00,90,0.245,1.0
1.00,100,0.220,1.4
1.00,110,0.210,1.0
1.00,120,0.208,0.7
2.00,80,0.250,0.7
2.00,90,0.235,1.0
2.00,100,0.215,1.4
2.00,110,0.208,1.0
2.00,120,0.207,0.7`;

  const form = document.querySelector("#volatility-form");
  const quotes = document.querySelector("#quotes");
  const status = document.querySelector("#engine-status");
  const errorNode = document.querySelector("#fit-error");
  const fitButton = document.querySelector("#fit-surface");
  const output = document.querySelector("#surface-output");
  const chartMaturity = document.querySelector("#chartMaturity");
  const chart = document.querySelector("#smile-chart");
  const fitMethod = document.querySelector("#fitMethod");
  const termMethod = document.querySelector("#termMethod");
  const termMethodHelp = document.querySelector("#term-method-help");
  let surface = null;

  function syncMethodControls() {
    const isCvi = fitMethod.value === "cvi";
    if (isCvi) termMethod.value = "linear-total-variance";
    termMethod.disabled = isCvi;
    termMethodHelp.textContent = isCvi
      ? "CVI fixes this to linear total variance so its joint-expiry constraints remain valid between quoted maturities."
      : "";
  }

  function number(id) {
    return Number(document.querySelector(`#${id}`).value);
  }

  function percent(value, digits = 3) {
    return Number.isFinite(value) ? `${(100 * value).toFixed(digits)}%` : "invalid";
  }

  function compact(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toPrecision(digits)).toString() : "-";
  }

  function cell(text, className = "") {
    const node = document.createElement("td");
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function marketInputs() {
    return {
      spot: number("spot"),
      rate: number("rate") / 100,
      dividendYield: number("dividendYield") / 100,
    };
  }

  function serializeParameters(parameters) {
    return JSON.stringify(parameters, (key, value) => {
      if (Array.isArray(value) && value.length > 8) return `[${value.length} values]`;
      if (typeof value === "number") return Number(value.toPrecision(7));
      return value;
    });
  }

  function renderParameters() {
    const body = document.querySelector("#parameter-table-body");
    body.replaceChildren();
    if (surface.globalFit) {
      const row = document.createElement("tr");
      row.append(cell("All"), cell(surface.method));
      row.append(cell(serializeParameters(surface.globalFit.parameters), "parameter-cell"));
      body.append(row);
      if (surface.globalFit.thetaNodes) {
        surface.globalFit.thetaNodes.forEach((node) => {
          const thetaRow = document.createElement("tr");
          thetaRow.append(cell(compact(node.maturity)), cell("SSVI theta"));
          thetaRow.append(cell(serializeParameters({ totalVariance: node.totalVariance }), "parameter-cell"));
          body.append(thetaRow);
        });
      }
      return;
    }
    surface.maturities.forEach((maturity) => {
      const fit = surface.sliceFits.get(maturity);
      const representation = surface.method === "natural-svi" ? fit.natural
        : surface.method === "svi-jw" ? fit.jumpWings : fit.parameters;
      const row = document.createElement("tr");
      row.append(cell(compact(maturity)), cell(surface.method));
      row.append(cell(serializeParameters(representation), "parameter-cell"));
      body.append(row);
    });
  }

  function renderFitRows() {
    const body = document.querySelector("#fit-table-body");
    body.replaceChildren();
    surface.fitRows.forEach((fit) => {
      const row = document.createElement("tr");
      row.append(
        cell(compact(fit.maturity)),
        cell(compact(fit.strike)),
        cell(percent(fit.impliedVolatility)),
        cell(percent(fit.fittedVolatility)),
        cell(percent(fit.residual), fit.residual < 0 ? "negative-residual" : ""),
      );
      body.append(row);
    });
  }

  function renderLocalGrid() {
    const body = document.querySelector("#local-vol-table-body");
    body.replaceChildren();
    const grid = VolatilityModels.buildLocalVolatilityGrid(surface, {
      logMoneyness: [-0.2, -0.1, 0, 0.1, 0.2],
    });
    grid.forEach((point) => {
      const implied = surface.volatility(point.maturity, point.strike);
      const row = document.createElement("tr");
      row.append(
        cell(compact(point.maturity)),
        cell(compact(point.logMoneyness)),
        cell(compact(point.strike)),
        cell(percent(implied)),
        cell(point.valid ? percent(point.volatility) : "-"),
        cell(compact(point.denominator)),
        cell(point.valid ? "valid" : "invalid", point.valid ? "status-good" : "status-bad"),
      );
      body.append(row);
    });
  }

  function drawChart() {
    if (!surface) return;
    const maturity = Number(chartMaturity.value);
    const marketRows = surface.fitRows.filter((row) => row.maturity === maturity);
    const minimumStrike = Math.min(...marketRows.map((row) => row.strike));
    const maximumStrike = Math.max(...marketRows.map((row) => row.strike));
    const modelRows = Array.from({ length: 81 }, (_, index) => {
      const strike = minimumStrike + (maximumStrike - minimumStrike) * index / 80;
      return { strike, volatility: surface.volatility(maturity, strike) };
    });
    const allVols = [...marketRows.map((row) => row.impliedVolatility),
      ...modelRows.map((row) => row.volatility)].filter(Number.isFinite);
    let minimumVol = Math.min(...allVols);
    let maximumVol = Math.max(...allVols);
    const padding = Math.max((maximumVol - minimumVol) * 0.15, 0.01);
    minimumVol -= padding;
    maximumVol += padding;

    const context = chart.getContext("2d");
    const width = chart.width;
    const height = chart.height;
    const margins = { left: 72, right: 28, top: 28, bottom: 58 };
    const x = (strike) => margins.left + (strike - minimumStrike) /
      (maximumStrike - minimumStrike) * (width - margins.left - margins.right);
    const y = (volatility) => height - margins.bottom - (volatility - minimumVol) /
      (maximumVol - minimumVol) * (height - margins.top - margins.bottom);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "#29425e";
    context.fillStyle = "#9db0c5";
    context.font = "13px Inter, system-ui, sans-serif";
    context.lineWidth = 1;
    for (let tick = 0; tick <= 5; tick += 1) {
      const value = minimumVol + (maximumVol - minimumVol) * tick / 5;
      const position = y(value);
      context.beginPath();
      context.moveTo(margins.left, position);
      context.lineTo(width - margins.right, position);
      context.stroke();
      context.fillText(percent(value, 1), 12, position + 4);
    }
    for (let tick = 0; tick <= 5; tick += 1) {
      const value = minimumStrike + (maximumStrike - minimumStrike) * tick / 5;
      context.fillText(compact(value, 5), x(value) - 15, height - 24);
    }
    context.strokeStyle = "#5ee1c2";
    context.lineWidth = 3;
    context.beginPath();
    modelRows.forEach((point, index) => {
      if (index === 0) context.moveTo(x(point.strike), y(point.volatility));
      else context.lineTo(x(point.strike), y(point.volatility));
    });
    context.stroke();
    context.fillStyle = "#ffd166";
    marketRows.forEach((point) => {
      context.beginPath();
      context.arc(x(point.strike), y(point.impliedVolatility), 5.5, 0, 2 * Math.PI);
      context.fill();
    });
    context.fillStyle = "#9db0c5";
    context.fillText("Strike", width / 2 - 16, height - 8);
    context.fillStyle = "#5ee1c2";
    context.fillText("fitted", width - 145, 24);
    context.fillStyle = "#ffd166";
    context.fillText("market", width - 82, 24);
  }

  function renderSummary() {
    const maturity = number("targetMaturity");
    const strike = number("targetStrike");
    const implied = surface.volatility(maturity, strike);
    const local = VolatilityModels.dupireLocalVolatility(surface, maturity, strike);
    document.querySelector("#target-volatility").textContent = percent(implied, 3);
    document.querySelector("#target-label").textContent =
      `Model IV at T=${compact(maturity)}y and K=${compact(strike)}`;
    document.querySelector("#fit-rmse").textContent = percent(surface.rmse, 4);
    document.querySelector("#fit-max-error").textContent = percent(surface.maximumError, 4);
    document.querySelector("#target-local-vol").textContent = local.valid ? percent(local.volatility, 3) : "invalid";
    document.querySelector("#butterfly-count").textContent =
      `${surface.diagnostics.butterflyViolations} / ${surface.diagnostics.sampleCount}`;
    document.querySelector("#calendar-count").textContent =
      `${surface.diagnostics.calendarViolations} / ${surface.diagnostics.sampleCount}`;
    document.querySelector("#surface-shape").textContent =
      `${surface.quotes.length} / ${surface.maturities.length}`;
  }

  function fitSurface() {
    errorNode.textContent = "";
    fitButton.disabled = true;
    status.dataset.state = "working";
    status.textContent = "Calibrating volatility surface...";
    try {
      const market = marketInputs();
      surface = VolatilityModels.calibrateSurface(quotes.value, {
        ...market,
        method: fitMethod.value,
        termMethod: termMethod.value,
        sabrBeta: number("sabrBeta"),
        cviKnots: number("cviKnots"),
        cviRegularization: number("cviRegularization"),
        cviIterations: 5,
        cviButterflyPoints: 41,
        repairCalendar: document.querySelector("#repairCalendar").checked,
        diagnosticOptions: { strikeSamples: 41, maturitySamples: 8 },
      });
      chartMaturity.replaceChildren();
      surface.maturities.forEach((maturity) => {
        const option = document.createElement("option");
        option.value = String(maturity);
        option.textContent = `${compact(maturity)} years`;
        if (Math.abs(maturity - number("targetMaturity")) === Math.min(
          ...surface.maturities.map((candidate) => Math.abs(candidate - number("targetMaturity"))),
        )) option.selected = true;
        chartMaturity.append(option);
      });
      renderSummary();
      renderFitRows();
      renderParameters();
      renderLocalGrid();
      drawChart();
      output.hidden = false;
      status.dataset.state = "ready";
      status.textContent = `${VolatilityModels.FIT_METHODS[surface.method]} calibrated locally`;
    } catch (error) {
      surface = null;
      output.hidden = true;
      errorNode.textContent = error instanceof Error ? error.message : String(error);
      status.dataset.state = "error";
      status.textContent = "Calibration failed";
    } finally {
      fitButton.disabled = false;
    }
  }

  function calibrateSlv() {
    const button = document.querySelector("#calibrate-slv");
    const slvStatus = document.querySelector("#slv-status");
    if (!surface) {
      slvStatus.textContent = "Fit a volatility surface first.";
      return;
    }
    button.disabled = true;
    slvStatus.textContent = "Running seeded particles and conditional-variance estimates...";
    try {
      const horizon = surface.maturities.at(-1);
      const result = VolatilityModels.calibrateSlvLeverage((time, spot) => {
        const safeTime = Math.max(time, Math.min(surface.maturities[0] * 0.5, 0.01));
        const local = VolatilityModels.dupireLocalVolatility(surface, safeTime, spot);
        if (!local.valid) throw new Error(`Invalid local volatility at t=${safeTime}, S=${spot}.`);
        return local.volatility;
      }, {
        ...marketInputs(), maturity: horizon,
        particles: number("slvParticles"), timeSteps: number("slvSteps"), seed: 99173,
        kappa: number("hestonKappa"), theta: number("hestonTheta"),
        initialVariance: number("hestonTheta"), volOfVol: number("hestonVolOfVol"),
        rho: number("hestonRho"), damping: 0.65,
      });
      const body = document.querySelector("#slv-table-body");
      body.replaceChildren();
      const lastLeverage = result.leverage.at(-1);
      const lastVariance = result.conditionalVariance.at(-1);
      result.logMoneyness.forEach((k, index) => {
        const conditionalVol = Math.sqrt(lastVariance[index]);
        const row = document.createElement("tr");
        row.append(
          cell(compact(k)),
          cell(percent(conditionalVol)),
          cell(compact(lastLeverage[index])),
          cell(percent(conditionalVol * lastLeverage[index])),
        );
        body.append(row);
      });
      document.querySelector("#slv-output").hidden = false;
      slvStatus.textContent = `${result.particles.toLocaleString()} particles, ${result.timeSteps} steps; ` +
        `maximum final calibration residual ${percent(result.reproductionErrors.at(-1), 4)}.`;
    } catch (error) {
      document.querySelector("#slv-output").hidden = true;
      slvStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    setTimeout(fitSurface, 0);
  });
  document.querySelector("#restore-sample").addEventListener("click", () => {
    quotes.value = SAMPLE_QUOTES;
    fitSurface();
  });
  document.querySelector("#calibrate-slv").addEventListener("click", () => setTimeout(calibrateSlv, 0));
  chartMaturity.addEventListener("change", drawChart);
  fitMethod.addEventListener("change", syncMethodControls);
  ["targetMaturity", "targetStrike"].forEach((id) => document.querySelector(`#${id}`)
    .addEventListener("change", () => { if (surface) renderSummary(); }));

  quotes.value = SAMPLE_QUOTES;
  syncMethodControls();
  window.addEventListener("load", () => setTimeout(fitSurface, 0));
}());
