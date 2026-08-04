"""Generate contracts/vectors/*.json from the Python reference implementation.

Run: python gen_vectors.py
Never hand-edit the output — see contracts/README.md.
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from quantkiller.models import black_scholes, binomial, monte_carlo, implied_vol, forward, parity, american

OUT_DIR = pathlib.Path(__file__).parent.parent / "contracts" / "vectors"

CLOSED_FORM_TOL = {"rel": 1e-10, "abs": 1e-12}
TREE_TOL = {"rel": 1e-9, "abs": 1e-10}
MC_TOL = {"rel": 1e-9, "abs": 1e-9}
AMERICAN_APPROX_TOL = {"rel": 1e-9, "abs": 1e-9}


def case(name, params, results, tol):
    return {"name": name, "params": params, "expected": results, "tolerance": tol}


def write(model, cases):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{model}.json"
    path.write_text(json.dumps({"model": model, "cases": cases}, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(cases)} cases -> {path}")


BS_INPUTS = [
    ("hull_example_call", 42.0, 40.0, 0.10, 0.0, 0.20, 0.5, "call"),
    ("hull_example_put", 42.0, 40.0, 0.10, 0.0, 0.20, 0.5, "put"),
    ("atm_with_dividend_call", 100.0, 100.0, 0.05, 0.02, 0.30, 1.0, "call"),
    ("atm_with_dividend_put", 100.0, 100.0, 0.05, 0.02, 0.30, 1.0, "put"),
    ("otm_call_long_dated", 50.0, 60.0, 0.03, 0.0, 0.15, 2.0, "call"),
    ("itm_put_long_dated", 60.0, 50.0, 0.03, 0.0, 0.15, 2.0, "put"),
    ("zero_rate_high_vol", 100.0, 100.0, 0.0, 0.0, 0.40, 3.0, "call"),
    ("time_zero_itm_call", 105.0, 100.0, 0.05, 0.0, 0.20, 0.0, "call"),
    ("zero_vol_call", 100.0, 90.0, 0.05, 0.0, 0.0, 1.0, "call"),
]


def gen_black_scholes():
    cases = []
    for name, spot, strike, rate, q, vol, t, opt in BS_INPUTS:
        params = {"spot": spot, "strike": strike, "rate": rate, "div_yield": q,
                  "vol": vol, "time": t, "option_type": opt}
        result = black_scholes.price(spot, strike, rate, q, vol, t, opt)
        cases.append(case(name, params, result, CLOSED_FORM_TOL))
    write("black_scholes", cases)


def gen_binomial():
    cases = []
    inputs = [
        ("eu_call_100steps", 100.0, 100.0, 0.05, 0.0, 0.2, 1.0, "call", "european", 100),
        ("eu_put_100steps", 100.0, 105.0, 0.03, 0.01, 0.25, 0.5, "put", "european", 100),
        ("am_put_100steps", 100.0, 110.0, 0.05, 0.0, 0.3, 1.0, "put", "american", 100),
        ("am_call_dividend_100steps", 100.0, 100.0, 0.04, 0.08, 0.25, 1.0, "call", "american", 100),
    ]
    for name, spot, strike, rate, q, vol, t, opt, style, steps in inputs:
        params = {"spot": spot, "strike": strike, "rate": rate, "div_yield": q, "vol": vol,
                  "time": t, "option_type": opt, "style": style, "steps": steps}
        result = binomial.price(spot, strike, rate, q, vol, t, opt, style, steps)
        cases.append(case(name, params, result, TREE_TOL))
    write("binomial_crr", cases)


def gen_monte_carlo():
    cases = []
    inputs = [
        ("call_seed42_50k", 100.0, 100.0, 0.05, 0.0, 0.2, 1.0, "call", 50000, 42, True),
        ("put_seed7_50k", 100.0, 105.0, 0.03, 0.01, 0.25, 0.5, "put", 50000, 7, True),
        ("call_seed1_no_antithetic_20k", 100.0, 100.0, 0.05, 0.0, 0.2, 1.0, "call", 20000, 1, False),
    ]
    for name, spot, strike, rate, q, vol, t, opt, paths, seed, anti in inputs:
        params = {"spot": spot, "strike": strike, "rate": rate, "div_yield": q, "vol": vol,
                  "time": t, "option_type": opt, "paths": paths, "seed": seed, "antithetic": anti}
        result = monte_carlo.price(spot, strike, rate, q, vol, t, opt, paths, seed, anti)
        cases.append(case(name, params, result, MC_TOL))
    write("monte_carlo_gbm", cases)


def gen_implied_vol():
    cases = []
    inputs = [
        ("recover_20pct_call", 100.0, 105.0, 0.04, 0.01, 0.20, 0.75, "call"),
        ("recover_50pct_put", 100.0, 95.0, 0.03, 0.0, 0.50, 1.0, "put"),
    ]
    for name, spot, strike, rate, q, true_vol, t, opt in inputs:
        target = black_scholes.price(spot, strike, rate, q, true_vol, t, opt)["price"]
        params = {"price": target, "spot": spot, "strike": strike, "rate": rate,
                  "div_yield": q, "time": t, "option_type": opt}
        result = implied_vol.solve(target, spot, strike, rate, q, t, opt)
        cases.append(case(name, params, {"implied_vol": result["implied_vol"]},
                          {"rel": 1e-6, "abs": 1e-7}))
    write("implied_vol", cases)


def gen_forward():
    cases = []
    p1 = {"spot": 100.0, "rate": 0.05, "div_yield": 0.02, "time": 1.0}
    cases.append(case("basic_carry", p1, forward.price(**p1), CLOSED_FORM_TOL))
    p2 = {"spot": 100.0, "rate": 0.05, "div_yield": 0.0, "time": 1.0, "strike": 95.0}
    cases.append(case("with_strike", p2, forward.price(**p2), CLOSED_FORM_TOL))
    write("forward", cases)


def gen_parity():
    cases = []
    params = {"spot": 100.0, "strike": 95.0, "rate": 0.05, "div_yield": 0.0,
              "time": 1.0, "call_price": 12.0}
    cases.append(case("derive_put", params, parity.run(params), CLOSED_FORM_TOL))
    write("put_call_parity", cases)


AMERICAN_METHODS = {
    "american_baw": american.baw_price,
    "american_ju_zhong": american.ju_zhong_price,
    "american_bjerksund_1993": american.bjerksund_1993_price,
    "american_bjerksund_2002": american.bjerksund_2002_price,
}

AMERICAN_INPUTS = [
    ("put_atm", 100.0, 100.0, 0.05, 0.0, 0.3, 1.0, "put"),
    ("put_otm", 100.0, 90.0, 0.05, 0.0, 0.3, 1.0, "put"),
    ("put_itm", 100.0, 110.0, 0.05, 0.0, 0.3, 1.0, "put"),
    ("call_high_dividend", 100.0, 100.0, 0.04, 0.08, 0.25, 1.0, "call"),
]


def gen_american():
    for model, fn in AMERICAN_METHODS.items():
        cases = []
        for name, spot, strike, rate, q, vol, t, opt in AMERICAN_INPUTS:
            params = {"spot": spot, "strike": strike, "rate": rate, "div_yield": q,
                      "vol": vol, "time": t, "option_type": opt}
            result = fn(spot, strike, rate, q, vol, t, opt)
            cases.append(case(name, params, result, AMERICAN_APPROX_TOL))
        write(model, cases)

    cases = []
    for name, spot, strike, rate, q, vol, t, opt in AMERICAN_INPUTS:
        params = {"spot": spot, "strike": strike, "rate": rate, "div_yield": q,
                  "vol": vol, "time": t, "option_type": opt, "phases": 64}
        result = american.carr_randomization_price(spot, strike, rate, q, vol, t, 64, opt)
        cases.append(case(name, params, result, {"rel": 1e-6, "abs": 1e-6}))
    write("american_carr_randomization", cases)


if __name__ == "__main__":
    gen_black_scholes()
    gen_binomial()
    gen_monte_carlo()
    gen_implied_vol()
    gen_forward()
    gen_parity()
    gen_american()
    print("done")
