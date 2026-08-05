# Contributing to QuantKiller

Thanks for your interest! Ground rules:

## The one big rule

**All four native languages move together.** A change to a model's behavior must update:

1. the Python reference implementation (`python/`),
2. the regenerated golden vectors (`python/gen_vectors.py` → `contracts/vectors/`),
3. the C++, C#, and Rust implementations until they pass the new vectors,
4. the derivation page in `docs/models/` (once `docs/` exists — Phase 7, not started),
5. the Excel function in `excel/` (once it exists — Phase 4, not started).

`web-lab/` (the browser lab) is a separate, independently-tested product merged from a parallel
session — see `CLAUDE.md`'s project map. It doesn't need to move in lockstep with the above;
treat it as source material to adapt when porting a model into the native library, not code
that must stay in sync.

CI enforces most of this: every language's tests run against the same vectors, and a
cross-language job diffs CLI outputs.

## Adding a new model

1. Open an issue describing the model, its parameters, and a published reference value
   (textbook or paper) we can validate against.
2. Implement in Python first, following the conventions in `CLAUDE.md`
   (parameter names, continuous compounding, Greeks units).
3. Add vector cases (including edge cases) to `python/gen_vectors.py`, regenerate, and make
   sure the Python tests cross-check at least one published value.
4. Port to the other three native languages. Keep the code dependency-free and readable —
   this is a teaching library first.
5. Write the derivation page at year-2 undergraduate level: intuition → assumptions →
   derivation → algorithm → validation table.

## Style

- Follow each language's `AGENTS.md` for build/test commands and local conventions.
- Conventional commits: `feat(model): add trinomial tree`, `fix(rust): barrier edge case`, …
- No new runtime dependencies in core numerics without discussion.

## Disclaimer

Educational project — not investment advice. Contributions that add trading connectivity or
execution features are out of scope.
