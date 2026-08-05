#!/usr/bin/env python3
"""Generate web-lab/web/code-snapshot.json: the real source of each shared
model, across all four native languages, for the web-lab "Source code" page.

This is a snapshot, not a live file server -- web-lab's static server only
serves web-lab/web/, so the actual source under python/, cpp/, rust/,
csharp/ has to be baked into something it can serve. Regenerate after
changing any of the files below; never hand-edit the output.

Run: python scripts/gen_code_snapshot.py
"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web-lab" / "web" / "code-snapshot.json"

# (group id, display title, description) -> per-language relative path(s).
# Python has qkmath.py/rng.py/black_scholes.py/... as separate files matching
# the others 1:1, except forward+parity which are two small files in Python
# and one combined file elsewhere -- concatenated below for that group.
GROUPS = [
    ("qkmath", "Special functions (qkmath)",
     "norm_cdf / norm_pdf / norminv -- Hart/West and Acklam approximations, frozen in contracts/rng-spec.md.",
     {
         "python": ["python/quantkiller/qkmath.py"],
         "cpp": ["cpp/include/quantkiller/qkmath.hpp"],
         "rust": ["rust/quantkiller/src/qkmath.rs"],
         "csharp": ["csharp/src/QuantKiller.Core/QkMath.cs"],
     }),
    ("rng", "Random number generator (PCG32)",
     "The only RNG used anywhere in QuantKiller -- same seed, same stream, in every language.",
     {
         "python": ["python/quantkiller/rng.py"],
         "cpp": ["cpp/include/quantkiller/rng.hpp"],
         "rust": ["rust/quantkiller/src/rng.rs"],
         "csharp": ["csharp/src/QuantKiller.Core/Rng.cs"],
     }),
    ("black_scholes", "Black-Scholes-Merton",
     "Closed form with continuous dividend yield, plus Greeks.",
     {
         "python": ["python/quantkiller/models/black_scholes.py"],
         "cpp": ["cpp/include/quantkiller/models/black_scholes.hpp"],
         "rust": ["rust/quantkiller/src/models/black_scholes.rs"],
         "csharp": ["csharp/src/QuantKiller.Core/Models/BlackScholes.cs"],
     }),
    ("binomial", "Binomial tree (CRR)",
     "Cox-Ross-Rubinstein, European and American, with tree Greeks.",
     {
         "python": ["python/quantkiller/models/binomial.py"],
         "cpp": ["cpp/include/quantkiller/models/binomial.hpp"],
         "rust": ["rust/quantkiller/src/models/binomial.rs"],
         "csharp": ["csharp/src/QuantKiller.Core/Models/Binomial.cs"],
     }),
    ("monte_carlo", "Monte Carlo (GBM)",
     "European pricing under GBM with antithetic variates; the deterministic RNG spec is what makes this comparable across languages at all.",
     {
         "python": ["python/quantkiller/models/monte_carlo.py"],
         "cpp": ["cpp/include/quantkiller/models/monte_carlo.hpp"],
         "rust": ["rust/quantkiller/src/models/monte_carlo.rs"],
         "csharp": ["csharp/src/QuantKiller.Core/Models/MonteCarlo.cs"],
     }),
    ("implied_vol", "Implied volatility",
     "Safeguarded Newton with a bisection fallback, inverting Black-Scholes for sigma.",
     {
         "python": ["python/quantkiller/models/implied_vol.py"],
         "cpp": ["cpp/include/quantkiller/models/implied_vol.hpp"],
         "rust": ["rust/quantkiller/src/models/implied_vol.rs"],
         "csharp": ["csharp/src/QuantKiller.Core/Models/ImpliedVol.cs"],
     }),
    ("forward_parity", "Forward pricing & put-call parity",
     "Cost-of-carry forward pricing and the parity identity relating call/put prices.",
     {
         "python": ["python/quantkiller/models/forward.py", "python/quantkiller/models/parity.py"],
         "cpp": ["cpp/include/quantkiller/models/forward_parity.hpp"],
         "rust": ["rust/quantkiller/src/models/forward_parity.rs"],
         "csharp": ["csharp/src/QuantKiller.Core/Models/ForwardParity.cs"],
     }),
    ("american", "American exercise (5 methods)",
     "Barone-Adesi-Whaley, Ju-Zhong, Bjerksund-Stensland 1993 & 2002, and Carr randomization -- ported from the web-lab merge, cross-checked against each other and the CRR tree.",
     {
         "python": ["python/quantkiller/models/american.py"],
         "cpp": ["cpp/include/quantkiller/models/american.hpp"],
         "rust": ["rust/quantkiller/src/models/american.rs"],
         "csharp": ["csharp/src/QuantKiller.Core/Models/American.cs"],
     }),
]

LANG_LABELS = {"python": "Python", "cpp": "C++", "rust": "Rust", "csharp": "C#"}
LANG_PRISM_ID = {"python": "python", "cpp": "cpp", "rust": "rust", "csharp": "csharp"}


def read_group(paths):
    parts = []
    for rel in paths:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if len(paths) > 1:
            parts.append(f"// ---- {rel} ----\n{text}" if not rel.endswith(".py")
                         else f"# ---- {rel} ----\n{text}")
        else:
            parts.append(text)
    return "\n\n".join(parts)


def main():
    groups_out = []
    for group_id, title, description, langs in GROUPS:
        languages = {}
        for lang, paths in langs.items():
            languages[lang] = {
                "label": LANG_LABELS[lang],
                "paths": paths,
                "code": read_group(paths),
            }
        groups_out.append({"id": group_id, "title": title, "description": description, "languages": languages})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"groups": groups_out}, indent=2), encoding="utf-8")
    total = sum(len(g["languages"]) for g in groups_out)
    print(f"wrote {len(groups_out)} model groups x up to 4 languages ({total} snippets) -> {OUT}")


if __name__ == "__main__":
    main()
