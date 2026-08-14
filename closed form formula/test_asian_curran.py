"""Tests for asian_curran.py only (family 3)."""

import math

import numpy as np
import pytest

from asian_curran import price_asian_curran
from asian_qmc import qmc_price_asian
from european import price_european


def _weekday_schedule(n_days, start_offset_days=1):
    """Mon-Fri fixing schedule (a business-day calendar with weekends
    skipped), returned as year fractions -- deliberately unevenly spaced.
    """
    times = []
    day = start_offset_days
    while len(times) < n_days:
        if (day - 1) % 7 < 5:  # Mon..Fri
            times.append(day / 365.0)
        day += 1
    return np.array(times)


# ---------------------------------------------------------------- layer 1 --


def test_single_fixing_equals_european_exactly():
    # One asset, one remaining fixing AT maturity, no cap: the "average"
    # degenerates to S(T), so Curran must reproduce Black-Scholes exactly,
    # regardless of variant.
    kwargs = dict(
        spots=[100.0], weights=[1.0], strike=95.0, rate=0.05, div_yields=[0.02],
        borrows=[0.0], fixing_times=[1.0], maturity=1.0,
        vol_times_list=[[1.0]], vol_values_list=[[0.3]], correlation=1.0,
        value_date=0.0,
    )
    euro = price_european(spot=100.0, strike=95.0, rate=0.05, div_yield=0.02, borrow=0.0,
                           maturity=1.0, option_type="call", vol_times=[1.0], vol_values=[0.3],
                           value_date=0.0)
    for variant in ("one_moment", "two_moment"):
        curran = price_asian_curran(option_type="call", variant=variant, **kwargs)
        assert curran == pytest.approx(euro, abs=1e-9), variant


def test_single_fixing_seasoned_is_discounted_deterministic_payoff():
    # The one fixing is already observed: no diffusion left at all.
    price = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=95.0, rate=0.05, div_yields=[0.02],
        borrows=[0.0], fixing_times=[], maturity=1.0, option_type="call",
        vol_times_list=[[1.0]], vol_values_list=[[0.3]], correlation=1.0,
        value_date=0.0,
        observed_sum=[103.0], observed_count=[1],
    )
    expected = math.exp(-0.05 * 1.0) * max(103.0 - 95.0, 0.0)
    assert price == pytest.approx(expected, abs=1e-10)


def test_capped_single_asian_equals_call_spread():
    # Exact identity: max(min(A,cap)-K,0) = (A-K)+ - (A-cap)+ for floor<=K<=cap.
    schedule = _weekday_schedule(60)
    common = dict(
        spots=[100.0], weights=[1.0], rate=0.05, div_yields=[0.02], borrows=[0.0],
        fixing_times=schedule, maturity=float(schedule[-1]) + 1e-6,
        vol_times_list=[[0.3]], vol_values_list=[[0.25]], correlation=1.0,
        value_date=0.0,
        option_type="call", variant="one_moment",
    )
    # cap/floor are PERFORMANCE ratios (A/S0), not absolute price levels;
    # the equivalent absolute strike for the "second leg" is cap * spot0.
    strike, cap_ratio = 100.0, 1.3
    cap_strike = cap_ratio * common["spots"][0]
    capped = price_asian_curran(strike=strike, cap=cap_ratio, floor=0.0, **common)
    plain_k = price_asian_curran(strike=strike, **common)
    plain_cap_strike = price_asian_curran(strike=cap_strike, **common)
    assert capped == pytest.approx(plain_k - plain_cap_strike, abs=1e-8)


def test_one_asset_basket_matches_single_asset():
    schedule = _weekday_schedule(30)
    common = dict(
        strike=100.0, rate=0.05, fixing_times=schedule, maturity=float(schedule[-1]) + 1e-6,
        correlation=1.0, option_type="put", value_date=0.0,
    )
    single = price_asian_curran(spots=[100.0], weights=[1.0], div_yields=[0.01], borrows=[0.0],
                                 vol_times_list=[[1.0]], vol_values_list=[[0.2]], **common)
    basket = price_asian_curran(spots=[100.0], weights=[1.0], div_yields=[0.01], borrows=[0.0],
                                 vol_times_list=[[1.0]], vol_values_list=[[0.2]], **common)
    assert basket == pytest.approx(single, abs=1e-12)


def test_put_call_parity_on_average():
    schedule = _weekday_schedule(12)
    common = dict(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.01], borrows=[0.0],
        fixing_times=schedule, maturity=float(schedule[-1]) + 1e-6,
        vol_times_list=[[0.1]], vol_values_list=[[0.25]], correlation=1.0, variant="one_moment",
        value_date=0.0,
    )
    call = price_asian_curran(option_type="call", **common)
    put = price_asian_curran(option_type="put", **common)
    # Forward of the average = sum weights * (observed + sum forwards)/N.
    fixing_times = common["fixing_times"]
    m = len(fixing_times)
    forward_avg = np.mean(100.0 * np.exp(0.04 * fixing_times))
    disc_pay = math.exp(-0.05 * common["maturity"])
    assert call - put == pytest.approx(disc_pay * (forward_avg - 100.0), abs=1e-4)


def test_variant_requires_one_moment_for_cap():
    with pytest.raises(ValueError):
        price_asian_curran(
            spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.0],
            borrows=[0.0], fixing_times=[0.5, 1.0], maturity=1.0, option_type="call",
            vol_times_list=[[1.0]], vol_values_list=[[0.2]], correlation=1.0,
            value_date=0.0,
            cap=1.2, variant="two_moment",
        )


# ---------------------------------------------------------- value_date -----


def test_value_date_past_payment_is_zero():
    price = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02],
        borrows=[0.0], fixing_times=[], maturity=1.0, payment_time=1.2, option_type="call",
        vol_times_list=[[1.0]], vol_values_list=[[0.3]], correlation=1.0,
        observed_sum=[105.0], observed_count=[1], value_date=1.5,
    )
    assert price == pytest.approx(0.0, abs=1e-12)


def test_value_date_at_maturity_requires_seasoned_fixings():
    with pytest.raises(ValueError):
        price_asian_curran(
            spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02],
            borrows=[0.0], fixing_times=[0.5, 1.0], maturity=1.0, option_type="call",
            vol_times_list=[[1.0]], vol_values_list=[[0.3]], correlation=1.0,
            value_date=1.0,
        )


def test_value_date_at_maturity_uses_observed_sum():
    price = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=95.0, rate=0.05, div_yields=[0.02],
        borrows=[0.0], fixing_times=[], maturity=1.0, payment_time=1.3, option_type="call",
        vol_times_list=[[1.0]], vol_values_list=[[0.3]], correlation=1.0,
        observed_sum=[103.0], observed_count=[1], value_date=1.1,
    )
    expected = math.exp(-0.05 * (1.3 - 1.1)) * max(103.0 - 95.0, 0.0)
    assert price == pytest.approx(expected, abs=1e-10)


def test_value_date_partway_matches_shifted_schedule():
    # Pricing as of value_date=0.4 with fixings at [0.6, 1.0] should equal
    # pricing with fixings at [0.2, 0.6] and maturity=0.6 as of value_date=0.
    partway = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02], borrows=[0.0],
        fixing_times=[0.6, 1.0], maturity=1.0, option_type="call",
        vol_times_list=[[1.0]], vol_values_list=[[0.3]], correlation=1.0, value_date=0.4,
    )
    shifted = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02], borrows=[0.0],
        fixing_times=[0.2, 0.6], maturity=0.6, option_type="call",
        vol_times_list=[[0.6]], vol_values_list=[[0.3]], correlation=1.0, value_date=0.0,
    )
    assert partway == pytest.approx(shifted, abs=1e-9)


def test_two_moment_rejects_negative_weights():
    # Real bug caught by QMC comparison: the adjusted_strike<=0 "certain
    # exercise -> forward" shortcut (and the two-moment lognormal fit in
    # general) silently assumes non-negative weights.
    with pytest.raises(ValueError):
        price_asian_curran(
            spots=[100.0, 100.0], weights=[1.0, -1.0], strike=-50.0, rate=0.05,
            div_yields=[0.0, 0.0], borrows=[0.0, 0.0], fixing_times=[1.0], maturity=1.0,
            option_type="call", vol_times_list=[[1.0], [1.0]], vol_values_list=[[0.3], [0.3]],
            correlation=0.0, variant="two_moment", value_date=0.0,
        )


def test_one_moment_spread_basket_matches_qmc():
    # one_moment has no lognormality assumption, so negative (spread-style)
    # weights work -- checked against the same independent QMC.
    kwargs = dict(
        spots=[100.0, 100.0], weights=[1.0, -1.0], strike=-50.0, rate=0.05,
        div_yields=[0.0, 0.0], borrows=[0.0, 0.0], fixing_times=[1.0], maturity=1.0,
        option_type="call", vol_times_list=[[1.0], [1.0]], vol_values_list=[[0.3], [0.3]],
        correlation=0.0, value_date=0.0,
    )
    closed = price_asian_curran(variant="one_moment", **kwargs)
    mc_price, se = qmc_price_asian(**kwargs)
    error_pct = abs(closed - mc_price) / max(mc_price, 1e-8) * 100.0
    print(f"spread basket one_moment: closed={closed:.5f} mc={mc_price:.5f} err={error_pct:.3f}%")
    assert error_pct < 2.0


def test_negative_value_date_rejected():
    with pytest.raises(ValueError):
        price_asian_curran(
            spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02],
            borrows=[0.0], fixing_times=[0.5, 1.0], maturity=1.0, option_type="call",
            vol_times_list=[[1.0]], vol_values_list=[[0.3]], correlation=1.0, value_date=-0.1,
        )


# ---------------------------------------------------------------- layer 2 --


def test_two_fixings_finite():
    price = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02],
        borrows=[0.0], fixing_times=[0.5, 1.0], maturity=1.0, option_type="call",
        vol_times_list=[[1.0]], vol_values_list=[[0.3]], correlation=1.0,
        value_date=0.0,
    )
    assert math.isfinite(price) and price >= 0.0


def test_hundreds_of_fixings_finite():
    schedule = _weekday_schedule(400)
    price = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.03, div_yields=[0.01],
        borrows=[0.0], fixing_times=schedule, maturity=float(schedule[-1]) + 1e-6,
        option_type="put", vol_times_list=[[2.0]], vol_values_list=[[0.25]], correlation=1.0,
        value_date=0.0,
    )
    assert math.isfinite(price) and price >= 0.0


def test_cap_near_floor_finite():
    # cap must be strictly above floor (asserted elsewhere); push them to
    # within 1e-9 of each other to probe the near-degenerate corridor.
    price = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=95.0, rate=0.05, div_yields=[0.0],
        borrows=[0.0], fixing_times=[0.5, 1.0], maturity=1.0, option_type="call",
        vol_times_list=[[1.0]], vol_values_list=[[0.2]], correlation=1.0,
        value_date=0.0,
        cap=1.05, floor=1.05 - 1e-9,
    )
    assert math.isfinite(price) and price >= 0.0


def test_cap_equals_floor_rejected():
    with pytest.raises(ValueError):
        price_asian_curran(
            spots=[100.0], weights=[1.0], strike=95.0, rate=0.05, div_yields=[0.0],
            borrows=[0.0], fixing_times=[0.5, 1.0], maturity=1.0, option_type="call",
            vol_times_list=[[1.0]], vol_values_list=[[0.2]], correlation=1.0,
        value_date=0.0,
            cap=1.05, floor=1.05,
        )


def test_deferred_payment_time():
    common = dict(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02],
        borrows=[0.0], fixing_times=[0.5, 1.0], maturity=1.0, option_type="call",
        vol_times_list=[[1.0]], vol_values_list=[[0.25]], correlation=1.0,
        value_date=0.0,
    )
    at_maturity = price_asian_curran(payment_time=1.0, **common)
    deferred = price_asian_curran(payment_time=1.4, **common)
    assert deferred / at_maturity == pytest.approx(math.exp(-0.05 * 0.4), rel=1e-9)


# ---------------------------------------------------------------- layer 3 --


@pytest.mark.parametrize("vol", [0.001, 0.005, 3.0])
def test_vol_stress_finite(vol):
    price = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.01],
        borrows=[0.0], fixing_times=[0.3, 0.6, 1.0], maturity=1.0, option_type="call",
        vol_times_list=[[1.0]], vol_values_list=[[vol]], correlation=1.0,
        value_date=0.0,
    )
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("correlation", [-0.49, 0.0, 0.35, 0.9, 0.999])
def test_correlation_stress_finite_basket(correlation):
    price = price_asian_curran(
        spots=[100.0, 95.0, 110.0], weights=[0.4, 0.35, 0.25], strike=100.0, rate=0.05,
        div_yields=[0.02, 0.01, 0.0], borrows=[0.0, 0.0, 0.0],
        fixing_times=[0.25, 0.5, 0.75, 1.0], maturity=1.0, option_type="call",
        vol_times_list=[[1.0], [1.0], [1.0]], vol_values_list=[[0.25], [0.30], [0.20]],
        correlation=correlation, variant="two_moment", value_date=0.0,
    )
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("maturity_days", [1, 365, 30 * 365])
def test_maturity_stress_finite(maturity_days):
    maturity = maturity_days / 365.0
    schedule = _weekday_schedule(min(maturity_days, 20), start_offset_days=1)
    schedule = schedule[schedule <= maturity]
    if schedule.size == 0:
        schedule = np.array([maturity])
    price = price_asian_curran(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.03, div_yields=[0.01],
        borrows=[0.0], fixing_times=schedule, maturity=maturity, option_type="put",
        vol_times_list=[[maturity]], vol_values_list=[[0.25]], correlation=1.0,
        value_date=0.0,
    )
    assert math.isfinite(price) and price >= -1e-9


# --------------------------------------------------------- benchmark check --


@pytest.mark.parametrize("variant", ["one_moment", "two_moment"])
def test_single_asset_matches_qmc(variant):
    schedule = _weekday_schedule(12)
    kwargs = dict(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.05, div_yields=[0.02],
        borrows=[0.0], fixing_times=schedule, maturity=float(schedule[-1]) + 1e-6,
        option_type="call", vol_times_list=[[0.1]], vol_values_list=[[0.3]], correlation=1.0,
        value_date=0.0,
    )
    closed = price_asian_curran(variant=variant, **kwargs)
    mc_price, se = qmc_price_asian(**kwargs)
    assert abs(closed - mc_price) < 5.0 * max(se, 1e-8)


@pytest.mark.parametrize("correlation", [0.0, 0.35, 0.9])
def test_basket_asian_correlation_sweep_reports_error(correlation):
    # The genuinely open question flagged in the plan: is one-moment safe
    # for a basket Asian (many fixings x cross-asset correlation)? Measure
    # both variants against an independent fine-grid QMC and print the
    # answer rather than assume the single-asset conclusion transfers.
    schedule = _weekday_schedule(20)
    kwargs = dict(
        spots=[100.0, 95.0], weights=[0.6, 0.4], strike=100.0, rate=0.05,
        div_yields=[0.02, 0.01], borrows=[0.0, 0.0],
        fixing_times=schedule, maturity=float(schedule[-1]) + 1e-6,
        option_type="call", vol_times_list=[[1.0], [1.0]], vol_values_list=[[0.25], [0.30]],
        correlation=correlation,
        value_date=0.0,
    )
    one = price_asian_curran(variant="one_moment", **kwargs)
    two = price_asian_curran(variant="two_moment", **kwargs)
    mc_price, se = qmc_price_asian(**kwargs)
    err1 = abs(one - mc_price) / max(mc_price, 1e-8) * 100.0
    err2 = abs(two - mc_price) / max(mc_price, 1e-8) * 100.0
    print(f"basket Asian rho={correlation}: mc={mc_price:.5f} se={se:.5f} "
          f"one_moment_err={err1:.3f}% two_moment_err={err2:.3f}%")
    assert math.isfinite(one) and math.isfinite(two)
    assert err2 < 10.0  # two-moment is the fallback; bounded loosely and reported


def test_sloped_term_vol_per_asset_matches_qmc():
    schedule = _weekday_schedule(40)
    kwargs = dict(
        spots=[100.0], weights=[1.0], strike=100.0, rate=0.04, div_yields=[0.01],
        borrows=[0.0], fixing_times=schedule, maturity=float(schedule[-1]) + 1e-6,
        option_type="call", vol_times_list=[[0.08, 0.2, 1.0]],
        vol_values_list=[[0.15, 0.25, 0.35]], correlation=1.0,
        value_date=0.0,
    )
    closed = price_asian_curran(variant="one_moment", **kwargs)
    mc_price, se = qmc_price_asian(**kwargs)
    assert abs(closed - mc_price) < 6.0 * max(se, 1e-8)
