"""QuantKiller CLI — the universal cross-language bridge.

Every QuantKiller language ships this same interface:

    quantkiller price --json <file>     read a pricing request from a file
    quantkiller price --json -          ... or from stdin
    quantkiller models                  list available models
    quantkiller version                 print engine identifier

Request/response shapes: contracts/schema/*.schema.json.
Exit code 0 on success (ok: true), 1 on pricing errors (ok: false), 2 on usage errors.
"""

import argparse
import json
import sys

from . import ENGINE_NAME, QKError
from .models import MODELS


def price_request(request: dict) -> dict:
    """Run one request object -> response object (never raises for QKError)."""
    model = request.get("model")
    params = request.get("params")
    if not isinstance(model, str) or not isinstance(params, dict):
        return {"ok": False, "error": "request must have 'model' (string) and 'params' (object)"}
    fn = MODELS.get(model)
    if fn is None:
        return {"ok": False, "error": f"unknown model '{model}'; run 'quantkiller models'"}
    try:
        results = fn(params)
    except QKError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "model": model, "engine": ENGINE_NAME, "results": results}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="quantkiller",
                                     description="QuantKiller derivatives pricing (Python engine)")
    sub = parser.add_subparsers(dest="command")

    p_price = sub.add_parser("price", help="price a JSON request")
    p_price.add_argument("--json", required=True, metavar="FILE",
                         help="path to request JSON, or '-' for stdin")

    sub.add_parser("models", help="list available models")
    sub.add_parser("version", help="print engine identifier")

    args = parser.parse_args(argv)

    if args.command == "version":
        print(ENGINE_NAME)
        return 0
    if args.command == "models":
        for name in sorted(MODELS):
            print(name)
        return 0
    if args.command == "price":
        try:
            raw = sys.stdin.read() if args.json == "-" else open(args.json, "r", encoding="utf-8").read()
            request = json.loads(raw)
        except (OSError, json.JSONDecodeError) as exc:
            print(json.dumps({"ok": False, "error": f"bad request input: {exc}"}))
            return 1
        response = price_request(request)
        print(json.dumps(response))
        return 0 if response["ok"] else 1

    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
