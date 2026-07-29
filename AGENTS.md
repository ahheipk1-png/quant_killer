# QuantKiller — Instructions for AI agents

QuantKiller is a polyglot derivatives-pricing library: the **same models, implemented five times**
(Python, C++, C#, Java, Rust), all proven numerically identical by shared golden test vectors,
plus an Excel-DNA add-in and a documentation website with math derivations.

## Project map

| Path | What it is |
|------|-----------|
| `contracts/` | **Source of truth.** JSON schemas, the RNG/number spec, golden test vectors |
| `python/` | Reference implementation (stdlib-only), vector generator lives here |
| `cpp/` | C++17, CMake; builds static lib + `quantkiller.dll` (C ABI) + CLI |
| `rust/` | Cargo workspace: `quantkiller` (core, no deps) + `quantkiller-ffi` (cdylib) + `quantkiller-cli` |
| `csharp/` | `QuantKiller.Core` (netstandard2.0) + CLI + xUnit tests (net8.0) |
| `java/` | Maven, Java 21, JUnit 5; FFI via JNA |
| `excel/` | Excel-DNA add-in → `QuantKiller-AddIn.xll` |
| `docs/` | MkDocs Material site (KaTeX math), deployed to GitHub Pages |
| `scripts/` | `setup-toolchains.ps1`, `test-all.ps1`, vector regeneration |

Each language folder has its own `BUILD.md` (humans) and `AGENTS.md` (you) with exact commands.

## Golden rules — read before changing anything

1. **`contracts/` is the single source of truth.** Never hand-edit files in
   `contracts/vectors/`. They are generated from the Python reference implementation by
   `python/gen_vectors.py` and cross-checked against published textbook values.
   To change expected numbers: fix the Python reference, regenerate, and then make every other
   language pass again.
2. **The RNG spec is frozen** (`contracts/rng-spec.md`): PCG32 + (0,1) uniform mapping +
   Acklam inverse-normal CDF + Cody-style erf for `norm_cdf`. All five languages implement it
   byte-for-byte the same. Changing any of it invalidates every Monte Carlo vector — don't,
   unless the change is applied to all languages and vectors are regenerated in the same PR.
3. **A model is "done" only when all of these exist** (Definition of Done):
   - implemented in all 5 languages with the same parameter names and conventions
   - passes the shared vectors in every language (`scripts/test-all.ps1`)
   - has a derivation page in `docs/models/`
   - is callable from every CLI (`quantkiller price --json`)
   - has an Excel function in `excel/`
4. **Never let one language drift.** If you add a parameter or rename a field, update all five
   implementations, the JSON schema in `contracts/schema/`, the Excel add-in, and the docs in
   the same change.
5. **Keep the code teachable.** Core numerics are dependency-free in every language (no numpy,
   no Boost, no Apache Commons Math). Prefer clarity over micro-optimization; comment the math
   with references to the derivation pages, not the mechanics of the code.

## Numeric conventions (used everywhere)

- Rates are **continuously compounded**, times in **year fractions**, volatility annualized.
- Parameter names (JSON + all languages): `spot`, `strike`, `rate`, `div_yield`, `vol`, `time`,
  `option_type` ("call"/"put"), `style` ("european"/"american"), `steps`, `paths`, `seed`.
- Greeks: `theta` is per year (divide by 365 for per-day), `vega` and `rho` are per unit
  (multiply by 0.01 for per-1%).
- Edge cases are specified in `contracts/schema/` docs: `time == 0` → intrinsic value;
  `vol == 0` → discounted forward intrinsic.
- Tolerances vs vectors: closed-form 1e-10 relative, trees/finite-difference 1e-12,
  Monte Carlo / quadrature 1e-9.

## Build & test quickstart (Windows; see per-language AGENTS.md for detail)

```powershell
# everything at once
powershell -File scripts/test-all.ps1

# individually
cd python;  python -m pytest                                  # Python 3.12+
cd cpp;     cmake -B build && cmake --build build && ctest --test-dir build
cd rust;    cargo test
cd csharp;  dotnet test
cd java;    mvn -q test
cd excel;   dotnet build                                      # produces the .xll
cd docs;    mkdocs serve                                      # local site preview
```

## Commit conventions

- Conventional-commit style prefixes: `feat(model):`, `fix(cpp):`, `docs(site):`, `ci:`, `test:`.
- One model or one concern per commit. A model PR touches all 5 languages + vectors + docs.
- CI (`.github/workflows/ci.yml`) must be green: it runs every language's tests on Windows +
  Ubuntu and a cross-language parity job that diffs CLI outputs.

## Things that look like bugs but aren't

- `python` on this dev machine may resolve to the Microsoft Store stub. Use the real
  interpreter (see `python/BUILD.md` troubleshooting) or `py -3.12`.
- MC prices differ from the closed form by ~the reported standard error — that's sampling
  error, not a bug. Cross-language MC results, however, must match to 1e-9 with the same seed.
- American binomial prices are slightly above European ones for puts (early exercise premium) —
  expected.
