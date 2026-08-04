const fs = require("node:fs");
const path = require("node:path");
const base = require("./web/exotic-pricer.js");
const advanced = require("./web/advanced-pricer.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function priceDeal(deal) {
  if (deal.config.product !== "vanilla") return advanced.price(deal.config, deal.method);
  if (deal.method === "closed-form") {
    const config = advanced.normalizeConfig({ ...deal.config, product: "lookback" });
    return { price: base.blackScholes(config), standardError: null };
  }
  const config = advanced.normalizeConfig({
    ...deal.config,
    product: "lookback",
    monitoringSteps: 1,
    observationTimes: [deal.config.maturity],
  });
  return advanced.monteCarloPrice(config, deal.method);
}

const common = {
  optionType: "call",
  spot: 100,
  strike: 100,
  maturity: 1,
  rate: 0.05,
  dividendYield: 0,
  volatility: 0.2,
  paths: 4096,
  seed: 42,
  decisionTime: 0.5,
};

const deals = [
  { name: "Vanilla", quantity: 250, method: "closed-form", config: { ...common, product: "vanilla" } },
  { name: "Barrier hedge", quantity: -80, method: "closed-form", config: {
    ...common, product: "barrier", optionType: "put", strike: 105, maturity: 1.5,
    barrier: 70, barrierDirection: "down", barrierStyle: "out",
  } },
  { name: "Bermudan", quantity: 120, method: "tree", config: {
    ...common, product: "bermudan", optionType: "put", exerciseDates: 4, treeSteps: 400,
  } },
  { name: "Asian", quantity: 175, method: "ju-taylor", config: {
    ...common, product: "asian", strike: 102,
    observationTimes: [0.08, 0.21, 0.43, 0.68, 1], includeInitialFixing: true,
  } },
  { name: "Phoenix", quantity: 10, method: "qmc", config: {
    ...common, product: "phoenix-autocall", monitoringSteps: 4,
    notional: 100, coupon: 0.02, couponBarrier: 0.7,
    autocallBarrier: 1, protectionBarrier: 0.7,
  } },
];

const results = deals.map((deal) => priceDeal(deal));
results.forEach((result, index) => {
  assert(Number.isFinite(result.price), `${deals[index].name} did not return a finite price`);
});
const total = results.reduce((sum, result, index) => sum + result.price * deals[index].quantity, 0);
assert(Number.isFinite(total), "Portfolio total must be finite");

const html = fs.readFileSync(path.join(__dirname, "web", "portfolio.html"), "utf8");
for (const required of ["deal-form", "portfolio-body", "price-portfolio", "export-csv", "portfolio.js?v=3"]) {
  assert(html.includes(required), `Portfolio page is missing ${required}`);
}
for (const page of ["index.html", "exotics.html", "path-lab.html", "payoff-tests.html", "polyglot-conformance.html"]) {
  const source = fs.readFileSync(path.join(__dirname, "web", page), "utf8");
  assert(source.includes('href="portfolio.html"'), `${page} is missing the portfolio navigation link`);
}

console.log(`Portfolio test passed: ${deals.length} deals, aggregate PV ${total.toFixed(8)}`);
