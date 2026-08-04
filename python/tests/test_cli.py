import json

from quantkiller.cli import price_request
from quantkiller.models import MODELS


def test_all_registered_models_are_callable():
    assert len(MODELS) >= 11
    for name, fn in MODELS.items():
        assert callable(fn), name


def test_price_request_success_shape():
    request = {"model": "black_scholes", "params": {
        "spot": 42.0, "strike": 40.0, "rate": 0.1, "vol": 0.2, "time": 0.5, "option_type": "call"}}
    response = price_request(request)
    assert response["ok"] is True
    assert response["model"] == "black_scholes"
    assert "price" in response["results"]
    json.dumps(response)  # must be JSON-serializable


def test_price_request_unknown_model():
    response = price_request({"model": "nope", "params": {}})
    assert response["ok"] is False
    assert "unknown model" in response["error"]


def test_price_request_bad_shape():
    response = price_request({"model": "black_scholes"})
    assert response["ok"] is False


def test_price_request_propagates_pricing_errors_as_ok_false():
    request = {"model": "black_scholes", "params": {"spot": -1, "strike": 40.0,
               "rate": 0.1, "vol": 0.2, "time": 0.5, "option_type": "call"}}
    response = price_request(request)
    assert response["ok"] is False
    assert "error" in response


def test_american_models_reachable_via_cli():
    request = {"model": "american_baw", "params": {
        "spot": 100.0, "strike": 100.0, "rate": 0.05, "div_yield": 0.0,
        "vol": 0.3, "time": 1.0, "option_type": "put"}}
    response = price_request(request)
    assert response["ok"] is True
    assert response["results"]["price"] > 0.0
