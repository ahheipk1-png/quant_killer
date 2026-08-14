"""Tests for barrier_double.py only (family 5)."""

import math

import pytest

from barrier_double import price_barrier_double, _survival_probability, effective_vol
from barrier_double_qmc import qmc_price_barrier_double
from european import price_european

BASE = dict(
    spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
    maturity=1.0, vol_times=[1.0], vol_values=[0.25], value_date=0.0,
)


# ---------------------------------------------------------------- layer 1 --


@pytest.mark.parametrize("trigger", ["european", "monthly", "weekly", "daily", "continuous"])
@pytest.mark.parametrize("option_type", ["call", "put"])
def test_in_plus_out_equals_vanilla(trigger, option_type):
    common = dict(option_type=option_type, lower_barrier=80.0, upper_barrier=130.0, trigger=trigger, **BASE)
    out_price = price_barrier_double(style="out", **common)
    in_price = price_barrier_double(style="in", **common)
    vanilla = price_european(spot=BASE["spot"], strike=BASE["strike"], rate=BASE["rate"],
                              div_yield=BASE["div_yield"], borrow=BASE["borrow"], maturity=BASE["maturity"],
                              option_type=option_type, vol_times=BASE["vol_times"], vol_values=BASE["vol_values"], value_date=0.0)
    assert out_price + in_price == pytest.approx(vanilla, abs=1e-6)


def test_wide_barriers_out_equals_vanilla():
    price = price_barrier_double(option_type="call", lower_barrier=1.0, upper_barrier=1e7, style="out",
                                  trigger="continuous", **BASE)
    vanilla = price_european(spot=BASE["spot"], strike=BASE["strike"], rate=BASE["rate"],
                              div_yield=BASE["div_yield"], borrow=BASE["borrow"], maturity=BASE["maturity"],
                              option_type="call", vol_times=BASE["vol_times"], vol_values=BASE["vol_values"], value_date=0.0)
    assert price == pytest.approx(vanilla, abs=1e-3)


def test_already_breached_out_worthless_in_equals_vanilla():
    common = dict(option_type="call", lower_barrier=80.0, upper_barrier=90.0, trigger="continuous", **BASE)
    out_price = price_barrier_double(style="out", **common)  # spot=100 outside [80,90]
    in_price = price_barrier_double(style="in", **common)
    assert out_price == pytest.approx(0.0, abs=1e-10)
    vanilla = price_european(spot=BASE["spot"], strike=BASE["strike"], rate=BASE["rate"],
                              div_yield=BASE["div_yield"], borrow=BASE["borrow"], maturity=BASE["maturity"],
                              option_type="call", vol_times=BASE["vol_times"], vol_values=BASE["vol_values"], value_date=0.0)
    assert in_price == pytest.approx(vanilla, abs=1e-10)


@pytest.mark.parametrize("trigger", ["monthly", "weekly", "daily"])
def test_monotonic_ko_price_vs_continuous(trigger):
    continuous = price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                       trigger="continuous", **BASE)
    discrete = price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                     trigger=trigger, **BASE)
    assert discrete >= continuous - 1e-9


def test_daily_le_weekly_le_monthly_le_european_ko():
    prices = {
        t: price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                 trigger=t, **BASE)
        for t in ("daily", "weekly", "monthly", "european")
    }
    assert prices["daily"] <= prices["weekly"] + 1e-9
    assert prices["weekly"] <= prices["monthly"] + 1e-9
    assert prices["monthly"] <= prices["european"] + 1e-9


def test_survival_probability_at_zero_is_one():
    # S(0) = sum_n c_n = 1 exactly -- the identity the rebate-at-hit tail
    # correction depends on; check it directly, not just through a price.
    prob = _survival_probability(100.0, 0.03, 0.25, 1e-9, 80.0, 130.0)
    assert prob == pytest.approx(1.0, abs=1e-6)


def test_rebate_out_plus_in_equals_rebate_discounted():
    common = dict(option_type="call", lower_barrier=85.0, upper_barrier=125.0, trigger="continuous",
                   rebate=5.0, rebate_timing="expiry", **BASE)
    out_price = price_barrier_double(style="out", **common)
    in_price = price_barrier_double(style="in", **common)
    out_no_rebate = price_barrier_double(style="out", **{**common, "rebate": 0.0})
    in_no_rebate = price_barrier_double(style="in", **{**common, "rebate": 0.0})
    rebate_out = out_price - out_no_rebate
    rebate_in = in_price - in_no_rebate
    assert rebate_out + rebate_in == pytest.approx(5.0 * math.exp(-BASE["rate"] * BASE["maturity"]), abs=1e-8)


def test_rebate_hit_requires_valid_combo():
    with pytest.raises(ValueError):
        price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="in",
                              trigger="continuous", rebate=1.0, rebate_timing="hit", **BASE)
    with pytest.raises(ValueError):
        price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                              trigger="european", rebate=1.0, rebate_timing="hit", **BASE)


# ---------------------------------------------------------------- layer 2 --


def test_maturity_zero_is_intrinsic_or_zero():
    price = price_barrier_double(option_type="call", strike=90.0, spot=100.0, rate=0.05, div_yield=0.0,
                                  borrow=0.0, maturity=0.0, vol_times=[1.0], vol_values=[0.2],
                                  lower_barrier=80.0, upper_barrier=130.0, style="out", trigger="continuous",
                                  value_date=0.0)
    assert price == pytest.approx(10.0, abs=1e-10)


def test_one_day_maturity_finite():
    price = price_barrier_double(option_type="put", lower_barrier=95.0, upper_barrier=105.0, style="out",
                                  trigger="continuous", spot=100.0, strike=100.0, rate=0.03, div_yield=0.01,
                                  borrow=0.0, maturity=1.0 / 365.0, vol_times=[1.0 / 365.0], vol_values=[0.3],
                                  value_date=0.0)
    assert math.isfinite(price) and price >= 0.0


def test_narrow_corridor_near_spot():
    price = price_barrier_double(option_type="call", lower_barrier=99.0, upper_barrier=101.0, style="out",
                                  trigger="continuous", **BASE)
    assert math.isfinite(price) and price >= 0.0


def test_deferred_payment_time():
    common = dict(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                  trigger="continuous", **BASE)
    at_maturity = price_barrier_double(payment_time=1.0, **common)
    deferred = price_barrier_double(payment_time=1.3, **common)
    assert deferred / at_maturity == pytest.approx(math.exp(-BASE["rate"] * 0.3), rel=1e-9)


def test_invalid_barrier_ordering_rejected():
    with pytest.raises(ValueError):
        price_barrier_double(option_type="call", lower_barrier=130.0, upper_barrier=80.0, style="out",
                              trigger="continuous", **BASE)


# ------------------------------------------------------- already_touched ---


def test_touched_out_is_dead():
    price = price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                  trigger="continuous", already_touched=True, **BASE)
    assert price == pytest.approx(0.0, abs=1e-12)


def test_touched_out_expiry_rebate_still_owed():
    price = price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                  trigger="continuous", already_touched=True,
                                  rebate=5.0, rebate_timing="expiry", **BASE)
    assert price == pytest.approx(5.0 * math.exp(-BASE["rate"] * BASE["maturity"]), abs=1e-10)


def test_touched_in_equals_vanilla_european():
    price = price_barrier_double(option_type="put", lower_barrier=80.0, upper_barrier=130.0, style="in",
                                  trigger="continuous", already_touched=True, **BASE)
    vanilla = price_european(spot=BASE["spot"], strike=BASE["strike"], rate=BASE["rate"],
                              div_yield=BASE["div_yield"], borrow=BASE["borrow"], maturity=BASE["maturity"],
                              option_type="put", vol_times=BASE["vol_times"], vol_values=BASE["vol_values"],
                              value_date=0.0)
    assert price == pytest.approx(vanilla, abs=1e-9)


def test_touched_rejected_for_european_trigger():
    with pytest.raises(ValueError):
        price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                              trigger="european", already_touched=True, **BASE)


def test_breached_now_hit_rebate_is_undiscounted():
    # Spot already beyond a barrier and not previously flagged: the hit
    # happens NOW, so a rebate-at-hit's PV is the full rebate (this was
    # previously wrongly discounted by the whole remaining maturity).
    common = {k: v for k, v in BASE.items() if k != "spot"}
    price = price_barrier_double(spot=140.0, option_type="call", lower_barrier=80.0, upper_barrier=130.0,
                                  style="out", trigger="continuous", rebate=5.0, rebate_timing="hit",
                                  **common)
    assert price == pytest.approx(5.0, abs=1e-9)


def test_vectorised_spot_matches_scalar_loop():
    import numpy as np
    spots = np.array([85.0, 100.0, 115.0, 125.0, 140.0])
    common = {k: v for k, v in BASE.items() if k != "spot"}
    vector = price_barrier_double(spot=spots, option_type="call", lower_barrier=80.0, upper_barrier=130.0,
                                   style="out", trigger="continuous", **common)
    scalars = np.array([
        float(price_barrier_double(spot=s, option_type="call", lower_barrier=80.0, upper_barrier=130.0,
                                    style="out", trigger="continuous", **common))
        for s in spots
    ])
    assert vector == pytest.approx(scalars, abs=1e-10)


# ---------------------------------------------------------- value_date -----


def test_strike_zero_finite_and_nonnegative():
    for opt in ("call", "put"):
        price = price_barrier_double(option_type=opt, lower_barrier=80.0, upper_barrier=130.0, style="out",
                                      trigger="continuous", **{**BASE, "strike": 0.0})
        assert math.isfinite(price) and price >= -1e-6


def test_value_date_past_payment_is_zero():
    common = {k: v for k, v in BASE.items() if k != "value_date"}
    price = price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                  trigger="continuous", payment_time=1.2, value_date=1.5, **common)
    assert price == pytest.approx(0.0, abs=1e-12)


def test_value_date_at_maturity_uses_realized_spot():
    price = price_barrier_double(option_type="call", strike=90.0, spot=100.0, rate=0.05, div_yield=0.0,
                                  borrow=0.0, maturity=1.0, payment_time=1.3, vol_times=[1.0], vol_values=[0.2],
                                  lower_barrier=80.0, upper_barrier=130.0, style="out", trigger="continuous",
                                  value_date=1.1)
    expected = 10.0 * math.exp(-0.05 * (1.3 - 1.1))
    assert price == pytest.approx(expected, abs=1e-10)


def test_value_date_partway_matches_shifted_horizon():
    partway = price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                    trigger="continuous", spot=100.0, strike=100.0, rate=0.05, div_yield=0.02,
                                    borrow=0.0, maturity=1.0, vol_times=[1.0], vol_values=[0.25], value_date=0.4)
    shifted = price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                    trigger="continuous", spot=100.0, strike=100.0, rate=0.05, div_yield=0.02,
                                    borrow=0.0, maturity=0.6, vol_times=[0.6], vol_values=[0.25], value_date=0.0)
    assert partway == pytest.approx(shifted, abs=1e-10)


def test_negative_value_date_rejected():
    with pytest.raises(ValueError):
        price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                              trigger="continuous", **{**BASE, "value_date": -0.1})


# ---------------------------------------------------------------- layer 3 --


@pytest.mark.parametrize("vol", [0.02, 0.05, 3.0])
def test_vol_stress_finite(vol):
    price = price_barrier_double(option_type="call", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                  trigger="daily", spot=100.0, strike=100.0, rate=0.05, div_yield=0.02,
                                  borrow=0.0, maturity=1.0, vol_times=[1.0], vol_values=[vol], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("rate", [-0.1, 0.0, 0.2])
def test_rate_stress_finite(rate):
    price = price_barrier_double(option_type="put", lower_barrier=80.0, upper_barrier=130.0, style="out",
                                  trigger="continuous", spot=100.0, strike=100.0, rate=rate, div_yield=-0.05,
                                  borrow=0.0, maturity=1.0, vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("maturity_days", [1, 365, 30 * 365])
def test_maturity_stress_finite(maturity_days):
    maturity = maturity_days / 365.0
    price = price_barrier_double(option_type="call", lower_barrier=70.0, upper_barrier=150.0, style="out",
                                  trigger="continuous", spot=100.0, strike=100.0, rate=0.03, div_yield=0.01,
                                  borrow=0.0, maturity=maturity, vol_times=[maturity], vol_values=[0.25],
                                  value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


# --------------------------------------------------------- benchmark check --


def test_matches_qmc_no_rebate_european():
    kwargs = dict(option_type="call", lower_barrier=82.0, upper_barrier=122.0, style="out",
                  trigger="european", **BASE)
    closed = price_barrier_double(**kwargs)
    mc_price, se = qmc_price_barrier_double(**kwargs)
    assert abs(closed - mc_price) < 8.0 * max(se, 1e-6)


def test_matches_qmc_no_rebate_continuous():
    # A double barrier's continuous-monitoring crossing probability has no
    # simple closed form, so the QMC benchmark can only proxy it with a
    # dense discrete grid -- discretization bias shrinks like O(1/sqrt(m))
    # and converges slowly (confirmed by hand via a step-count sweep:
    # 1024/2048/4096/8192 steps/year gave 0.732/0.706/0.684/0.677,
    # extrapolating to ~0.66, consistent with the closed form's 0.653).
    # Documented relative bound + printed error, not a tight SE multiple.
    kwargs = dict(option_type="call", lower_barrier=82.0, upper_barrier=122.0, style="out",
                  trigger="continuous", **BASE)
    closed = price_barrier_double(**kwargs)
    mc_price, se = qmc_price_barrier_double(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-6) * 100.0
    print(f"double barrier continuous: closed={closed:.5f} mc={mc_price:.5f} se={se:.5f} err={error_pct:.3f}%")
    assert error_pct < 8.0


@pytest.mark.parametrize("trigger", ["daily", "weekly"])
def test_matches_qmc_discrete(trigger):
    kwargs = dict(option_type="call", lower_barrier=82.0, upper_barrier=122.0, style="out",
                  trigger=trigger, **BASE)
    closed = price_barrier_double(**kwargs)
    mc_price, se = qmc_price_barrier_double(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-6) * 100.0
    print(f"double barrier {trigger}: closed={closed:.5f} mc={mc_price:.5f} se={se:.5f} err={error_pct:.3f}%")
    assert abs(closed - mc_price) < 8.0 * max(se, 1e-6)


def test_rebate_at_expiry_matches_qmc():
    kwargs = dict(option_type="call", lower_barrier=82.0, upper_barrier=122.0, style="out", trigger="continuous",
                  rebate=5.0, rebate_timing="expiry", **BASE)
    closed = price_barrier_double(**kwargs)
    mc_price, se = qmc_price_barrier_double(**kwargs)
    assert abs(closed - mc_price) < 8.0 * max(se, 1e-6)


def test_rebate_at_hit_matches_dedicated_fine_grid_mc():
    # The one item in this family needing a bespoke reference: a fine-step
    # (dt small, many steps -> ~4096/year) hard-indicator hitting-time MC,
    # since terminal-only or coarse-grid checks can't validate hit *timing*.
    kwargs = dict(option_type="call", lower_barrier=82.0, upper_barrier=122.0, style="out", trigger="continuous",
                  rebate=5.0, rebate_timing="hit", **BASE)
    closed = price_barrier_double(**kwargs)
    mc_price, se = qmc_price_barrier_double(**kwargs, continuous_steps_per_year=4096)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-6) * 100.0
    print(f"double barrier rebate-at-hit: closed={closed:.5f} mc={mc_price:.5f} se={se:.5f} err={error_pct:.3f}%")
    assert abs(closed - mc_price) < 8.0 * max(se, 1e-6)


def test_sloped_term_vol_matches_qmc():
    kwargs = dict(option_type="call", lower_barrier=82.0, upper_barrier=122.0, style="out", trigger="continuous",
                  spot=100.0, strike=100.0, rate=0.04, div_yield=0.01, borrow=0.0, maturity=1.0,
                  vol_times=[0.25, 1.0], vol_values=[0.2, 0.3], value_date=0.0)
    closed = price_barrier_double(**kwargs)
    mc_price, se = qmc_price_barrier_double(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-6) * 100.0
    print(f"sloped term vol: closed={closed:.5f} mc={mc_price:.5f} err={error_pct:.3f}%")
    assert math.isfinite(closed)
