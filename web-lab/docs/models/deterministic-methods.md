# Deterministic pricing methods

> Documentation status: synchronized with the current formulas, trees, and approximation tests on 2026-08-04.

## Black-Scholes

European calls and puts use the standard Black-Scholes formula with continuous dividend yield. Cash-or-nothing digitals use the corresponding discounted probability. The formula is also a reduction target for barriers, one-date Bermudans, single-fixing path payoffs, and zero-strike compound options.

## CRR trees

The Cox-Ross-Rubinstein lattice supports European and American vanilla options. The exotic reference engine also uses a recombining tree for Bermudan options, projecting to intrinsic value only on scheduled exercise dates.

Trees are useful independent references because their state evolution differs from formula, PDE, and simulation implementations.

## American approximations

The vanilla lab implements:

- Barone-Adesi-Whaley quadratic early-exercise-premium approximation.
- Ju-Zhong (1999) quadratic approximation.
- Peter Carr (1998) Erlang maturity randomization with two-level Richardson extrapolation.
- Bjerksund-Stensland (1993) one-boundary approximation.
- Bjerksund-Stensland (2002) two-boundary approximation.
- CRR with an exercise decision at every node.

These are distinct American methods. Ju-Zhong is the American approximation; the separate Ju Asian method described below is not the same model.

The vanilla C++, Rust, Python, and C# implementations expose these six methods.
The three American PDE variants below are currently JavaScript-reference methods.

The JavaScript reference engine additionally provides projected Crank-Nicolson, PSOR complementarity, and penalty complementarity finite-difference methods for American vanilla options.

## Barrier and compound formulas

- Single continuously monitored barriers use a Reiner-Rubinstein-style closed-form construction.
- Double barriers use an absorbing-boundary spectral series.
- Compound options use a generalized Geske construction covering call-on-call, put-on-call, call-on-put, and put-on-put.

Barrier knock-in values are checked using in/out parity against the matching vanilla option.

## Asian approximations

For discrete arithmetic averages under constant Black-Scholes volatility:

- Levy matches the first two moments with a lognormal approximation.
- Shifted lognormal uses three moments.
- Curran conditions on the geometric average.
- Curran two-moment adds a conditional moment fit.

The two Curran variants are derived step by step in
[curran-derivation.md](curran-derivation.md), including the point that their
"one-moment"/"two-moment" labels count *conditional* moments used inside the
quadrature, and are unrelated to the moment counts in Levy and shifted
lognormal above.
- Ju's method applies the implemented characteristic-function/Taylor correction through volatility order six.

The schedules may be uneven and can include the initial fixing. Positive-weight effective baskets are supported by the JavaScript reference calculations where documented by the tests.

The browser date helper supplies ACT/365F year fractions and weekend adjustment
only. Holiday centers, settlement calendars, discrete dividends, and full market
day-count conventions are outside the current reference implementation.

## Static variance replication

The variance-swap reference method numerically integrates a strip of out-of-the-money Black-Scholes calls and puts across log strike. It is a constant/term-variance reference, not a calibration engine and not a static replication of volatility swaps or options on realized variance.

Deterministic methods should be preferred as independent anchors only when their
monitoring, dividend, curve, settlement, and exercise conventions match the
contract being compared.
