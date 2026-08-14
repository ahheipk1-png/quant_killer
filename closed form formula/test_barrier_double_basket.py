"""Tests for barrier_double_basket.py only (family 7)."""

import math

import pytest

from barrier_double_basket import price_barrier_double_basket
from barrier_double_basket_qmc import qmc_price_barrier_double_basket
from barrier_double import price_barrier_double

SINGLE = dict(
    strike=100.0, rate=0.05, maturity=1.0, lower_barrier=80.0, upper_barrier=130.0,
    trigger="continuous", vol_times_list=[[1.0]], vol_values_list=[[0.25]], correlation=1.0,
        value_date=0.0,
)


# ---------------------------------------------------------------- layer 1 --


@pytest.mark.parametrize("style", ["in", "out"])
@pytest.mark.parametrize("option_type", ["call", "put"])
def test_one_asset_basket_matches_single_asset(style, option_type):
    basket = price_barrier_double_basket(
        spots=[100.0], weights=[1.0], div_yields=[0.02], borrows=[0.0],
        option_type=option_type, style=style, **SINGLE,
    )
    single = price_barrier_double(
        spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0, maturity=1.0,
        option_type=option_type, lower_barrier=80.0, upper_barrier=130.0, style=style,
        trigger="continuous", vol_times=[1.0], vol_values=[0.25], value_date=0.0,
    )
    assert basket == pytest.approx(single, abs=1e-8)


def test_rebate_out_plus_in_equals_rebate_discounted():
    common = dict(spots=[100.0, 95.0], weights=[0.6, 0.4], div_yields=[0.02, 0.0], borrows=[0.0, 0.0],
                  strike=100.0, rate=0.05, maturity=1.0, option_type="call", lower_barrier=82.0,
                  upper_barrier=122.0, trigger="continuous", vol_times_list=[[1.0], [1.0]],
                  vol_values_list=[[0.25], [0.3]], correlation=0.5, rebate=5.0, rebate_timing="expiry",
                  value_date=0.0)
    out_price = price_barrier_double_basket(style="out", **common)
    in_price = price_barrier_double_basket(style="in", **common)
    out_no_rebate = price_barrier_double_basket(style="out", **{**common, "rebate": 0.0})
    in_no_rebate = price_barrier_double_basket(style="in", **{**common, "rebate": 0.0})
    rebate_out = out_price - out_no_rebate
    rebate_in = in_price - in_no_rebate
    assert rebate_out + rebate_in == pytest.approx(5.0 * math.exp(-0.05 * 1.0), abs=1e-8)


def test_already_breached_out_worthless():
    price = price_barrier_double_basket(
        spots=[100.0, 100.0], weights=[0.5, 0.5], div_yields=[0.0, 0.0], borrows=[0.0, 0.0],
        strike=100.0, rate=0.05, maturity=1.0, option_type="call", lower_barrier=50.0,
        upper_barrier=90.0, style="out", trigger="continuous",
        vol_times_list=[[1.0], [1.0]], vol_values_list=[[0.25], [0.25]], correlation=1.0,
        value_date=0.0,
    )
    assert price == pytest.approx(0.0, abs=1e-10)


# ---------------------------------------------------------- value_date -----


def test_strike_zero_finite():
    price = price_barrier_double_basket(
        spots=[100.0], weights=[1.0], div_yields=[0.02], borrows=[0.0],
        option_type="call", style="out", **{**SINGLE, "strike": 0.0},
    )
    assert math.isfinite(price) and price >= -1e-6


def test_value_date_at_maturity_uses_true_realized_basket():
    price = price_barrier_double_basket(
        spots=[120.0, 80.0], weights=[0.5, 0.5], strike=90.0, rate=0.05,
        div_yields=[0.02, 0.0], borrows=[0.0, 0.0], maturity=1.0, payment_time=1.0,
        option_type="call", lower_barrier=70.0, upper_barrier=150.0, style="out", trigger="continuous",
        vol_times_list=[[1.0], [1.0]], vol_values_list=[[0.25], [0.3]], correlation=0.5,
        value_date=1.0,
    )
    assert price == pytest.approx(10.0, abs=1e-10)


def test_negative_value_date_rejected():
    with pytest.raises(ValueError):
        price_barrier_double_basket(
            spots=[100.0], weights=[1.0], div_yields=[0.02], borrows=[0.0],
            option_type="call", style="out", **{**SINGLE, "value_date": -0.1},
        )


# ---------------------------------------------------------------- layer 2 --


def test_invalid_barrier_ordering_rejected():
    with pytest.raises(ValueError):
        price_barrier_double_basket(
            spots=[100.0], weights=[1.0], div_yields=[0.0], borrows=[0.0], style="out",
            option_type="call", **{**SINGLE, "lower_barrier": 130.0, "upper_barrier": 80.0},
        )


@pytest.mark.parametrize("correlation", [-0.49, 0.0, 0.5, 0.9, 0.999])
def test_correlation_stress_finite(correlation):
    price = price_barrier_double_basket(
        spots=[100.0, 95.0, 110.0], weights=[0.4, 0.35, 0.25], div_yields=[0.02, 0.01, 0.0],
        borrows=[0.0, 0.0, 0.0], strike=100.0, rate=0.05, maturity=1.0, option_type="call",
        lower_barrier=70.0, upper_barrier=150.0, style="out", trigger="daily",
        vol_times_list=[[1.0], [1.0], [1.0]], vol_values_list=[[0.25], [0.30], [0.20]],
        correlation=correlation,
        value_date=0.0,
    )
    assert math.isfinite(price) and price >= -1e-9


# --------------------------------------------------------- benchmark check --


@pytest.mark.parametrize("correlation", [0.0, 0.35, 0.9])
def test_basket_matches_qmc_and_reports_error(correlation):
    kwargs = dict(
        spots=[100.0, 95.0], weights=[0.6, 0.4], strike=100.0, rate=0.05,
        div_yields=[0.02, 0.01], borrows=[0.0, 0.0], maturity=1.0, option_type="call",
        lower_barrier=75.0, upper_barrier=130.0, style="out", trigger="continuous",
        vol_times_list=[[1.0], [1.0]], vol_values_list=[[0.25], [0.30]], correlation=correlation,
        value_date=0.0,
    )
    closed = price_barrier_double_basket(**kwargs)
    mc_price, se = qmc_price_barrier_double_basket(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-6) * 100.0
    print(f"basket double barrier rho={correlation}: closed={closed:.5f} mc={mc_price:.5f} se={se:.5f} err={error_pct:.3f}%")
    assert error_pct < 15.0
