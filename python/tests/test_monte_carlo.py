import pytest

from quantkiller.models.monte_carlo import price as mc_price
from quantkiller.models.black_scholes import price as bs_price
from quantkiller import QKError


def test_mc_converges_to_black_scholes_within_std_error():
    spot, strike, rate, q, vol, t = 100.0, 100.0, 0.05, 0.0, 0.2, 1.0
    bs = bs_price(spot, strike, rate, q, vol, t, "call")["price"]
    out = mc_price(spot, strike, rate, q, vol, t, "call", paths=200_000, seed=42, antithetic=True)
    # 6-sigma band: astronomically unlikely to fail by chance, tight enough to catch bugs.
    assert abs(out["price"] - bs) < 6 * out["std_error"]


def test_mc_is_deterministic_given_seed():
    kwargs = dict(spot=100.0, strike=100.0, rate=0.05, div_yield=0.0, vol=0.2,
                  time=1.0, option_type="call", paths=5000, seed=7, antithetic=True)
    a = mc_price(**kwargs)
    b = mc_price(**kwargs)
    assert a == b


def test_mc_different_seeds_differ():
    kwargs = dict(spot=100.0, strike=100.0, rate=0.05, div_yield=0.0, vol=0.2,
                  time=1.0, option_type="call", paths=5000, antithetic=True)
    a = mc_price(seed=1, **kwargs)
    b = mc_price(seed=2, **kwargs)
    assert a["price"] != b["price"]


def test_antithetic_reduces_variance_for_this_case():
    kwargs = dict(spot=100.0, strike=100.0, rate=0.05, div_yield=0.0, vol=0.2,
                  time=1.0, option_type="call", paths=20000, seed=42)
    plain = mc_price(antithetic=False, **kwargs)
    anti = mc_price(antithetic=True, **kwargs)
    assert anti["std_error"] < plain["std_error"]


def test_rejects_too_few_paths():
    with pytest.raises(QKError):
        mc_price(100.0, 100.0, 0.05, 0.0, 0.2, 1.0, "call", paths=1, seed=1, antithetic=True)


def test_rejects_zero_time():
    with pytest.raises(QKError):
        mc_price(100.0, 100.0, 0.05, 0.0, 0.2, 0.0, "call", paths=100, seed=1, antithetic=True)
