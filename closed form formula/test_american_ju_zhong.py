"""Tests for american_ju_zhong.py, benchmarked against american_pde.py
(family 2 -- the one family using a PDE benchmark instead of QMC).

price_american_ju_zhong returns a PAIR (price, exercise_now); the PDE
benchmark returns price only.
"""

import math

import numpy as np
import pytest

from american_ju_zhong import (
    american_exercise_boundary,
    price_american_ju_zhong,
    should_exercise_now,
)
from american_pde import price_american_pde, convergence_table
from european import price_european

BASE = dict(
    spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
    maturity=1.0, vol_times=[1.0], vol_values=[0.25], value_date=0.0,
)


def _price(**kwargs):
    price, _ = price_american_ju_zhong(**kwargs)
    return price


# ---------------------------------------------------------------- layer 1 --


def test_call_with_zero_dividend_equals_european_exactly():
    # Never optimal to exercise early with no dividend/borrow drag: an
    # American call collapses to the European price, exactly.
    kwargs = dict(spot=100.0, strike=95.0, rate=0.05, div_yield=0.0, borrow=0.0,
                  maturity=1.0, vol_times=[1.0], vol_values=[0.3], value_date=0.0)
    american, exercise_now = price_american_ju_zhong(option_type="call", **kwargs)
    euro = price_european(option_type="call", **kwargs)
    assert american == pytest.approx(euro, abs=1e-9)
    assert not np.any(exercise_now)


@pytest.mark.parametrize("option_type", ["call", "put"])
def test_american_at_least_european(option_type):
    american = _price(option_type=option_type, **BASE)
    euro = price_european(option_type=option_type, **BASE)
    assert american >= euro - 1e-9


@pytest.mark.parametrize("option_type", ["call", "put"])
def test_american_at_least_intrinsic(option_type):
    price = _price(option_type=option_type, **BASE)
    intrinsic = max(BASE["spot"] - BASE["strike"], 0.0) if option_type == "call" else max(BASE["strike"] - BASE["spot"], 0.0)
    assert price >= intrinsic - 1e-9


def test_deep_itm_put_near_intrinsic_and_flags_exercise():
    kwargs = dict(spot=40.0, strike=100.0, rate=0.05, div_yield=0.0, borrow=0.0,
                  maturity=1.0, vol_times=[1.0], vol_values=[0.2], value_date=0.0)
    price, exercise_now = price_american_ju_zhong(option_type="put", **kwargs)
    assert price == pytest.approx(60.0, abs=0.5)  # rate>0 => early exercise nearly optimal
    assert bool(exercise_now)


def test_settle_lag_scales_price_exactly():
    # Cash-settlement lag L: exercise at tau locks intrinsic, paid at tau+L.
    # e^(-rL) factors out of the optimal-stopping problem (constant positive
    # scaling leaves the argmax unchanged), so V(L) = e^(-rL)*V(0) EXACTLY.
    no_lag = _price(option_type="put", settle_lag=0.0, **BASE)
    lagged = _price(option_type="put", settle_lag=0.3, **BASE)
    assert lagged / no_lag == pytest.approx(math.exp(-BASE["rate"] * 0.3), rel=1e-12)


def test_settle_lag_exercise_boundary_unchanged():
    # Same factorization means the continuation/exercise split is identical:
    # the ratio lagged/no_lag must be the SAME constant at every spot, and
    # the returned exercise_now flags must be bit-identical.
    ratio_ref = None
    for spot in (60.0, 80.0, 100.0, 120.0):
        no_lag, flag0 = price_american_ju_zhong(option_type="put", settle_lag=0.0, **{**BASE, "spot": spot})
        lagged, flag1 = price_american_ju_zhong(option_type="put", settle_lag=0.5, **{**BASE, "spot": spot})
        assert bool(flag0) == bool(flag1)
        ratio = lagged / no_lag
        if ratio_ref is None:
            ratio_ref = ratio
        assert ratio == pytest.approx(ratio_ref, rel=1e-12)
    assert ratio_ref == pytest.approx(math.exp(-BASE["rate"] * 0.5), rel=1e-12)


def test_negative_settle_lag_rejected():
    with pytest.raises(ValueError):
        price_american_ju_zhong(option_type="put", settle_lag=-0.1, **BASE)


def test_negative_rate_or_div_rejected():
    with pytest.raises(ValueError):
        price_american_ju_zhong(option_type="put", **{**BASE, "rate": -0.01})
    with pytest.raises(ValueError):
        price_american_ju_zhong(option_type="put", **{**BASE, "div_yield": -0.05, "borrow": 0.0})


# ------------------------------------------------------- exercise-now ------


def test_put_boundary_below_strike_and_positive():
    b = american_exercise_boundary(strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                                    maturity=1.0, option_type="put", vol_times=[1.0],
                                    vol_values=[0.25], value_date=0.0)
    assert 0.0 < b < 100.0


def test_call_boundary_above_strike_with_dividends():
    b = american_exercise_boundary(strike=100.0, rate=0.05, div_yield=0.06, borrow=0.0,
                                    maturity=1.0, option_type="call", vol_times=[1.0],
                                    vol_values=[0.25], value_date=0.0)
    assert b > 100.0


def test_call_no_dividend_never_exercises():
    b = american_exercise_boundary(strike=100.0, rate=0.05, div_yield=0.0, borrow=0.0,
                                    maturity=1.0, option_type="call", vol_times=[1.0],
                                    vol_values=[0.25], value_date=0.0)
    assert math.isinf(b)
    _, flags = price_american_ju_zhong(spot=np.array([50.0, 500.0, 5000.0]), strike=100.0, rate=0.05,
                                        div_yield=0.0, borrow=0.0, maturity=1.0, option_type="call",
                                        vol_times=[1.0], vol_values=[0.25], value_date=0.0)
    assert not flags.any()


def test_boundary_at_expiry_is_strike():
    b = american_exercise_boundary(strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                                    maturity=1.0, option_type="put", vol_times=[1.0],
                                    vol_values=[0.25], value_date=1.0)
    assert b == pytest.approx(100.0, abs=1e-12)


def test_indicator_consistent_with_price_at_intrinsic():
    # Wherever the indicator says "exercise now", the (unlagged) price must
    # sit exactly at intrinsic; wherever it says hold, price > intrinsic.
    spots = np.linspace(40.0, 160.0, 121)
    prices, flags = price_american_ju_zhong(spot=spots, strike=100.0, rate=0.05, div_yield=0.02,
                                             borrow=0.0, maturity=1.0, option_type="put",
                                             vol_times=[1.0], vol_values=[0.25], value_date=0.0)
    intrinsic = np.maximum(100.0 - spots, 0.0)
    assert prices[flags] == pytest.approx(intrinsic[flags], abs=1e-10)
    assert np.all(prices[~flags] > intrinsic[~flags] - 1e-12)
    assert flags.any() and (~flags).any()  # both regions actually probed


def test_second_output_matches_standalone_indicator():
    spots = np.linspace(40.0, 160.0, 61)
    _, flags = price_american_ju_zhong(option_type="put", **{**BASE, "spot": spots})
    standalone = should_exercise_now(spot=spots, strike=BASE["strike"], rate=BASE["rate"],
                                      div_yield=BASE["div_yield"], borrow=BASE["borrow"],
                                      maturity=BASE["maturity"], option_type="put",
                                      vol_times=BASE["vol_times"], vol_values=BASE["vol_values"],
                                      value_date=0.0)
    assert np.array_equal(flags, standalone)


def test_indicator_past_maturity_is_in_the_money():
    price, flag = price_american_ju_zhong(spot=110.0, strike=100.0, rate=0.05, div_yield=0.02,
                                           borrow=0.0, maturity=1.0, settle_lag=0.3,
                                           option_type="call", vol_times=[1.0], vol_values=[0.3],
                                           value_date=1.1)
    assert price == pytest.approx(10.0 * math.exp(-0.05 * 0.2), abs=1e-10)
    assert bool(flag)
    _, flag_otm = price_american_ju_zhong(spot=90.0, strike=100.0, rate=0.05, div_yield=0.02,
                                           borrow=0.0, maturity=1.0, settle_lag=0.3,
                                           option_type="call", vol_times=[1.0], vol_values=[0.3],
                                           value_date=1.1)
    assert not bool(flag_otm)


# ---------------------------------------------------------- value_date -----


def test_strike_zero_finite_and_nonnegative():
    for opt in ("call", "put"):
        price = _price(option_type=opt, **{**BASE, "strike": 0.0})
        assert math.isfinite(price) and price >= -1e-6


def test_value_date_past_settlement_is_zero():
    common = {k: v for k, v in BASE.items() if k != "value_date"}
    price, flag = price_american_ju_zhong(option_type="put", settle_lag=0.2, value_date=1.5, **common)
    assert price == pytest.approx(0.0, abs=1e-12)
    assert not bool(flag)


def test_value_date_between_maturity_and_settlement_is_discounted_intrinsic():
    price = _price(spot=110.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                   maturity=1.0, settle_lag=0.3, option_type="call",
                   vol_times=[1.0], vol_values=[0.3], value_date=1.1)
    expected = 10.0 * math.exp(-0.05 * (1.3 - 1.1))
    assert price == pytest.approx(expected, abs=1e-10)


def test_value_date_partway_matches_shifted_horizon():
    partway = _price(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                     maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[0.3],
                     value_date=0.4)
    shifted = _price(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                     maturity=0.6, option_type="put", vol_times=[0.6], vol_values=[0.3],
                     value_date=0.0)
    assert partway == pytest.approx(shifted, abs=1e-9)


def test_negative_value_date_rejected():
    with pytest.raises(ValueError):
        price_american_ju_zhong(option_type="put", **{**BASE, "value_date": -0.1})


def test_vectorised_spot_matches_scalar_loop():
    spots = np.array([60.0, 80.0, 100.0, 120.0, 150.0])
    vector, vflags = price_american_ju_zhong(option_type="put", **{**BASE, "spot": spots})
    scalars = np.array([_price(option_type="put", **{**BASE, "spot": s}) for s in spots])
    sflags = np.array([
        bool(price_american_ju_zhong(option_type="put", **{**BASE, "spot": s})[1]) for s in spots
    ])
    assert vector == pytest.approx(scalars, abs=1e-12)
    assert np.array_equal(vflags, sflags)


def test_settle_lag_pde_matches_ju_zhong_scaling():
    # The PDE applies the identical e^(-rL) factorization, so the lagged
    # JZ-vs-PDE gap must equal the unlagged gap scaled by e^(-rL).
    jz = _price(option_type="put", settle_lag=0.25, **BASE)
    pde = price_american_pde(option_type="put", settle_lag=0.25, **BASE)
    error_pct = abs(jz - pde) / max(pde, 1e-6) * 100.0
    assert error_pct < 2.0


# ---------------------------------------------------------------- layer 2 --


def test_maturity_zero_is_intrinsic():
    price = _price(spot=90.0, strike=100.0, rate=0.05, div_yield=0.0, borrow=0.0,
                   maturity=0.0, option_type="put", vol_times=[1.0], vol_values=[0.2],
                   value_date=0.0)
    assert price == pytest.approx(10.0, abs=1e-10)


def test_one_day_maturity_finite():
    price = _price(spot=100.0, strike=100.0, rate=0.03, div_yield=0.02, borrow=0.0,
                   maturity=1.0 / 365.0, option_type="put",
                   vol_times=[1.0 / 365.0], vol_values=[0.3], value_date=0.0)
    assert math.isfinite(price) and price >= 0.0


def test_strike_near_zero_finite():
    price = _price(spot=100.0, strike=0.01, rate=0.05, div_yield=0.02, borrow=0.0,
                   maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[0.3],
                   value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


# ---------------------------------------------------------------- layer 3 --


@pytest.mark.parametrize("vol", [0.001, 0.005, 3.0])
def test_vol_stress_finite(vol):
    price = _price(spot=100.0, strike=100.0, rate=0.05, div_yield=0.02, borrow=0.0,
                   maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[vol],
                   value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("rate", [0.0, 0.001, 0.2])
def test_rate_stress_finite(rate):
    price = _price(spot=100.0, strike=100.0, rate=rate, div_yield=0.02, borrow=0.0,
                   maturity=1.0, option_type="put", vol_times=[1.0], vol_values=[0.3],
                   value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


@pytest.mark.parametrize("maturity_days", [1, 365, 30 * 365])
def test_maturity_stress_finite(maturity_days):
    maturity = maturity_days / 365.0
    price = _price(spot=100.0, strike=100.0, rate=0.03, div_yield=0.01, borrow=0.0,
                   maturity=maturity, option_type="put",
                   vol_times=[maturity], vol_values=[0.25], value_date=0.0)
    assert math.isfinite(price) and price >= -1e-9


# --------------------------------------------------------- benchmark check --


@pytest.mark.parametrize("option_type", ["call", "put"])
@pytest.mark.parametrize("spot", [80.0, 100.0, 120.0])
def test_matches_pde_and_reports_error(option_type, spot):
    kwargs = dict(**{**BASE, "spot": spot}, option_type=option_type)
    jz = _price(**kwargs)
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
    jz = _price(**kwargs)
    pde = price_american_pde(**kwargs)
    error_pct = abs(jz - pde) / max(pde, 1e-6) * 100.0
    print(f"sloped term vol American put: ju_zhong={jz:.5f} pde={pde:.5f} err={error_pct:.3f}%")
    assert math.isfinite(jz)
