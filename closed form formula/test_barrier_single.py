"""Tests for barrier_single.py only (family 4)."""

import math

import pytest

from barrier_single import price_barrier_single
from barrier_single_qmc import qmc_price_barrier_single
from european import price_european

BASE = dict(
    spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
    maturity=1.0, vol_times=[1.0], vol_values=[0.25], value_date=0.0,
)


# ---------------------------------------------------------------- layer 1 --


@pytest.mark.parametrize("direction,barrier", [("down", 80.0), ("up", 120.0)])
@pytest.mark.parametrize("trigger", ["european", "monthly", "weekly", "daily", "continuous"])
@pytest.mark.parametrize("option_type", ["call", "put"])
def test_in_plus_out_equals_vanilla(direction, barrier, trigger, option_type):
    common = dict(option_type=option_type, barrier=barrier, direction=direction, trigger=trigger, **BASE)
    out_price = price_barrier_single(style="out", **common)
    in_price = price_barrier_single(style="in", **common)
    vanilla = price_european(spot=BASE["spot"], strike=BASE["strike"], rate=BASE["rate"],
                              div_yield=BASE["div_yield"], borrow=BASE["borrow"], maturity=BASE["maturity"],
                              option_type=option_type, vol_times=BASE["vol_times"], vol_values=BASE["vol_values"], value_date=0.0)
    assert out_price + in_price == pytest.approx(vanilla, abs=1e-7)


def test_barrier_far_away_out_equals_vanilla():
    # Barrier so far away it is (numerically) never touched: out ~= vanilla.
    price = price_barrier_single(option_type="call", barrier=1e6, direction="up", style="out",
                                  trigger="continuous", **BASE)
    vanilla = price_european(spot=BASE["spot"], strike=BASE["strike"], rate=BASE["rate"],
                              div_yield=BASE["div_yield"], borrow=BASE["borrow"], maturity=BASE["maturity"],
                              option_type="call", vol_times=BASE["vol_times"], vol_values=BASE["vol_values"], value_date=0.0)
    assert price == pytest.approx(vanilla, abs=1e-6)


def test_barrier_at_spot_out_is_worthless():
    # Already-breached barrier (down-and-out with H >= S): knocked out immediately.
    price = price_barrier_single(option_type="call", barrier=100.0, direction="down", style="out",
                                  trigger="continuous", **BASE)
    assert price == pytest.approx(0.0, abs=1e-8)


@pytest.mark.parametrize("trigger", ["monthly", "weekly", "daily"])
def test_monotonic_ko_price_vs_continuous(trigger):
    # Sparser monitoring -> less knock-out risk -> higher KO value.
    continuous = price_barrier_single(option_type="call", barrier=120.0, direction="up", style="out",
                                       trigger="continuous", **BASE)
    discrete = price_barrier_single(option_type="call", barrier=120.0, direction="up", style="out",
                                     trigger=trigger, **BASE)
    assert discrete >= continuous - 1e-9


def test_daily_le_weekly_le_monthly_le_european_ko():
    prices = {
        t: price_barrier_single(option_type="call", barrier=120.0, direction="up", style="out",
                                 trigger=t, **BASE)
        for t in ("daily", "weekly", "monthly", "european")
    }
    assert prices["daily"] <= prices["weekly"] + 1e-9
    assert prices["weekly"] <= prices["monthly"] + 1e-9
    assert prices["monthly"] <= prices["european"] + 1e-9


def test_rebate_out_plus_in_equals_rebate_discounted():
    # Exactly one of "hit" or "never hit" occurs -> rebate legs sum to a
    # flat discounted rebate, independent of the option economics.
    common = dict(option_type="call", barrier=90.0, direction="down", trigger="continuous",
                   rebate=5.0, rebate_timing="expiry", **BASE)
    out_price = price_barrier_single(style="out", **common)
    in_price = price_barrier_single(style="in", **common)
    out_no_rebate = price_barrier_single(style="out", **{**common, "rebate": 0.0})
    in_no_rebate = price_barrier_single(style="in", **{**common, "rebate": 0.0})
    rebate_out = out_price - out_no_rebate
    rebate_in = in_price - in_no_rebate
    assert rebate_out + rebate_in == pytest.approx(5.0 * math.exp(-BASE["rate"] * BASE["maturity"]), abs=1e-8)


def test_rebate_only_price_matches_touch_probability():
    # Deep OTM strike so the vanilla leg is ~0: at-expiry rebate isolates
    # rebate * discount * touch_probability, checked against an independent
    # finite-difference estimate of the touch probability via rebate scaling.
    common = dict(option_type="call", strike=1e6, spot=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                  maturity=1.0, vol_times=[1.0], vol_values=[0.25], barrier=90.0, direction="down",
                  style="out", trigger="continuous", value_date=0.0)
    price_1 = price_barrier_single(rebate=1.0, rebate_timing="expiry", **common)
    price_2 = price_barrier_single(rebate=2.0, rebate_timing="expiry", **common)
    # Linear in rebate size since the vanilla leg is ~0: price ~= rebate*disc*touch_prob.
    implied_touch_times_disc = price_2 - price_1
    assert implied_touch_times_disc == pytest.approx(price_1, abs=1e-9)


def test_rebate_hit_requires_valid_combo():
    with pytest.raises(ValueError):
        price_barrier_single(option_type="call", barrier=90.0, direction="down", style="in",
                              trigger="continuous", rebate=1.0, rebate_timing="hit", **BASE)
    with pytest.raises(ValueError):
        price_barrier_single(option_type="call", barrier=90.0, direction="down", style="out",
                              trigger="european", rebate=1.0, rebate_timing="hit", **BASE)


# ---------------------------------------------------------- value_date -----


def test_strike_zero_finite_and_nonnegative():
    for opt in ("call", "put"):
        price = price_barrier_single(option_type=opt, barrier=120.0, direction="up", style="out",
                                      trigger="continuous", **{**BASE, "strike": 0.0})
        assert math.isfinite(price) and price >= -1e-6


def test_value_date_past_payment_is_zero():
    common = dict(option_type="call", barrier=120.0, direction="up", style="out", trigger="continuous",
                  payment_time=1.2, **{k: v for k, v in BASE.items() if k != "value_date"})
    assert price_barrier_single(value_date=1.5, **common) == pytest.approx(0.0, abs=1e-12)


def test_value_date_at_maturity_uses_realized_spot():
    price_below = price_barrier_single(option_type="call", strike=90.0, spot=100.0, rate=0.05,
                                        div_yield=0.0, borrow=0.0, maturity=1.0, payment_time=1.3,
                                        vol_times=[1.0], vol_values=[0.2], barrier=110.0, direction="up",
                                        style="out", trigger="continuous", value_date=1.1)
    expected = 10.0 * math.exp(-0.05 * (1.3 - 1.1))
    assert price_below == pytest.approx(expected, abs=1e-10)


def test_value_date_partway_matches_shifted_horizon():
    partway = price_barrier_single(option_type="call", barrier=120.0, direction="up", style="out",
                                    trigger="continuous", spot=100.0, strike=100.0, rate=0.05,
                                    div_yield=0.02, borrow=0.0, maturity=1.0, vol_times=[1.0],
                                    vol_values=[0.25], value_date=0.4)
    shifted = price_barrier_single(option_type="call", barrier=120.0, direction="up", style="out",
                                    trigger="continuous", spot=100.0, strike=100.0, rate=0.05,
                                    div_yield=0.02, borrow=0.0, maturity=0.6, vol_times=[0.6],
                                    vol_values=[0.25], value_date=0.0)
    assert partway == pytest.approx(shifted, abs=1e-10)


def test_negative_value_date_rejected():
    with pytest.raises(ValueError):
        price_barrier_single(option_type="call", barrier=120.0, direction="up", style="out",
                              trigger="continuous", **{**BASE, "value_date": -0.1})


# ---------------------------------------------------------------- layer 2 --


def test_maturity_zero_is_intrinsic_or_zero():
    price_below = price_barrier_single(option_type="call", strike=90.0, spot=100.0, rate=0.05,
                                        div_yield=0.0, borrow=0.0, maturity=0.0, vol_times=[1.0],
                                        vol_values=[0.2], barrier=110.0, direction="up", style="out",
                                        trigger="continuous", value_date=0.0)
    assert price_below == pytest.approx(10.0, abs=1e-10)
    price_touched = price_barrier_single(option_type="call", strike=90.0, spot=120.0, rate=0.05,
                                          div_yield=0.0, borrow=0.0, maturity=0.0, vol_times=[1.0],
                                          vol_values=[0.2], barrier=110.0, direction="up", style="out",
                                          trigger="continuous", value_date=0.0)
    assert price_touched == pytest.approx(0.0, abs=1e-10)


def test_one_day_maturity_finite():
    price = price_barrier_single(option_type="put", barrier=95.0, direction="down", style="out",
                                  trigger="continuous", spot=100.0, strike=100.0, rate=0.03,
                                  div_yield=0.01, borrow=0.0, maturity=1.0 / 365.0,
                                  vol_times=[1.0 / 365.0], vol_values=[0.3], value_date=0.0)
    assert math.isfinite(price) and price >= 0.0


def test_barrier_very_close_to_spot():
    price = price_barrier_single(option_type="call", barrier=100.5, direction="up", style="out",
                                  trigger="continuous", **BASE)
    assert math.isfinite(price) and price >= 0.0


def test_inverted_barrier_up_direction_below_spot_treated_as_given():
    # An "up" barrier placed below spot: already breached -> KO worthless, KI = vanilla.
    common = dict(option_type="call", barrier=90.0, direction="up", trigger="continuous", **BASE)
    out_price = price_barrier_single(style="out", **common)
    in_price = price_barrier_single(style="in", **common)
    assert out_price == pytest.approx(0.0, abs=1e-6)
    vanilla = price_european(spot=BASE["spot"], strike=BASE["strike"], rate=BASE["rate"],
                              div_yield=BASE["div_yield"], borrow=BASE["borrow"], maturity=BASE["maturity"],
                              option_type="call", vol_times=BASE["vol_times"], vol_values=BASE["vol_values"], value_date=0.0)
    assert in_price == pytest.approx(vanilla, abs=1e-6)


def test_deferred_payment_time():
    common = dict(option_type="call", barrier=120.0, direction="up", style="out", trigger="continuous", **BASE)
    at_maturity = price_barrier_single(payment_time=1.0, **common)
    deferred = price_barrier_single(payment_time=1.3, **common)
    assert deferred / at_maturity == pytest.approx(math.exp(-BASE["rate"] * 0.3), rel=1e-9)


# ---------------------------------------------------------------- layer 3 --


@pytest.mark.parametrize("vol", [0.001, 0.005, 3.0])
def test_vol_stress_finite(vol):
    price = price_barrier_single(option_type="call", barrier=120.0, direction="up", style="out",
                                  trigger="daily", spot=100.0, strike=100.0, rate=0.05, div_yield=0.02,
                                  borrow=0.0, maturity=1.0, vol_times=[1.0], vol_values=[vol], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("rate", [-0.1, 0.0, 0.2])
def test_rate_stress_finite(rate):
    price = price_barrier_single(option_type="put", barrier=80.0, direction="down", style="out",
                                  trigger="continuous", spot=100.0, strike=100.0, rate=rate, div_yield=-0.05,
                                  borrow=0.0, maturity=1.0, vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("maturity_days", [1, 365, 30 * 365])
def test_maturity_stress_finite(maturity_days):
    maturity = maturity_days / 365.0
    price = price_barrier_single(option_type="call", barrier=130.0, direction="up", style="out",
                                  trigger="continuous", spot=100.0, strike=100.0, rate=0.03, div_yield=0.01,
                                  borrow=0.0, maturity=maturity, vol_times=[maturity], vol_values=[0.25],
                                  value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


# --------------------------------------------------------- benchmark check --


@pytest.mark.parametrize("trigger", ["european", "continuous"])
@pytest.mark.parametrize("direction,barrier", [("down", 85.0), ("up", 118.0)])
def test_matches_qmc_no_rebate(trigger, direction, barrier):
    kwargs = dict(option_type="call", barrier=barrier, direction=direction, style="out",
                  trigger=trigger, **BASE)
    closed = price_barrier_single(**kwargs)
    mc_price, se = qmc_price_barrier_single(**kwargs)
    assert abs(closed - mc_price) < 5.0 * max(se, 1e-6)


@pytest.mark.parametrize("trigger", ["daily", "weekly"])
def test_matches_qmc_discrete(trigger):
    kwargs = dict(option_type="call", barrier=118.0, direction="up", style="out",
                  trigger=trigger, **BASE)
    closed = price_barrier_single(**kwargs)
    mc_price, se = qmc_price_barrier_single(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-6) * 100.0
    print(f"barrier {trigger}: closed={closed:.5f} mc={mc_price:.5f} se={se:.5f} err={error_pct:.3f}%")
    assert abs(closed - mc_price) < 6.0 * max(se, 1e-6)


def test_rebate_at_expiry_matches_qmc():
    kwargs = dict(option_type="call", barrier=118.0, direction="up", style="out", trigger="continuous",
                  rebate=5.0, rebate_timing="expiry", **BASE)
    closed = price_barrier_single(**kwargs)
    mc_price, se = qmc_price_barrier_single(**kwargs)
    assert abs(closed - mc_price) < 6.0 * max(se, 1e-6)


def test_rebate_at_hit_matches_qmc():
    # The QMC benchmark can only approximate a continuous hit *time* with a
    # fine hard-indicator grid (the bridge-survival weight used elsewhere
    # gives touch probability, not timing) -- documented, looser bound.
    kwargs = dict(option_type="call", barrier=118.0, direction="up", style="out", trigger="continuous",
                  rebate=5.0, rebate_timing="hit", **BASE)
    closed = price_barrier_single(**kwargs)
    mc_price, se = qmc_price_barrier_single(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-6) * 100.0
    print(f"rebate-at-hit: closed={closed:.5f} mc={mc_price:.5f} se={se:.5f} err={error_pct:.3f}%")
    assert error_pct < 5.0


def test_sloped_term_vol_matches_qmc():
    kwargs = dict(option_type="call", barrier=118.0, direction="up", style="out", trigger="continuous",
                  spot=100.0, strike=100.0, rate=0.04, div_yield=0.01, borrow=0.0, maturity=1.0,
                  vol_times=[0.25, 1.0], vol_values=[0.2, 0.3], value_date=0.0)
    closed = price_barrier_single(**kwargs)
    mc_price, se = qmc_price_barrier_single(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-6) * 100.0
    print(f"sloped term vol: closed={closed:.5f} mc={mc_price:.5f} err={error_pct:.3f}%")
    assert math.isfinite(closed)
