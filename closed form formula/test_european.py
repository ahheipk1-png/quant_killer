"""Tests for european.py only (family 1)."""

import math

import numpy as np
import pytest

from european import effective_vol, price_european, total_variance
from european_qmc import qmc_price_european

BASE = dict(
    spot=100.0,
    strike=100.0,
    rate=0.05,
    div_yield=0.02,
    borrow=0.0,
    maturity=1.0,
    vol_times=[1.0],
    vol_values=[0.20],
    value_date=0.0,
)


# ---------------------------------------------------------------- layer 1 --
# Analytic invariants (exact, no Monte Carlo).


def test_put_call_parity():
    call = price_european(option_type="call", **BASE)
    put = price_european(option_type="put", **BASE)
    carry = BASE["rate"] - BASE["div_yield"] - BASE["borrow"]
    forward = BASE["spot"] * math.exp(carry * BASE["maturity"])
    disc_pay = math.exp(-BASE["rate"] * BASE["maturity"])
    assert call - put == pytest.approx(disc_pay * (forward - BASE["strike"]), abs=1e-10)


def test_maturity_zero_is_intrinsic():
    price = price_european(
        spot=110.0, strike=100.0, rate=0.05, div_yield=0.0, borrow=0.0,
        maturity=0.0, option_type="call", vol_times=[1.0], vol_values=[0.2], value_date=0.0,
    )
    assert price == pytest.approx(10.0, abs=1e-12)


def test_zero_vol_is_discounted_forward_intrinsic():
    price = price_european(
        spot=100.0, strike=95.0, rate=0.05, div_yield=0.0, borrow=0.0,
        maturity=1.0, option_type="call", vol_times=[1.0], vol_values=[0.0], value_date=0.0,
    )
    forward = 100.0 * math.exp(0.05)
    expected = math.exp(-0.05) * max(forward - 95.0, 0.0)
    assert price == pytest.approx(expected, abs=1e-10)


def test_single_pillar_matches_textbook_black_scholes():
    # Hand-computed reference: S=100 K=100 r=5% q=2% sigma=20% T=1.
    price = price_european(option_type="call", **BASE)
    carry = 0.05 - 0.02
    forward = 100.0 * math.exp(carry * 1.0)
    w = 0.20 * 0.20 * 1.0
    d1 = (math.log(forward / 100.0) + 0.5 * w) / math.sqrt(w)
    d2 = d1 - math.sqrt(w)
    from scipy.stats import norm
    expected = math.exp(-0.05) * (forward * norm.cdf(d1) - 100.0 * norm.cdf(d2))
    assert price == pytest.approx(expected, abs=1e-12)


def test_flat_multi_pillar_curve_matches_constant_vol():
    flat = price_european(
        spot=100.0, strike=105.0, rate=0.04, div_yield=0.01, borrow=0.0,
        maturity=1.5, option_type="put", vol_times=[1.5], vol_values=[0.25], value_date=0.0,
    )
    multi = price_european(
        spot=100.0, strike=105.0, rate=0.04, div_yield=0.01, borrow=0.0,
        maturity=1.5, option_type="put",
        vol_times=[0.5, 1.0, 1.5, 2.0], vol_values=[0.25, 0.25, 0.25, 0.25], value_date=0.0,
    )
    assert multi == pytest.approx(flat, abs=1e-10)


def test_deferred_payment_only_rescales_discounting():
    at_maturity = price_european(payment_time=1.0, option_type="call", **BASE)
    deferred = price_european(payment_time=1.5, option_type="call", **BASE)
    ratio = deferred / at_maturity
    assert ratio == pytest.approx(math.exp(-BASE["rate"] * 0.5), rel=1e-12)


def test_payment_before_maturity_rejected():
    with pytest.raises(ValueError):
        price_european(payment_time=0.5, option_type="call", **BASE)


def test_decreasing_forward_variance_curve_rejected():
    with pytest.raises(ValueError):
        total_variance([0.5, 1.0], [0.40, 0.10], 1.0)


def test_effective_vol_recovers_single_pillar():
    assert effective_vol([1.0], [0.30], 1.0) == pytest.approx(0.30, abs=1e-12)


def test_vectorised_spot_matches_scalar_loop():
    spots = np.array([80.0, 100.0, 120.0])
    vector_price = price_european(spot=spots, strike=100.0, rate=0.05, div_yield=0.02,
                                   borrow=0.0, maturity=1.0, option_type="call",
                                   vol_times=[1.0], vol_values=[0.2], value_date=0.0)
    scalar_prices = np.array([
        price_european(spot=s, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                        maturity=1.0, option_type="call", vol_times=[1.0], vol_values=[0.2],
                        value_date=0.0)
        for s in spots
    ])
    assert vector_price == pytest.approx(scalar_prices, abs=1e-12)


# ---------------------------------------------------------- value_date -----


def test_strike_zero_put_is_worthless():
    price = price_european(spot=100.0, strike=0.0, rate=0.05, div_yield=0.02, borrow=0.0,
                            maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[0.3],
                            value_date=0.0)
    assert price == pytest.approx(0.0, abs=1e-12)


def test_strike_zero_call_equals_discounted_forward():
    price = price_european(spot=100.0, strike=0.0, rate=0.05, div_yield=0.02, borrow=0.0,
                            maturity=1.0, option_type="call", vol_times=[1.0], vol_values=[0.3],
                            value_date=0.0)
    carry = 0.05 - 0.02
    expected = 100.0 * math.exp(carry * 1.0) * math.exp(-0.05 * 1.0)
    assert price == pytest.approx(expected, abs=1e-10)


def test_value_date_past_payment_is_zero():
    common = dict(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                  maturity=1.0, payment_time=1.2, option_type="call",
                  vol_times=[1.0], vol_values=[0.3])
    assert price_european(value_date=1.5, **common) == pytest.approx(0.0, abs=1e-12)


def test_value_date_exactly_at_payment_gives_undiscounted_intrinsic():
    price = price_european(spot=110.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                            maturity=1.0, payment_time=1.2, option_type="call",
                            vol_times=[1.0], vol_values=[0.3], value_date=1.2)
    assert price == pytest.approx(10.0, abs=1e-10)


def test_value_date_between_maturity_and_payment_is_fixed_discounted_payoff():
    # spot here represents the already-realized S(maturity); no more
    # uncertainty, so the price is just the discounted intrinsic.
    price = price_european(spot=110.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                            maturity=1.0, payment_time=1.3, option_type="call",
                            vol_times=[1.0], vol_values=[0.3], value_date=1.1)
    expected = 10.0 * math.exp(-0.05 * (1.3 - 1.1))
    assert price == pytest.approx(expected, abs=1e-10)


def test_value_date_zero_matches_no_value_date_semantics():
    # value_date=0 should reproduce exactly what the old implicit-today
    # convention gave.
    price = price_european(option_type="put", **BASE)
    manual = price_european(
        spot=BASE["spot"], strike=BASE["strike"], rate=BASE["rate"], div_yield=BASE["div_yield"],
        borrow=BASE["borrow"], maturity=BASE["maturity"], option_type="put",
        vol_times=BASE["vol_times"], vol_values=BASE["vol_values"], value_date=0.0,
    )
    assert price == pytest.approx(manual, abs=1e-12)


def test_value_date_partway_matches_shifted_horizon():
    # Pricing as of value_date=0.4 with maturity=1.0 should equal pricing
    # with maturity=0.6 (the remaining horizon) as of value_date=0.
    partway = price_european(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                              maturity=1.0, option_type="call", vol_times=[1.0], vol_values=[0.3],
                              value_date=0.4)
    shifted = price_european(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                              maturity=0.6, option_type="call", vol_times=[0.6], vol_values=[0.3],
                              value_date=0.0)
    assert partway == pytest.approx(shifted, abs=1e-10)


def test_negative_value_date_rejected():
    with pytest.raises(ValueError):
        price_european(option_type="call", **{**BASE, "value_date": -0.1})


# ---------------------------------------------------------------- layer 2 --
# Boundary cases.


@pytest.mark.parametrize("maturity", [1e-8, 1.0 / 365.0, 0.0])
def test_near_zero_and_one_day_maturity_finite(maturity):
    price = price_european(spot=100.0, strike=100.0, rate=0.05, div_yield=0.01,
                            borrow=0.0, maturity=maturity, option_type="call",
                            vol_times=[max(maturity, 1e-6)], vol_values=[0.3], value_date=0.0)
    assert math.isfinite(price) and price >= 0.0


@pytest.mark.parametrize("strike", [0.0, 1e-6, 1e6])
def test_extreme_strike_finite(strike):
    for opt in ("call", "put"):
        price = price_european(spot=100.0, strike=strike, rate=0.05, div_yield=0.0,
                                borrow=0.0, maturity=1.0, option_type=opt,
                                vol_times=[1.0], vol_values=[0.25], value_date=0.0)
        assert math.isfinite(price) and price >= -1e-9


# ---------------------------------------------------------------- layer 3 --
# Market-data stress.


@pytest.mark.parametrize("vol", [0.001, 0.005, 0.01, 0.5, 2.0, 5.0])
def test_vol_stress_finite_nonnegative(vol):
    for opt in ("call", "put"):
        price = price_european(spot=100.0, strike=100.0, rate=0.05, div_yield=0.01,
                                borrow=0.0, maturity=1.0, option_type=opt,
                                vol_times=[1.0], vol_values=[vol], value_date=0.0)
        assert math.isfinite(price)
        assert price >= -1e-9


@pytest.mark.parametrize("rate", [-0.05, 0.0, 0.20])
@pytest.mark.parametrize("div_yield,borrow", [(-0.10, -0.05), (0.0, 0.0), (0.15, 0.10)])
def test_rate_carry_stress_finite(rate, div_yield, borrow):
    price = price_european(spot=100.0, strike=100.0, rate=rate, div_yield=div_yield,
                            borrow=borrow, maturity=1.0, option_type="call",
                            vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("maturity", [1.0 / 365.0, 1.0, 10.0, 30.0])
def test_maturity_stress_finite(maturity):
    price = price_european(spot=100.0, strike=100.0, rate=0.03, div_yield=0.01,
                            borrow=0.0, maturity=maturity, option_type="put",
                            vol_times=[maturity], vol_values=[0.25], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


def test_near_worthless_option_absolute_tolerance():
    # Deep OTM short-dated: relative error is meaningless here, so the
    # invariant checked is an absolute bound, not a percentage.
    price = price_european(spot=100.0, strike=200.0, rate=0.05, div_yield=0.0,
                            borrow=0.0, maturity=0.1, option_type="call",
                            vol_times=[0.1], vol_values=[0.15], value_date=0.0)
    assert 0.0 <= price < 1e-6


# --------------------------------------------------------- benchmark check --


@pytest.mark.parametrize("strike,maturity,vol,opt", [
    (90.0, 0.5, 0.15, "call"),
    (100.0, 1.0, 0.30, "put"),
    (120.0, 2.0, 0.45, "call"),
])
def test_matches_qmc_within_a_few_standard_errors(strike, maturity, vol, opt):
    closed = price_european(spot=100.0, strike=strike, rate=0.04, div_yield=0.015,
                             borrow=0.0, maturity=maturity, option_type=opt,
                             vol_times=[maturity], vol_values=[vol], value_date=0.0)
    mc_price, se = qmc_price_european(spot=100.0, strike=strike, rate=0.04, div_yield=0.015,
                                       borrow=0.0, maturity=maturity, option_type=opt,
                                       vol_times=[maturity], vol_values=[vol], value_date=0.0)
    assert abs(closed - mc_price) < 5.0 * max(se, 1e-8)


def test_sloped_term_vol_matches_qmc():
    vol_times = [0.25, 1.0, 2.0]
    vol_values = [0.15, 0.25, 0.35]
    maturity = 1.5
    closed = price_european(spot=100.0, strike=105.0, rate=0.04, div_yield=0.01,
                             borrow=0.0, maturity=maturity, option_type="call",
                             vol_times=vol_times, vol_values=vol_values, value_date=0.0)
    mc_price, se = qmc_price_european(spot=100.0, strike=105.0, rate=0.04, div_yield=0.01,
                                       borrow=0.0, maturity=maturity, option_type="call",
                                       vol_times=vol_times, vol_values=vol_values, value_date=0.0)
    assert abs(closed - mc_price) < 5.0 * max(se, 1e-8)
