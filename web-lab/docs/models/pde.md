# PDE and finite-difference methods

> Documentation status: synchronized with the 2,342-assertion PDE suite on 2026-08-04.

## One-factor solver

`web/exotic-pricer.js` contains a Black-Scholes Crank-Nicolson finite-difference solver used by:

- cash digitals,
- single knock-out barriers,
- double knock-out barriers,
- Bermudan vanilla options.

Knock-in values are obtained from vanilla minus knock-out value. Bermudan exercise is applied by projecting the continuation value to intrinsic value on configured exercise levels.

The shared grid can be uniform, strike-centered sinh, or spot-centered sinh. Unequal-spacing first/second derivative coefficients are used throughout. Digital and vanilla terminal values can use cell-average smoothing, and startup damping can replace initial Crank-Nicolson intervals with pairs of fully implicit half steps. Linear systems use the Thomas algorithm.

American vanilla adds three exercise-obstacle methods:

- projected Crank-Nicolson/operator splitting,
- PSOR for the linear-complementarity system,
- a semi-smooth active-set penalty solve.

Iteration counts and convergence state are returned in PDE diagnostics.

The focused suite covers uniform, strike-sinh, and spot-sinh grids; raw and
cell-averaged terminal data; 0/2/4 Rannacher intervals; invalid controls; and
breached-barrier boundary reductions. It currently contains 2,342 assertions
and 224 numerical matrix cases plus validation/integration checks.

## Current Asian ADI-style solver

`web/advanced-pricer.js` implements a two-state spot/running-sum grid for discrete arithmetic Asians. At fixing dates it applies a jump/interpolation operator that adds spot to the accumulated sum. Between fixings it advances independent running-sum slices with Crank-Nicolson spot solves.

Both spot and accumulated-sum axes use the selected uniform or sinh grid family. The running-sum axis clusters around the terminal payoff kink. Bilinear interpolation operates directly on unequal coordinates, and Rannacher damping can restart after fixing jumps. This remains a reference implementation intended for reductions and convergence comparisons.

## Coverage boundary

These PDE variants are implemented in the JavaScript reference engine. They are not yet duplicated in the C++, Rust, Python, and C# advanced engines, whose advanced-product route remains seeded Monte Carlo. The grid abstraction covers every currently PDE-enabled payoff; it does not turn arbitrary high-dimensional path payoffs into PDE products.

Prices and reductions are tested extensively, but a systematic Greek-convergence
harness, adaptive meshes, calibrated curve/surface injection, and independent
production validation remain roadmap work.

## Numerical references

- Forsyth, Vetzal, and collaborators discuss penalty/direct-control formulations and convergence for American options: <https://cs.uwaterloo.ca/~paforsyt/regime_american.pdf>
- Reisinger and Witte discuss policy iteration for American-option linear complementarity problems: <https://arxiv.org/abs/1012.4976>
- Bodeau, Riboulet, and Roncalli derive finite differences on nonuniform finance grids: <https://doi.org/10.2139/ssrn.1031941>
