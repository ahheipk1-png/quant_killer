# QuantKiller

**One derivatives-pricing library. Five languages. Identical numbers. Free forever.**

QuantKiller's mission is to make standard derivatives pricing a **commodity**: a free, open,
verified implementation of every well-known model in **Python, C++, C#, and Rust** — plus
Excel — so that no desk, fund, vendor, or student ever has to pay for (or rebuild) the same
models again. Every implementation produces numerically identical results, verified against a
single shared set of golden test vectors.

There's also [web-lab/](web-lab/) — a separate, zero-install browser lab (Python/C++/Rust/C#
compiled to WebAssembly, plus a broader JavaScript reference engine) that lets anyone verify
the cross-language consistency claim live, with no local installation at all. It's a
complementary product, not a duplicate: this repo's `python/cpp/rust/csharp/` trees are
installable libraries + Excel add-ins; `web-lab/` is a browser demo. See its own
[docs/HANDOFF.md](web-lab/docs/HANDOFF.md) for what it currently proves.

Pricing a vanilla, a barrier, an Asian, or a Heston smile is solved mathematics. QuantKiller
treats it that way: transparent code in whatever language your stack speaks, with the full
derivation of every formula published alongside it — pitched so that anyone with
2nd-year-undergraduate math can verify every line rather than trust a black box.

## What's inside

| Tier | Models |
|------|--------|
| **A — Foundations** | Forwards/futures (cost of carry) · Put–call parity · CRR binomial tree (European + American) · Black–Scholes–Merton + Greeks · Monte Carlo under GBM · Implied volatility |
| **American exercise** | Barone-Adesi-Whaley · Ju-Zhong · Bjerksund-Stensland 1993 & 2002 · Carr randomization (PSOR finite-difference) — five independent approximations, cross-checked against each other and the CRR tree |
| **B — Exotics & numerics** | Digital options · Barrier options (Reiner–Rubinstein) · Asian options (Kemna–Vorst + MC) · Trinomial tree · Finite differences (explicit / implicit / Crank–Nicolson) |
| **C — Advanced** | Heston stochastic volatility · Longstaff–Schwartz American MC · Vasicek bonds · Hull–White bonds |

Tiers B and C are planned, not yet built in the native library — see `contracts/vectors/` for
what's currently generated and verified. `web-lab/` (the browser lab) already has substantially
broader coverage: 20 exotic payoff families, PDE solvers, and a full volatility-calibration
suite — see its own docs for what it proves today.

Every model ships with:

- Implementations in all four native languages (`python/`, `cpp/`, `csharp/`, `rust/`)
- Shared golden test vectors (`contracts/vectors/`) that every language must pass
- A step-by-step **math derivation page** on the website, understandable with year-2 calculus,
  linear algebra, and intro probability
- An **Excel function** (`=QK.BS(...)`, `=QK.BINOMIAL(...)`, …) via the Excel-DNA add-in
- A JSON CLI so any language can be driven from anywhere

## Interchangeable engines

Every language exposes the same `Engine` idea, and Python can reach every other language
(CLI bridge or `ctypes` FFI once Phase 3 lands); C++/Rust/C# will reach each other directly via
FFI. Today, the proven cross-language link is the **shared golden vectors**: every language's
test suite loads `contracts/vectors/*.json` (generated from the Python reference) and checks
its own output against it. Currently 41 cases × 4 languages, all passing.

## Determinism across languages

Monte Carlo results match across languages because the RNG itself is part of the spec:
**PCG32** plus the **Acklam inverse-normal CDF**, implemented identically everywhere
(see [contracts/rng-spec.md](contracts/rng-spec.md)). Same seed ⇒ same paths ⇒ same price, in any language.

## Getting started

- **Install everything** (Windows): run `scripts/setup-toolchains.ps1`, or see [INSTALL.md](INSTALL.md)
- **Run the tests**: `python -m pytest` (in `python/`), `dotnet test` (in `csharp/`),
  `cargo test --workspace` (in `rust/`), `cmake -B build && cmake --build build && ctest --test-dir build`
  (in `cpp/`) — per-language `BUILD.md` files are still to be written (tracked, not yet done)
- **Browser lab**: `web-lab/serve.ps1` (or `python web-lab/serve.py`), then open `web-lab/web/index.html`
  through the local server — see [web-lab/docs/development/build-and-run.md](web-lab/docs/development/build-and-run.md)
- **Website** (derivations + downloads): planned, not yet built (Phase 7)

## License & disclaimer

QuantKiller is free software under the [MIT license](LICENSE) — use it anywhere, including
commercially. It comes with no warranty of any kind, and nothing in this project is investment
advice. Validate independently before relying on any number it produces.
