import pytest

from quantkiller.models.implied_vol import solve
from quantkiller.models.black_scholes import price as bs_price
from quantkiller import QKError


@pytest.mark.parametrize("true_vol", [0.05, 0.1, 0.2, 0.35, 0.5, 1.0, 2.0])
@pytest.mark.parametrize("opt", ["call", "put"])
def test_round_trips_black_scholes(true_vol, opt):
    spot, strike, rate, q, t = 100.0, 105.0, 0.04, 0.01, 0.75
    target = bs_price(spot, strike, rate, q, true_vol, t, opt)["price"]
    out = solve(target, spot, strike, rate, q, t, opt)
    assert out["implied_vol"] == pytest.approx(true_vol, abs=1e-7)


def test_zero_price_gives_zero_vol():
    spot, strike, rate, q, t = 100.0, 200.0, 0.04, 0.0, 0.1
    # Deep OTM call at essentially zero premium -> lower bound is ~0.
    lower_bound_price = 0.0
    out = solve(lower_bound_price, spot, strike, rate, q, t, "call")
    assert out["implied_vol"] == 0.0


def test_rejects_price_above_upper_bound():
    spot, strike, rate, q, t = 100.0, 100.0, 0.04, 0.0, 1.0
    with pytest.raises(QKError):
        solve(spot + 1.0, spot, strike, rate, q, t, "call")  # call can't exceed spot
