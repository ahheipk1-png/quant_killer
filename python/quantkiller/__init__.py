"""QuantKiller — free, open, verified derivatives pricing.

Python reference implementation. All other language implementations
(C++, C#, Java, Rust) must match this one against the shared golden
vectors in contracts/vectors/.
"""

__version__ = "0.1.0"

ENGINE_NAME = f"python/{__version__}"


class QKError(ValueError):
    """Raised for invalid pricing inputs. CLI maps this to {"ok": false, ...}."""
