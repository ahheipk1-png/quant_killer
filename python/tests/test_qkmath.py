import math

import pytest

from quantkiller.qkmath import norm_cdf, norm_pdf, norminv
from .conftest import oracle_norm_cdf


@pytest.mark.parametrize("x", [-8, -5, -3, -1.5, -1, -0.5, -0.01, 0, 0.01, 0.5, 1, 1.5, 3, 5, 8])
def test_norm_cdf_matches_erf_oracle(x):
    assert norm_cdf(x) == pytest.approx(oracle_norm_cdf(x), abs=1e-14)


def test_norm_cdf_matches_erf_dense_grid():
    xs = [-6.0 + 0.01 * i for i in range(1201)]
    worst = max(abs(norm_cdf(x) - oracle_norm_cdf(x)) for x in xs)
    assert worst < 1e-13


def test_norm_cdf_symmetry():
    for x in (0.3, 1.7, 2.5, 4.1):
        assert norm_cdf(x) + norm_cdf(-x) == pytest.approx(1.0, abs=1e-15)


def test_norm_cdf_extreme_tails():
    assert norm_cdf(-40.0) == 0.0
    assert norm_cdf(40.0) == 1.0


def test_norm_pdf_matches_definition():
    for x in (-3.0, -1.0, 0.0, 1.0, 3.0):
        expected = math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)
        assert norm_pdf(x) == pytest.approx(expected, rel=1e-14)


@pytest.mark.parametrize("p", [1e-6, 0.001, 0.02425, 0.1, 0.3, 0.5, 0.7, 0.9, 0.97575, 0.999, 1 - 1e-6])
def test_norminv_is_left_inverse_of_norm_cdf(p):
    x = norminv(p)
    assert norm_cdf(x) == pytest.approx(p, abs=1e-12)


def test_norminv_rejects_out_of_range():
    with pytest.raises(ValueError):
        norminv(0.0)
    with pytest.raises(ValueError):
        norminv(1.0)
    with pytest.raises(ValueError):
        norminv(-0.1)
