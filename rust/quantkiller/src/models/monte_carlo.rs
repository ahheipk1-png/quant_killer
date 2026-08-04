//! Monte Carlo pricing of European options under GBM. Exact algorithm per
//! contracts/rng-spec.md section 5 -- loop order and accumulation order are
//! part of the spec so every language agrees for the same seed.

use std::collections::BTreeMap;

use crate::error::{QkError, QkResult};
use crate::rng::Pcg32;

#[allow(clippy::too_many_arguments)]
pub fn price(
    spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64,
    is_call: bool, paths: u64, seed: u64, antithetic: bool,
) -> QkResult<BTreeMap<String, f64>> {
    let sign = if is_call { 1.0 } else { -1.0 };
    if time <= 0.0 {
        return Err(QkError::new("monte_carlo_gbm requires time > 0"));
    }
    if paths < 2 {
        return Err(QkError::new("monte_carlo_gbm requires paths >= 2"));
    }

    let mut rng = Pcg32::new(seed);
    let disc = (-rate * time).exp();
    let drift = (rate - div_yield - 0.5 * vol * vol) * time;
    let volt = vol * time.sqrt();

    let mut total = 0.0_f64;
    let mut total_sq = 0.0_f64;
    for _ in 0..paths {
        let z = rng.next_normal();
        let p1 = (sign * (spot * (drift + volt * z).exp() - strike)).max(0.0);
        let s = if antithetic {
            let p2 = (sign * (spot * (drift - volt * z).exp() - strike)).max(0.0);
            0.5 * (p1 + p2)
        } else {
            p1
        };
        total += s;
        total_sq += s * s;
    }

    let n = paths as f64;
    let mean = total / n;
    let mut variance = (total_sq - n * mean * mean) / (n - 1.0);
    if variance < 0.0 {
        variance = 0.0;
    }

    let mut out = BTreeMap::new();
    out.insert("price".into(), disc * mean);
    out.insert("std_error".into(), disc * (variance / n).sqrt());
    Ok(out)
}
