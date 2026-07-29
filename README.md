# QuantKiller

**One derivatives-pricing library. Five languages. Identical numbers. Free forever.**

QuantKiller's mission is to make standard derivatives pricing a **commodity**: a free, open,
verified implementation of every well-known model in **Python, C++, C#, Java, and Rust** — plus
Excel — so that no desk, fund, vendor, or student ever has to pay for (or rebuild) the same
models again. Every implementation produces numerically identical results, verified against a
single shared set of golden test vectors.

Pricing a vanilla, a barrier, an Asian, or a Heston smile is solved mathematics. QuantKiller
treats it that way: transparent code in whatever language your stack speaks, with the full
derivation of every formula published alongside it — pitched so that anyone with
2nd-year-undergraduate math can verify every line rather than trust a black box.

## What's inside

| Tier | Models |
|------|--------|
| **A — Foundations** | Forwards/futures (cost of carry) · Put–call parity · CRR binomial tree (European + American) · Black–Scholes–Merton + Greeks · Monte Carlo under GBM · Implied volatility |
| **B — Exotics & numerics** | Digital options · Barrier options (Reiner–Rubinstein) · Asian options (Kemna–Vorst + MC) · Trinomial tree · Finite differences (explicit / implicit / Crank–Nicolson) |
| **C — Advanced** | Heston stochastic volatility · Longstaff–Schwartz American MC · Vasicek bonds · Hull–White bonds |

Every model ships with:

- Implementations in all five languages (`python/`, `cpp/`, `csharp/`, `java/`, `rust/`)
- Shared golden test vectors (`contracts/vectors/`) that every language must pass
- A step-by-step **math derivation page** on the website, understandable with year-2 calculus,
  linear algebra, and intro probability
- An **Excel function** (`=QK.BS(...)`, `=QK.BINOMIAL(...)`, …) via the Excel-DNA add-in
- A JSON CLI so any language can be driven from anywhere

## Interchangeable engines

Every language exposes the same `Engine` idea with three interchangeable implementations:

1. **Native** — that language's own implementation.
2. **CLI bridge** — call *any other* language by spawning its CLI and speaking a shared JSON
   protocol (`contracts/schema/`). Python can price on the Java engine, C# on the Python engine, …
3. **FFI** — the C++ and Rust cores compile to DLLs with a C ABI, callable in-process from
   Python (ctypes), C# (P/Invoke), and Java (JNA). Excel can route through them too.

Swapping engines is one line. The cross-language test matrix proves they all agree.

## Determinism across languages

Monte Carlo results match across all five languages because the RNG itself is part of the spec:
**PCG32** plus the **Acklam inverse-normal CDF**, implemented identically everywhere
(see [contracts/rng-spec.md](contracts/rng-spec.md)). Same seed ⇒ same paths ⇒ same price, in any language.

## Getting started

- **Install everything** (Windows): run `scripts/setup-toolchains.ps1`, or see [INSTALL.md](INSTALL.md)
- **Build one language**: each language folder has a detailed `BUILD.md`
  ([python](python/BUILD.md) · [cpp](cpp/BUILD.md) · [csharp](csharp/BUILD.md) ·
  [java](java/BUILD.md) · [rust](rust/BUILD.md) · [excel](excel/BUILD.md))
- **Website** (derivations + downloads): see the Releases page and the project website

## License & disclaimer

QuantKiller is free software under the [MIT license](LICENSE) — use it anywhere, including
commercially. It comes with no warranty of any kind, and nothing in this project is investment
advice. Validate independently before relying on any number it produces.
