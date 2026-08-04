"""Model registry: model name -> adapter(params dict) -> results dict.

Every adapter takes the `params` object of a pricing request
(contracts/schema/request.schema.json) and returns the numeric `results`
object of the response. Invalid input raises QKError.
"""

from . import black_scholes, binomial, monte_carlo, implied_vol, forward, parity, american

MODELS = {
    "black_scholes": black_scholes.run,
    "binomial_crr": binomial.run,
    "monte_carlo_gbm": monte_carlo.run,
    "implied_vol": implied_vol.run,
    "forward": forward.run,
    "put_call_parity": parity.run,
    "american_baw": american.run_baw,
    "american_ju_zhong": american.run_ju_zhong,
    "american_bjerksund_1993": american.run_bjerksund_1993,
    "american_bjerksund_2002": american.run_bjerksund_2002,
    "american_carr_randomization": american.run_carr_randomization,
}
