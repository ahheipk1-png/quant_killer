"""Tests for the American-approximation methods absorbed from the web-lab
merge (see models/american.py docstring for the algorithm references).

Since these are all *approximations* to the same true American price, the
right correctness checks are: (1) each reduces to the exact European price
when early exercise is never optimal, (2) each respects the American >=
European >= intrinsic bounds every American price must satisfy, and
(3) the five independent methods (BAW, Ju-Zhong, Bjerksund '93, Bjerksund
'02, Carr randomization) cluster tightly around the CRR tree at a high
step count, since they're all estimating the same quantity by different
numerical routes.
"""

import pytest

from quantkiller.models import american
from quantkiller.models.binomial import price as crr_price
from quantkiller.models.black_scholes import price as bs_price

PUT_CASES = [
    (100.0, 100.0, 0.05, 0.0, 0.3, 1.0),
    (100.0, 90.0, 0.05, 0.0, 0.3, 1.0),
    (100.0, 110.0, 0.05, 0.0, 0.3, 1.0),
    (50.0, 55.0, 0.10, 0.0, 0.4, 0.5),
]

# Calls with a dividend yield high enough that early exercise can be optimal.
CALL_DIV_CASES = [
    (100.0, 100.0, 0.04, 0.08, 0.25, 1.0),
    (100.0, 90.0, 0.03, 0.06, 0.30, 0.75),
]

METHODS = {
    "baw": american.baw_price,
    "ju_zhong": american.ju_zhong_price,
    "bjerksund_1993": american.bjerksund_1993_price,
    "bjerksund_2002": american.bjerksund_2002_price,
}

# Bjerksund-Stensland 1993 is a known cruder approximation than the other
# three (its own 2002 successor exists specifically to improve on it), so it
# gets a looser cross-method tolerance rather than a uniformly tight one.
CLUSTER_TOLERANCE = {"bjerksund_1993": 0.15}
DEFAULT_CLUSTER_TOLERANCE = 0.05


@pytest.mark.parametrize("name,fn", METHODS.items())
def test_call_equals_european_when_no_dividend(name, fn):
    spot, strike, rate, vol, t = 100.0, 90.0, 0.05, 0.3, 1.0
    european = bs_price(spot, strike, rate, 0.0, vol, t, "call")["price"]
    american_price = fn(spot, strike, rate, 0.0, vol, t, "call")["price"]
    assert american_price == pytest.approx(european, abs=1e-6), name


@pytest.mark.parametrize("name,fn", METHODS.items())
@pytest.mark.parametrize("spot,strike,rate,q,vol,t", PUT_CASES)
def test_put_respects_bounds(name, fn, spot, strike, rate, q, vol, t):
    european = bs_price(spot, strike, rate, q, vol, t, "put")["price"]
    intrinsic = max(strike - spot, 0.0)
    out = fn(spot, strike, rate, q, vol, t, "put")["price"]
    assert out >= european - 1e-8, f"{name}: American < European"
    assert out >= intrinsic - 1e-8, f"{name}: American < intrinsic"


@pytest.mark.parametrize("spot,strike,rate,q,vol,t", PUT_CASES)
def test_carr_randomization_respects_bounds(spot, strike, rate, q, vol, t):
    european = bs_price(spot, strike, rate, q, vol, t, "put")["price"]
    intrinsic = max(strike - spot, 0.0)
    out = american.carr_randomization_price(spot, strike, rate, q, vol, t, 32, "put")["price"]
    assert out >= european - 1e-6
    assert out >= intrinsic - 1e-6


@pytest.mark.parametrize("spot,strike,rate,q,vol,t", PUT_CASES)
def test_methods_cluster_around_crr_tree(spot, strike, rate, q, vol, t):
    reference = crr_price(spot, strike, rate, q, vol, t, "put", "american", 1000)["price"]
    for name, fn in METHODS.items():
        out = fn(spot, strike, rate, q, vol, t, "put")["price"]
        tol = CLUSTER_TOLERANCE.get(name, DEFAULT_CLUSTER_TOLERANCE)
        assert out == pytest.approx(reference, abs=tol), f"{name} diverged from CRR reference"
    carr = american.carr_randomization_price(spot, strike, rate, q, vol, t, 64, "put")["price"]
    assert carr == pytest.approx(reference, abs=DEFAULT_CLUSTER_TOLERANCE)


@pytest.mark.parametrize("spot,strike,rate,q,vol,t", CALL_DIV_CASES)
def test_call_methods_cluster_when_dividend_makes_exercise_optimal(spot, strike, rate, q, vol, t):
    reference = crr_price(spot, strike, rate, q, vol, t, "call", "american", 1000)["price"]
    european = bs_price(spot, strike, rate, q, vol, t, "call")["price"]
    # Confirm this case actually has a meaningful early-exercise premium,
    # otherwise the test wouldn't be exercising the interesting code path.
    assert reference > european + 1e-4
    for name, fn in METHODS.items():
        out = fn(spot, strike, rate, q, vol, t, "call")["price"]
        tol = CLUSTER_TOLERANCE.get(name, DEFAULT_CLUSTER_TOLERANCE)
        assert out == pytest.approx(reference, abs=tol), f"{name} diverged from CRR reference"


def test_carr_randomization_converges_as_phases_increase():
    spot, strike, rate, q, vol, t = 100.0, 110.0, 0.05, 0.0, 0.3, 1.0
    reference = crr_price(spot, strike, rate, q, vol, t, "put", "american", 1000)["price"]
    coarse = american.carr_randomization_price(spot, strike, rate, q, vol, t, 4, "put")["price"]
    fine = american.carr_randomization_price(spot, strike, rate, q, vol, t, 64, "put")["price"]
    assert abs(fine - reference) <= abs(coarse - reference) + 1e-6


def test_carr_randomization_rejects_bad_phase_count():
    from quantkiller import QKError
    with pytest.raises(QKError):
        american.carr_randomization_price(100.0, 100.0, 0.05, 0.0, 0.3, 1.0, 2, "put")
    with pytest.raises(QKError):
        american.carr_randomization_price(100.0, 100.0, 0.05, 0.0, 0.3, 1.0, 500, "put")


@pytest.mark.parametrize("name,fn", METHODS.items())
def test_rejects_negative_rate_or_dividend(name, fn):
    from quantkiller import QKError
    with pytest.raises(QKError):
        fn(100.0, 100.0, -0.01, 0.0, 0.2, 1.0, "put")
    with pytest.raises(QKError):
        fn(100.0, 100.0, 0.01, -0.01, 0.2, 1.0, "put")
