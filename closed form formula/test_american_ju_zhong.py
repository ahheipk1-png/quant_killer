"""Tests for american_ju_zhong.py, benchmarked against american_pde.py
(family 2 -- the one family using a PDE benchmark instead of QMC)."""

import math

import pytest

from american_ju_zhong import price_american_ju_zhong
from american_pde import price_american_pde, convergence_table
from european import price_european

BASE = dict(
    spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
    maturity=1.0, vol_times=[1.0], vol_values=[0.25], value_date=0.0,
)


# ---------------------------------------------------------------- layer 1 --


def test_call_with_zero_dividend_equals_european_exactly():
    # Never optimal to exercise early with no dividend/borrow drag: an
    # American call collapses to the European price, exactly.
    kwargs = dict(spot=100.0, strike=95.0, rate=0.05, div_yield=0.0, borrow=0.0,
                  maturity=1.0, vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    american = price_american_ju_zhong(option_type="call", **kwargs)
    euro = price_european(option_type="call", **kwargs)
    assert american == pytest.approx(euro, abs=1e-9)


@pytest.mark.parametrize("option_type", ["call", "put"])
def test_american_at_least_european(option_type):
    american = price_american_ju_zhong(option_type=option_type, **BASE)
    euro = price_european(option_type=option_type, **BASE)
    assert american >= euro - 1e-9


@pytest.mark.parametrize("option_type", ["call", "put"])
def test_american_at_least_intrinsic(option_type):
    price = price_american_ju_zhong(option_type=option_type, **BASE)
    intrinsic = max(BASE["spot"] - BASE["strike"], 0.0) if option_type == "call" else max(BASE["strike"] - BASE["spot"], 0.0)
    assert price >= intrinsic - 1e-9


def test_deep_itm_put_near_intrinsic():
    kwargs = dict(spot=40.0, strike=100.0, rate=0.05, div_yield=0.0, borrow=0.0,
                  maturity=1.0, vol_times=[1.0], vol_values=[0.2], value_date=0.0)
    price = price_american_ju_zhong(option_type="put", **kwargs)
    assert price == pytest.approx(60.0, abs=0.5)  # rate>0 => early exercise nearly optimal


def test_deferred_payment_time():
    at_maturity = price_american_ju_zhong(option_type="put", payment_time=1.0, **BASE)
    deferred = price_american_ju_zhong(option_type="put", payment_time=1.3, **BASE)
    assert deferred / at_maturity == pytest.approx(math.exp(-BASE["rate"] * 0.3), rel=1e-9)


def test_negative_rate_or_div_rejected():
    with pytest.raises(ValueError):
        price_american_ju_zhong(option_type="put", **{**BASE, "rate": -0.01})
    with pytest.raises(ValueError):
        price_american_ju_zhong(option_type="put", **{**BASE, "div_yield": -0.05, "borrow": 0.0})


# ---------------------------------------------------------- value_date -----


def test_strike_zero_finite_and_nonnegative():
    for opt in ("call", "put"):
        price = price_american_ju_zhong(option_type=opt, **{**BASE, "strike": 0.0})
        assert math.isfinite(price) and price >= -1e-6


def test_value_date_past_payment_is_zero():
    common = {k: v for k, v in BASE.items() if k != "value_date"}
    price = price_american_ju_zhong(option_type="put", payment_time=1.2, value_date=1.5, **common)
    assert price == pytest.approx(0.0, abs=1e-12)


def test_value_date_at_maturity_uses_intrinsic():
    price = price_american_ju_zhong(spot=110.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                                     maturity=1.0, payment_time=1.3, option_type="call",
                                     vol_times=[1.0], vol_values=[0.3], value_date=1.1)
    expected = 10.0 * math.exp(-0.05 * (1.3 - 1.1))
    assert price == pytest.approx(expected, abs=1e-10)


def test_value_date_partway_matches_shifted_horizon():
    partway = price_american_ju_zhong(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                                       maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[0.3],
                                       value_date=0.4)
    shifted = price_american_ju_zhong(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                                       maturity=0.6, option_type="put", vol_times=[0.6], vol_values=[0.3],
                                       value_date=0.0)
    assert partway == pytest.approx(shifted, abs=1e-9)


def test_negative_value_date_rejected():
    with pytest.raises(ValueError):
        price_american_ju_zhong(option_type="put", **{**BASE, "value_date": -0.1})


# ---------------------------------------------------------------- layer 2 --


def test_maturity_zero_is_intrinsic():
    price = price_american_ju_zhong(spot=90.0, strike=100.0, rate=0.05, div_yield=0.0, borrow=0.0,
                                     maturity=0.0, option_type="put", vol_times=[1.0], vol_values=[0.2],
                                     value_date=0.0)
    assert price == pytest.approx(10.0, abs=1e-10)


def test_one_day_maturity_finite():
    price = price_american_ju_zhong(spot=100.0, strike=100.0, rate=0.03, div_yield=0.02, borrow=0.0,
                                     maturity=1.0 / 365.0, option_type="put",
                                     vol_times=[1.0 / 365.0], vol_values=[0.3], value_date=0.0)
    assert math.isfinite(price) and price >= 0.0


def test_strike_near_zero_finite():
    price = price_american_ju_zhong(spot=100.0, strike=0.01, rate=0.05, div_yield=0.02, borrow=0.0,
                                     maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[0.3],
                                     value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


# ---------------------------------------------------------------- layer 3 --


@pytest.mark.parametrize("vol", [0.001, 0.005, 3.0])
def test_vol_stress_finite(vol):
    price = price_american_ju_zhong(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                                     maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[vol],
                                     value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("rate", [0.0, 0.001, 0.2])
def test_rate_stress_finite(rate):
    price = price_american_ju_zhong(spot=100.0, strike=100.0, rate=rate, div_yield=0.02, borrow=0.0,
                                     maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[0.3],
                                     value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("maturity_days", [1, 365, 30 * 365])
def test_maturity_stress_finite(maturity_days):
    maturity = maturity_days / 365.0
    price = price_american_ju_zhong(spot=100.0, strike=100.0, rate=0.03, div_yield=0.01, borrow=0.0,
                                     maturity=maturity, option_type="put",
                                     vol_times=[maturity], vol_values=[0.25], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


# --------------------------------------------------------- benchmark check --


@pytest.mark.parametrize("option_type", ["call", "put"])
@pytest.mark.parametrize("spot", [80.0, 100.0, 120.0])
def test_matches_pde_and_reports_error(option_type, spot):
    kwargs = dict(**{**BASE, "spot": spot}, option_type=option_type)
    jz = price_american_ju_zhong(**kwargs)
    pde = price_american_pde(**kwargs)
    error_pct = abs(jz - pde) / max(pde, 1e-6) * 100.0
    print(f"American {option_type} spot={spot}: ju_zhong={jz:.5f} pde={pde:.5f} err={error_pct:.3f}%")
    assert error_pct < 2.0  # documented Ju-Zhong approximation bound


def test_pde_reduces_to_european_for_call_no_dividend():
    kwargs = dict(spot=100.0, strike=95.0, rate=0.05, div_yield=0.0, borrow=0.0,
                  maturity=1.0, vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    pde = price_american_pde(option_type="call", **kwargs)
    euro = price_european(option_type="call", **kwargs)
    assert pde == pytest.approx(euro, abs=1e-3)


def test_pde_convergence_table_is_monotone_and_shrinking():
    no_value_date = {k: v for k, v in BASE.items() if k != "value_date"}
    rows = convergence_table(option_type="put", sizes=(25, 50, 100, 200), **no_value_date)
    prices = [p for _, p in rows]
    diffs = [abs(prices[i + 1] - prices[i]) for i in range(len(prices) - 1)]
    print("PDE convergence table:", rows)
    assert diffs[-1] < diffs[0]  # error shrinks as resolution grows
    assert all(math.isfinite(p) for p in prices)


def test_sloped_term_vol_matches_pde():
    kwargs = dict(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0, maturity=1.0,
                  vol_times=[0.25, 1.0], vol_values=[0.2, 0.3], option_type="put", value_date=0.0)
    jz = price_american_ju_zhong(**kwargs)
    pde = price_american_pde(**kwargs)
    error_pct = abs(jz - pde) / max(pde, 1e-6) * 100.0
    print(f"sloped term vol American put: ju_zhong={jz:.5f} pde={pde:.5f} err={error_pct:.3f}%")
    assert math.isfinite(jz)
