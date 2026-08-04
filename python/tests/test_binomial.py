import pytest

from quantkiller.models.binomial import price as crr_price
from quantkiller.models.black_scholes import price as bs_price
from quantkiller import QKError


def test_european_crr_converges_to_black_scholes():
    spot, strike, rate, q, vol, t = 100.0, 100.0, 0.05, 0.0, 0.2, 1.0
    bs = bs_price(spot, strike, rate, q, vol, t, "call")["price"]
    crr = crr_price(spot, strike, rate, q, vol, t, "call", "european", 2000)["price"]
    assert crr == pytest.approx(bs, abs=0.01)


def test_european_crr_converges_for_put_too():
    spot, strike, rate, q, vol, t = 100.0, 105.0, 0.03, 0.01, 0.25, 0.5
    bs = bs_price(spot, strike, rate, q, vol, t, "put")["price"]
    crr = crr_price(spot, strike, rate, q, vol, t, "put", "european", 2000)["price"]
    assert crr == pytest.approx(bs, abs=0.01)


def test_american_put_at_least_european_put():
    spot, strike, rate, q, vol, t = 100.0, 110.0, 0.05, 0.0, 0.3, 1.0
    european = crr_price(spot, strike, rate, q, vol, t, "put", "european", 500)["price"]
    american = crr_price(spot, strike, rate, q, vol, t, "put", "american", 500)["price"]
    assert american >= european - 1e-9


def test_american_call_equals_european_when_no_dividend():
    # No early exercise is ever optimal for a call with no dividends.
    spot, strike, rate, q, vol, t = 100.0, 90.0, 0.05, 0.0, 0.3, 1.0
    european = crr_price(spot, strike, rate, q, vol, t, "call", "european", 500)["price"]
    american = crr_price(spot, strike, rate, q, vol, t, "call", "american", 500)["price"]
    assert american == pytest.approx(european, abs=1e-6)


def test_price_is_at_least_intrinsic():
    spot, strike, rate, q, vol, t = 120.0, 100.0, 0.05, 0.0, 0.3, 1.0
    out = crr_price(spot, strike, rate, q, vol, t, "call", "american", 200)
    assert out["price"] >= max(spot - strike, 0.0) - 1e-9


def test_greeks_present_for_steps_ge_2():
    out = crr_price(100.0, 100.0, 0.05, 0.0, 0.2, 1.0, "call", "european", 50)
    assert "delta" in out and "gamma" in out and "theta" in out


def test_rejects_nondegenerate_probability():
    with pytest.raises(QKError):
        # vol=0 with steps requiring vol>0
        crr_price(100.0, 100.0, 0.05, 0.0, 0.0, 1.0, "call", "european", 10)


def test_rejects_zero_time():
    with pytest.raises(QKError):
        crr_price(100.0, 100.0, 0.05, 0.0, 0.2, 0.0, "call", "european", 10)
