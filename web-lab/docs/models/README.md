# Model and method map

> Documentation status: synchronized with the current method dispatch and tests on 2026-08-04.

The library separates the payoff definition from the numerical method whenever practical. A method is offered only where the current implementation supports that combination.

## Method families

| Family | Implementations |
|---|---|
| Closed/semi-closed | Black-Scholes, cash digital, Reiner-Rubinstein barrier, double-barrier spectral series, generalized Geske compound |
| Early exercise | CRR, Barone-Adesi-Whaley, Ju-Zhong, Carr randomization, Bjerksund-Stensland 1993 and 2002, Bermudan tree/LSMC |
| Asian approximation | Levy, shifted lognormal, Curran, Curran two-moment, Ju order-six expansion |
| PDE | One-factor Crank-Nicolson for digital/barrier/double-barrier/Bermudan; projected/PSOR/penalty American variants; two-state fixing-jump ADI-style Asian solver |
| Simulation | PCG Monte Carlo, deterministic Sobol QMC, digitally shifted Sobol QMC |
| Replication | Static OTM option strip for a variance swap under Black-Scholes |
| Volatility calibration | IV inversion; SVI raw/natural/jump-wings; SSVI; SABR; Vanna-Volga; PCHIP variance; Dumas; CVI variance-spline QP with constrained linear-total-variance maturity interpolation; separate convex-call interpolation; Dupire local vol/forward-PDE round trip; particle SLV leverage |

## Selecting a method

- Prefer an implemented closed form for a standard constant-volatility contract.
- Use a tree for transparent discrete or continuous early-exercise decisions.
- Use PDE for one-factor products when boundary behavior and convergence can be controlled.
- Use MC for high-dimensional, path-dependent, basket, Heston, and SLV products.
- Use QMC for deterministic convergence studies; randomized QMC is required if a sampling-based error estimate is desired.
- Always test a complex contract against a simpler reduction and, where possible, an independent method.
- Treat PCHIP and convex-call interpolation diagnostics according to their actual representation; exact nodal reproduction is not the same as a continuously arbitrage-free implied-volatility surface.

See [volatility interpolation and calibration](volatility-calibration.md) for parameterizations, diagnostics, limitations, and source references.

## Important implementation boundary

The JavaScript reference engine has broader formula and PDE coverage. The advanced C++, Rust, Python, and C# engines currently share the seeded Monte Carlo contract. “Available in the project” does not automatically mean “implemented in every language.” See [validation](../testing/validation.md) for the exact claims.

The dedicated conformance page verifies eight selected compiled-engine MC cases
at eight-decimal public serialization. It does not certify every method, payoff,
parameter combination, or internal floating-point operation.
