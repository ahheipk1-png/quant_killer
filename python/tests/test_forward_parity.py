import math

import pytest

from quantkiller.models import forward as forward_mod
from quantkiller.models import parity as parity_mod
from quantkiller import QKError


def test_forward_price_matches_cost_of_carry():
    out = forward_mod.price(spot=100.0, rate=0.05, div_yield=0.02, time=1.0)
    assert out["forward_price"] == pytest.approx(100.0 * math.exp(0.03))


def test_forward_value_with_strike():
    out = forward_mod.price(spot=100.0, rate=0.05, div_yield=0.0, time=1.0, strike=95.0)
    fwd = 100.0 * math.exp(0.05)
    assert out["value"] == pytest.approx((fwd - 95.0) * math.exp(-0.05))


def test_parity_derives_put_from_call():
    out = parity_mod.run({"spot": 100.0, "strike": 95.0, "rate": 0.05, "div_yield": 0.0,
                           "time": 1.0, "call_price": 12.0})
    basis = 100.0 - 95.0 * math.exp(-0.05)
    assert out["put_price"] == pytest.approx(12.0 - basis)
    assert out["residual"] == 0.0


def test_parity_derives_call_from_put():
    out = parity_mod.run({"spot": 100.0, "strike": 95.0, "rate": 0.05, "div_yield": 0.0,
                           "time": 1.0, "put_price": 3.0})
    basis = 100.0 - 95.0 * math.exp(-0.05)
    assert out["call_price"] == pytest.approx(3.0 + basis)


def test_parity_residual_with_both_legs():
    out = parity_mod.run({"spot": 100.0, "strike": 95.0, "rate": 0.05, "div_yield": 0.0,
                           "time": 1.0, "call_price": 12.0, "put_price": 3.0})
    basis = 100.0 - 95.0 * math.exp(-0.05)
    assert out["residual"] == pytest.approx(12.0 - 3.0 - basis)


def test_parity_requires_at_least_one_leg():
    with pytest.raises(QKError):
        parity_mod.run({"spot": 100.0, "strike": 95.0, "rate": 0.05, "time": 1.0})
