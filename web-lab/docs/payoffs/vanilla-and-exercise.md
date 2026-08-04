# Vanilla, American, and Bermudan payoffs

> Documentation status: synchronized with the current exercise-method and duality tests on 2026-08-04.

## European vanilla

```text
max(phi * (S(T) - K), 0)
```

European exercise occurs only at maturity. It is the central reduction target throughout the library.

## American vanilla

At every permissible exercise time, value is the maximum of intrinsic value and continuation value:

```text
V(S,t) = max(max(phi * (S-K), 0), continuation(S,t))
```

The vanilla lab offers CRR and five semi-closed/transform approximations. The JavaScript reference engine in the Exotic Lab additionally offers projected, PSOR, and penalty American PDE methods.

Key checks:

- American value must be at least intrinsic value.
- American value must be at least the matching European value.
- A non-dividend-paying American call should reduce to the European call under the usual non-negative-rate assumptions.
- Call-put duality is tested across the six current American implementations.

The regression matrix contains 24 American duality cases across CRR,
Barone-Adesi-Whaley, Ju-Zhong, Carr randomization, and Bjerksund-Stensland
1993/2002. This tests the implemented convention and parameter grid; it is not a
universal proof of approximation accuracy.

## Bermudan

Bermudan exercise is allowed only on a finite schedule. At an exercise date:

```text
V = max(intrinsic, continuation)
```

Between exercise dates only continuation remains. The reference implementations include a scheduled CRR tree, scheduled projection in the PDE, and Longstaff-Schwartz MC/QMC.

Reductions:

- one maturity exercise date → European option;
- increasingly frequent exercise opportunities approach an American option.

The current LSMC continuation basis is fixed to quadratic monomials. User
selection of basis family and degree remains pending.
