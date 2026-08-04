# QuantKiller documentation map

> Documentation status: synchronized on 2026-08-04; verification dates are recorded in `testing/validation.md`.

This folder is the maintained documentation set for the local QuantKiller browser pricer.
Start here when you need to understand the project rather than one specific source file.

The documentation set contains 25 Markdown files. Capability claims are tied to
the 2026-08-03 complete Node/browser verification and the focused 2026-08-04
claim checks recorded in [validation](testing/validation.md); future changes
should update the owning document and the handoff together.

## Documentation tree

```text
docs/
|-- README.md                         This map and reading routes
|-- HANDOFF.md                        Operational handoff for another AI agent
|-- roadmap.md                        Known limitations and requested next work
|-- project/
|   |-- overview.md                   Scope, capabilities, and design principles
|   |-- architecture.md               Browser, worker, engine, and contract layers
|   `-- review-2026-08-03.md          Whole-project audit and prioritized recommendations
|-- interface/
|   |-- pages.md                      Every browser page and its workflow
|   `-- deal-configuration.md         Shared inputs and product-specific parameters
|-- models/
|   |-- README.md                     Model and method selection map
|   |-- deterministic-methods.md      Formulas, trees, American and Asian approximations
|   |-- simulation.md                 PCG Monte Carlo, Sobol QMC, errors, and LSMC
|   |-- volatility-and-baskets.md     Volatility dynamics and effective underlyings
|   |-- volatility-calibration.md     IV inversion, smile/surface fits, Dupire, and SLV
|   `-- pde.md                        Current finite-difference and Asian ADI implementations
|-- payoffs/
|   |-- README.md                     Payoff family index and reduction map
|   |-- vanilla-and-exercise.md       Vanilla, American, and Bermudan
|   |-- barriers-and-digitals.md      Digital and single/double barriers
|   |-- path-dependent.md             Asian, lookback, ladder, and accumulator
|   |-- multi-asset-and-compound.md   Rainbow, Himalayan, baskets, compound options
|   |-- structured-products.md        Autocallable, Phoenix, and yield seeker
|   `-- realized-volatility.md        Variance/volatility swaps and options
|-- testing/
|   `-- validation.md                 Test suites, invariants, tolerances, and commands
`-- development/
    |-- build-and-run.md               Local serving, rebuilds, and generated assets
    `-- extension-guide.md             Where and how to add products and methods
```

## Suggested reading routes

- New user: [project overview](project/overview.md), then [interface pages](interface/pages.md).
- Quant developer: [model map](models/README.md), [payoff map](payoffs/README.md), then [validation](testing/validation.md).
- Code contributor: [architecture](project/architecture.md), [build and run](development/build-and-run.md), then [extension guide](development/extension-guide.md).
- Project owner: [whole-project review](project/review-2026-08-03.md), then [roadmap](roadmap.md).
- AI agent taking over: [HANDOFF.md](HANDOFF.md) first, followed by [roadmap.md](roadmap.md).

## Documentation rules

- “Implemented” means a callable execution path exists in the current source.
- “Validated” means an automated test currently exercises the stated behavior.
- “Production-ready” is not implied by either term; see the [project review](project/review-2026-08-03.md).
- JavaScript reference methods and the four compiled-language engines are distinguished explicitly.
- Planned features are documented only in `roadmap.md` and `HANDOFF.md`; they are not presented as production capabilities.
