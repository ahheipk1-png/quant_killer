"""Shared parameter validation helpers for all models."""

from .. import QKError

CALL, PUT = "call", "put"


def get_num(params: dict, key: str, *, default=None, minimum=None, strict_min=False):
    if key not in params:
        if default is not None:
            return float(default)
        raise QKError(f"missing required parameter '{key}'")
    v = params[key]
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise QKError(f"parameter '{key}' must be a number, got {v!r}")
    v = float(v)
    if minimum is not None:
        if strict_min and v <= minimum:
            raise QKError(f"parameter '{key}' must be > {minimum}, got {v}")
        if not strict_min and v < minimum:
            raise QKError(f"parameter '{key}' must be >= {minimum}, got {v}")
    return v


def get_int(params: dict, key: str, *, default=None, minimum=None):
    if key not in params:
        if default is not None:
            return int(default)
        raise QKError(f"missing required parameter '{key}'")
    v = params[key]
    if isinstance(v, bool) or not isinstance(v, int):
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        else:
            raise QKError(f"parameter '{key}' must be an integer, got {v!r}")
    if minimum is not None and v < minimum:
        raise QKError(f"parameter '{key}' must be >= {minimum}, got {v}")
    return v


def get_option_type(params: dict) -> str:
    ot = params.get("option_type")
    if ot not in (CALL, PUT):
        raise QKError(f"option_type must be 'call' or 'put', got {ot!r}")
    return ot


def get_style(params: dict, default="european") -> str:
    style = params.get("style", default)
    if style not in ("european", "american"):
        raise QKError(f"style must be 'european' or 'american', got {style!r}")
    return style


def get_bool(params: dict, key: str, default: bool) -> bool:
    v = params.get(key, default)
    if not isinstance(v, bool):
        raise QKError(f"parameter '{key}' must be a boolean, got {v!r}")
    return v
