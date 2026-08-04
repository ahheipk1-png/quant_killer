import math

import pytest

from quantkiller.models.black_scholes import price
from .conftest import oracle_black_scholes


CASES = [
    (42.0, 40.0, 0.10, 0.0, 0.20, 0.5, "call"),
    (42.0, 40.0, 0.10, 0.0, 0.20, 0.5, "put"),
    (100.0, 100.0, 0.05, 0.02, 0.30, 1.0, "call"),
    (100.0, 100.0, 0.05, 0.02, 0.30, 1.0, "put"),
    (50.0, 60.0, 0.03, 0.0, 0.15, 2.0, "call"),
    (60.0, 50.0, 0.03, 0.0, 0.15, 2.0, "put"),
    (100.0, 100.0, 0.0, 0.0, 0.40, 3.0, "call"),
]


@pytest.mark.parametrize("spot,strike,rate,q,vol,t,opt", CASES)
def test_price_matches_erf_oracle(spot, strike, rate, q, vol, t, opt):
    out = price(spot, strike, rate, q, vol, t, opt)
    expected = oracle_black_scholes(spot, strike, rate, q, vol, t, opt == "call")
    assert out["price"] == pytest.approx(expected, rel=1e-10, abs=1e-12)


def test_put_call_parity_holds():
    spot, strike, rate, q, vol, t = 55.0, 50.0, 0.04, 0.01, 0.25, 0.75
    call = price(spot, strike, rate, q, vol, t, "call")["price"]
    put = price(spot, strike, rate, q, vol, t, "put")["price"]
    lhs = call - put
    rhs = spot * math.exp(-q * t) - strike * math.exp(-rate * t)
    assert lhs == pytest.approx(rhs, abs=1e-10)


def test_time_zero_is_intrinsic():
    out = price(105.0, 100.0, 0.05, 0.0, 0.2, 0.0, "call")
    assert out["price"] == pytest.approx(5.0)
    assert out["delta"] == 1.0
    out_otm = price(95.0, 100.0, 0.05, 0.0, 0.2, 0.0, "call")
    assert out_otm["price"] == 0.0
    assert out_otm["delta"] == 0.0


def test_zero_vol_is_discounted_forward_intrinsic():
    spot, strike, rate, q, t = 100.0, 90.0, 0.05, 0.0, 1.0
    out = price(spot, strike, rate, q, 0.0, t, "call")
    fwd = spot * math.exp((rate - q) * t)
    expected = math.exp(-rate * t) * max(fwd - strike, 0.0)
    assert out["price"] == pytest.approx(expected)


def test_greeks_finite_difference_delta():
    spot, strike, rate, q, vol, t = 100.0, 95.0, 0.03, 0.0, 0.25, 1.0
    h = 1e-4
    p_up = price(spot + h, strike, rate, q, vol, t, "call")["price"]
    p_dn = price(spot - h, strike, rate, q, vol, t, "call")["price"]
    fd_delta = (p_up - p_dn) / (2 * h)
    analytic_delta = price(spot, strike, rate, q, vol, t, "call")["delta"]
    assert analytic_delta == pytest.approx(fd_delta, abs=1e-6)


def test_greeks_finite_difference_vega():
    spot, strike, rate, q, vol, t = 100.0, 95.0, 0.03, 0.0, 0.25, 1.0
    h = 1e-5
    p_up = price(spot, strike, rate, q, vol + h, t, "call")["price"]
    p_dn = price(spot, strike, rate, q, vol - h, t, "call")["price"]
    fd_vega = (p_up - p_dn) / (2 * h)
    analytic_vega = price(spot, strike, rate, q, vol, t, "call")["vega"]
    assert analytic_vega == pytest.approx(fd_vega, abs=1e-4)


def test_call_and_put_price_are_nonnegative():
    for spot, strike, rate, q, vol, t, opt in CASES:
        assert price(spot, strike, rate, q, vol, t, opt)["price"] >= -1e-12
