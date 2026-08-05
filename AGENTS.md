# QuantKiller — Instructions for AI agents

QuantKiller is a polyglot derivatives-pricing library: the **same models, implemented four
times** (Python, C++, C#, Rust), proven numerically identical via shared golden test vectors,
plus a separate browser-based pricing lab (`web-lab/`) and a planned Excel add-in and
documentation website.

Mission: make standard derivatives pricing a free commodity — professional-grade correctness,
total transparency (every formula derived in the docs), zero cost. Quality bar is "a desk could
rely on it", clarity bar is "a 2nd-year undergrad can verify it".

**Java is not part of this project** (dropped by explicit decision, 2026-07-28) — don't add a
`java/` tree or Java toolchain steps.

## Project map

| Path | What it is |
|------|-----------|
| `contracts/` | **Source of truth.** JSON schemas, the RNG/number spec, golden test vectors (`vectors/*.json`) |
| `python/` | Reference implementation (stdlib-only). `gen_vectors.py` generates `contracts/vectors/` from here — every other language is checked against it |
| `cpp/` | Header-only core (`include/quantkiller/`), CMake, CLI (`src/cli/`), vector tests (`tests/vector_tests.cpp`) |
| `rust/` | Cargo workspace: `quantkiller` (dependency-free rlib) + `quantkiller-cli` (bin, uses serde_json) |
| `csharp/` | `QuantKiller.Core` (netstandard2.0) + `QuantKiller.Cli` (net8.0) + `QuantKiller.Tests` (xUnit) |
| `web-lab/` | **Separate product**, merged wholesale from a parallel session (see git log). A browser-based pricing lab: JS reference engine + C++/Rust/Python/C# compiled to WebAssembly, 20 exotic payoff families, PDE solvers, volatility calibration. Has its own docs (`web-lab/docs/`), its own test suite (`web-lab/*-test.cjs`, run with `node`), and its own roadmap — read `web-lab/docs/HANDOFF.md` before touching it. Don't assume its code style or ABI (a packed `Float64Array` contract) applies to the rest of this repo — they're independent by design. When porting something from web-lab into the native library, treat it as source material to adapt, not code to import unchanged (parameter conventions, error handling, and validation all differ).
| `excel/` | Planned (Phase 4), not started |
| `docs/` | Planned (Phase 7) — MkDocs Material site, not started |
| `scripts/` | `setup-toolchains.ps1`, `test-all.ps1` |

Each language folder is meant to get its own `BUILD.md` (humans) and `AGENTS.md` (you) —
**not yet written**; don't assume they exist.

## Golden rules — read before changing anything

1. **`contracts/` is the single source of truth.** Never hand-edit files in
   `contracts/vectors/`. They are generated from the Python reference implementation by
   `python/gen_vectors.py` — regenerate by running it after changing a Python model, then make
   every other language pass again.
2. **The RNG spec is frozen** (`contracts/rng-spec.md`): PCG32 + (0,1) uniform mapping +
   Acklam inverse-normal CDF + Hart/West `norm_cdf`. Every language implements it identically.
   Changing any of it invalidates every Monte Carlo vector — don't, unless the change is applied
   to all languages and vectors are regenerated in the same PR.
3. **A model is "done" only when all of these exist** (Definition of Done):
   - implemented in all 4 native languages with the same parameter names and conventions
   - passes the shared vectors in every language
   - has a derivation page in `docs/models/` (once `docs/` exists)
   - is callable from every CLI (`quantkiller price --json`)
   - has an Excel function (once `excel/` exists)
4. **Never let one language drift.** If you add a parameter or rename a field, update all four
   implementations, the JSON schema in `contracts/schema/`, and `gen_vectors.py` in the same change.
5. **Keep the code teachable.** Core numerics are dependency-free in every language (no numpy,
   no Boost, no external JSON library in C++ — see `cpp/include/quantkiller/json_lite.hpp`).
   Prefer clarity over micro-optimization.
6. **Don't trust your own implementation as its own oracle.** When testing a special function
   (e.g. `norm_cdf`), check it against an independent computation (Python's `math.erf`), not
   against itself. See `python/tests/conftest.py` and `python/tests/test_qkmath.py` for the
   pattern — this caught a real bug in a test helper during development, not in the production
   code, which is exactly the point.

## Numeric conventions (used everywhere)

- Rates are **continuously compounded**, times in **year fractions**, volatility annualized.
- Parameter names (JSON + all languages): `spot`, `strike`, `rate`, `div_yield`, `vol`, `time`,
  `option_type` ("call"/"put"), `style` ("european"/"american"), `steps`, `paths`, `seed`,
  `phases` (Carr randomization).
- Greeks: `theta` is per year (divide by 365 for per-day), `vega` and `rho` are per unit
  (multiply by 0.01 for per-1%).
- Edge cases: `time == 0` → intrinsic value; `vol == 0` → discounted forward intrinsic (both
  Black-Scholes and the American approximations respect this).
- American approximations (BAW, Ju-Zhong, Bjerksund '93/'02, Carr randomization) all require
  `rate >= 0` and `div_yield >= 0` — they're not defined/tested outside that regime.
- Tolerances vs vectors: closed-form ~1e-10 relative, trees ~1e-9 relative, Monte Carlo
  ~1e-9 relative, American approximations ~1e-9 relative (these are exact reproductions of a
  deterministic algorithm, not statistical estimates, so they get a tight tolerance too).

## Build & test quickstart (Windows; per-language BUILD.md not yet written)

```powershell
# python
cd python; python -m pytest -q; python gen_vectors.py   # regenerate vectors after a model change

# csharp
cd csharp; dotnet test

# rust
cd rust; cargo test --workspace

# cpp
cd cpp; cmake -B build; cmake --build build --config Release; ctest --test-dir build -C Release

# web-lab (separate product, Node test suites)
cd web-lab
node smoke-test.cjs; node exotic-test.cjs; node advanced-test.cjs; node pde-test.cjs
node path-distribution-test.cjs; node pricing-regression-test.cjs; node portfolio-test.cjs; node volatility-test.cjs
```

## Commit conventions

- Conventional-commit style prefixes: `feat(model):`, `fix(cpp):`, `docs(site):`, `ci:`, `test:`.
- One model or one concern per commit. A model change ideally touches all 4 native languages +
  vectors in the same PR (in practice, during initial buildout, Python landed first with vectors
  generated from it, then each other language in its own commit, verified against those same
  vectors — both are fine as long as nothing merges un-cross-checked).
- CI (`.github/workflows/ci.yml`) runs each language's tests, the web-lab Node suites, and (once
  Phase 3 lands) a cross-language CLI-parity job.

## Things that look like bugs but aren't

- `python` on this dev machine resolves to a Store stub via the App Execution Alias; the real
  interpreter is Anaconda at `C:\Program64\Anaconda\python.exe`. Use the full path or fix PATH
  ordering — don't assume bare `python` works.
- MC prices differ from the closed form by ~the reported standard error — that's sampling
  error, not a bug. Cross-language MC results, however, must match to ~1e-9 with the same seed.
- American binomial prices are slightly above European ones for puts (early exercise premium) —
  expected.
- Bjerksund-Stensland 1993 diverges from the other American methods by more than they diverge
  from each other (up to ~0.1 on a ~$10-15 price in some regimes) — this is the model's known
  lower accuracy relative to its own 2002 successor, verified byte-for-byte against source, not
  a transcription bug. Tests give it a wider tolerance deliberately (see `python/tests/test_american.py`).
