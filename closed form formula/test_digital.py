"""Tests for digital.py only (family 8)."""

import math

import numpy as np
import pytest

from digital import basket_forward_and_variance, price_digital, price_digital_basket
from digital_qmc import qmc_price_digital, qmc_price_digital_basket

SINGLE = dict(
    spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
    maturity=1.0, vol_times=[1.0], vol_values=[0.25], value_date=0.0,
)


# ---------------------------------------------------------------- layer 1 --


def test_cash_or_nothing_call_plus_put_equals_discounted_cash():
    call = price_digital(option_type="call", payout_type="cash", cash=10.0, **SINGLE)
    put = price_digital(option_type="put", payout_type="cash", cash=10.0, **SINGLE)
    disc_pay = math.exp(-SINGLE["rate"] * SINGLE["maturity"])
    assert call + put == pytest.approx(10.0 * disc_pay, abs=1e-10)


def test_asset_or_nothing_call_plus_put_equals_discounted_forward():
    call = price_digital(option_type="call", payout_type="asset", **SINGLE)
    put = price_digital(option_type="put", payout_type="asset", **SINGLE)
    carry = SINGLE["rate"] - SINGLE["div_yield"] - SINGLE["borrow"]
    forward = SINGLE["spot"] * math.exp(carry * SINGLE["maturity"])
    disc_pay = math.exp(-SINGLE["rate"] * SINGLE["maturity"])
    assert call + put == pytest.approx(disc_pay * forward, abs=1e-9)


def test_maturity_zero_is_indicator_payoff():
    price = price_digital(spot=110.0, strike=100.0, rate=0.05, div_yield=0.0, borrow=0.0,
                           maturity=0.0, option_type="call", payout_type="cash", cash=5.0,
                           vol_times=[1.0], vol_values=[0.2], value_date=0.0)
    assert price == pytest.approx(5.0, abs=1e-12)


def test_one_asset_basket_matches_single_asset_formula():
    single = price_digital(option_type="call", payout_type="cash", cash=1.0, **SINGLE)
    basket = price_digital_basket(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02],
        borrows=[0.0], maturity=1.0, option_type="call", payout_type="cash",
        vol_times_list=[[1.0]], vol_values_list=[[0.25]], correlation=1.0, cash=1.0,
        value_date=0.0,
    )
    assert basket == pytest.approx(single, abs=1e-10)


def test_identical_assets_rho_one_matches_single_asset():
    single = price_digital(option_type="put", payout_type="asset", **SINGLE)
    basket = price_digital_basket(
        spots=[100.0, 100.0, 100.0], weights=[0.5, 0.3, 0.2], strike=100.0, rate=0.05,
        div_yields=[0.02, 0.02, 0.02], borrows=[0.0, 0.0, 0.0], maturity=1.0,
        option_type="put", payout_type="asset",
        vol_times_list=[[1.0], [1.0], [1.0]], vol_values_list=[[0.25], [0.25], [0.25]],
        correlation=1.0, value_date=0.0,
    )
    assert basket == pytest.approx(single, abs=1e-8)


def test_basket_forward_matches_weighted_sum_of_forwards():
    _, forward, _ = basket_forward_and_variance(
        spots=[100.0, 90.0], weights=[0.6, 0.4], rate=0.05, div_yields=[0.02, 0.0],
        borrows=[0.0, 0.0], maturity=1.0, vol_times_list=[[1.0], [1.0]],
        vol_values_list=[[0.2], [0.3]], correlation=0.3,
    )
    expected = 0.6 * 100.0 * math.exp(0.03) + 0.4 * 90.0 * math.exp(0.05)
    assert forward == pytest.approx(expected, abs=1e-10)


# ---------------------------------------------------------- value_date -----


def test_strike_zero_cash_call_always_pays():
    price = price_digital(spot=100.0, strike=0.0, rate=0.05, div_yield=0.02, borrow=0.0,
                           maturity=1.0, option_type="call", payout_type="cash", cash=7.0,
                           vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    assert price == pytest.approx(7.0 * math.exp(-0.05), abs=1e-10)


def test_strike_zero_cash_put_worthless():
    price = price_digital(spot=100.0, strike=0.0, rate=0.05, div_yield=0.02, borrow=0.0,
                           maturity=1.0, option_type="put", payout_type="cash", cash=7.0,
                           vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    assert price == pytest.approx(0.0, abs=1e-12)


def test_strike_zero_asset_call_equals_discounted_forward():
    price = price_digital(spot=100.0, strike=0.0, rate=0.05, div_yield=0.02, borrow=0.0,
                           maturity=1.0, option_type="call", payout_type="asset",
                           vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    carry = 0.05 - 0.02
    expected = 100.0 * math.exp(carry) * math.exp(-0.05)
    assert price == pytest.approx(expected, abs=1e-10)


def test_value_date_past_payment_is_zero():
    common = dict(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                  maturity=1.0, payment_time=1.2, option_type="call", payout_type="cash",
                  cash=10.0, vol_times=[1.0], vol_values=[0.3])
    assert price_digital(value_date=1.5, **common) == pytest.approx(0.0, abs=1e-12)


def test_value_date_between_maturity_and_payment_is_fixed_discounted_payoff():
    price = price_digital(spot=110.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                           maturity=1.0, payment_time=1.3, option_type="call", payout_type="cash",
                           cash=10.0, vol_times=[1.0], vol_values=[0.3], value_date=1.1)
    assert price == pytest.approx(10.0 * math.exp(-0.05 * 0.2), abs=1e-10)


def test_basket_value_date_uses_true_realized_value_not_moment_match():
    # Once realized (value_date >= maturity), the payoff should come from
    # the ACTUAL basket value, not the 2-moment proxy.
    price = price_digital_basket(
        spots=[120.0, 80.0], weights=[0.5, 0.5], strike=95.0, rate=0.05,
        div_yields=[0.02, 0.0], borrows=[0.0, 0.0], maturity=1.0, payment_time=1.0,
        option_type="call", payout_type="cash", cash=10.0,
        vol_times_list=[[1.0], [1.0]], vol_values_list=[[0.25], [0.3]], correlation=0.5,
        value_date=1.0,
    )
    # realized basket = 0.5*120+0.5*80 = 100 > 95 -> call pays cash.
    assert price == pytest.approx(10.0, abs=1e-10)


def test_negative_value_date_rejected():
    with pytest.raises(ValueError):
        price_digital(option_type="call", payout_type="cash", **{**SINGLE, "value_date": -0.1})


# ---------------------------------------------------------------- layer 2 --


@pytest.mark.parametrize("maturity", [1e-8, 1.0 / 365.0])
def test_near_zero_maturity_finite(maturity):
    price = price_digital(spot=100.0, strike=100.0, rate=0.05, div_yield=0.0, borrow=0.0,
                           maturity=maturity, option_type="call", payout_type="cash",
                           cash=1.0, vol_times=[max(maturity, 1e-6)], vol_values=[0.3],
                           value_date=0.0)
    assert math.isfinite(price) and price >= 0.0


def test_deferred_payment_time():
    at_maturity = price_digital(payment_time=1.0, option_type="call", payout_type="cash",
                                 cash=1.0, **SINGLE)
    deferred = price_digital(payment_time=1.3, option_type="call", payout_type="cash",
                              cash=1.0, **SINGLE)
    assert deferred / at_maturity == pytest.approx(math.exp(-SINGLE["rate"] * 0.3), rel=1e-10)


# ---------------------------------------------------------------- layer 3 --


@pytest.mark.parametrize("vol", [0.001, 0.005, 5.0])
def test_vol_stress_finite(vol):
    price = price_digital(spot=100.0, strike=100.0, rate=0.05, div_yield=0.01, borrow=0.0,
                           maturity=1.0, option_type="call", payout_type="asset",
                           vol_times=[1.0], vol_values=[vol], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("correlation", [-0.49, 0.0, 0.35, 0.9, 0.99, 1.0 - 1e-9])
def test_basket_correlation_stress_finite(correlation):
    price = price_digital_basket(
        spots=[100.0, 95.0, 110.0], weights=[0.4, 0.35, 0.25], strike=100.0, rate=0.05,
        div_yields=[0.02, 0.01, 0.0], borrows=[0.0, 0.0, 0.0], maturity=1.0,
        option_type="call", payout_type="cash",
        vol_times_list=[[1.0], [1.0], [1.0]], vol_values_list=[[0.25], [0.30], [0.20]],
        correlation=correlation, cash=1.0, value_date=0.0,
    )
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("maturity", [1.0 / 365.0, 1.0, 30.0])
def test_maturity_stress_basket_finite(maturity):
    price = price_digital_basket(
        spots=[100.0, 95.0], weights=[0.6, 0.4], strike=100.0, rate=0.05,
        div_yields=[0.02, 0.0], borrows=[0.0, 0.0], maturity=maturity,
        option_type="put", payout_type="asset",
        vol_times_list=[[maturity], [maturity]], vol_values_list=[[0.25], [0.3]],
        correlation=0.4, value_date=0.0,
    )
    assert math.isfinite(price) and price >= -1e-9


# --------------------------------------------------------- benchmark check --


@pytest.mark.parametrize("opt,payout", [("call", "cash"), ("put", "cash"), ("call", "asset"), ("put", "asset")])
def test_single_asset_matches_qmc(opt, payout):
    closed = price_digital(option_type=opt, payout_type=payout, cash=10.0, **SINGLE)
    mc_price, se = qmc_price_digital(option_type=opt, payout_type=payout, cash=10.0, **SINGLE)
    assert abs(closed - mc_price) < 5.0 * max(se, 1e-8)


@pytest.mark.parametrize("correlation", [0.0, 0.35, 0.9])
def test_basket_matches_qmc_and_reports_error(correlation):
    kwargs = dict(
        spots=[100.0, 95.0, 110.0], weights=[0.4, 0.35, 0.25], strike=100.0, rate=0.05,
        div_yields=[0.02, 0.01, 0.0], borrows=[0.0, 0.0, 0.0], maturity=1.0,
        option_type="call", payout_type="cash",
        vol_times_list=[[1.0], [1.0], [1.0]], vol_values_list=[[0.25], [0.30], [0.20]],
        correlation=correlation, cash=1.0, value_date=0.0,
    )
    closed = price_digital_basket(**kwargs)
    mc_price, se = qmc_price_digital_basket(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-8) * 100.0
    print(f"basket digital rho={correlation}: closed={closed:.6f} mc={mc_price:.6f} "
          f"err={error_pct:.3f}% se={se:.6f}")
    # Known-approximate (2-moment match); bound is documented, not asserted blind.
    assert error_pct < 5.0
