importScripts("exotic-pricer.js?v=16", "advanced-pricer.js?v=14");

self.addEventListener("message", (event) => {
  if (event.data?.type !== "price-portfolio") return;
  const { requestId, deals } = event.data;
  const results = [];
  const started = performance.now();
  for (let index = 0; index < deals.length; index += 1) {
    const deal = deals[index];
    try {
      let result;
      if (deal.config.product === "vanilla") {
        if (deal.method === "closed-form") {
          const config = AdvancedPricer.normalizeConfig({ ...deal.config, product: "lookback" });
          result = {
            price: ExoticPricer.blackScholes(config),
            standardError: null,
            standardDeviation: null,
            samples: 0,
            elapsedMs: 0,
          };
        } else {
          const config = AdvancedPricer.normalizeConfig({
            ...deal.config,
            product: "lookback",
            monitoringSteps: 1,
            observationTimes: [deal.config.maturity],
          });
          const startedDeal = performance.now();
          result = AdvancedPricer.monteCarloPrice(config, deal.method);
          result.elapsedMs = performance.now() - startedDeal;
        }
      } else {
        result = AdvancedPricer.price(deal.config, deal.method);
      }
      results.push({ id: deal.id, status: "priced", result });
    } catch (error) {
      results.push({
        id: deal.id,
        status: "error",
        error: error?.message || String(error),
      });
    }
    self.postMessage({
      type: "portfolio-progress",
      requestId,
      completed: index + 1,
      total: deals.length,
    });
  }
  self.postMessage({
    type: "portfolio-result",
    requestId,
    results,
    elapsedMs: performance.now() - started,
  });
});
