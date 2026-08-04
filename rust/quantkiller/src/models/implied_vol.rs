//! Implied volatility via safeguarded Newton/bisection. Mirrors
//! python/quantkiller/models/implied_vol.py exactly.

use std::collections::BTreeMap;
use std::f64::consts::PI;

use super::black_scholes;
use crate::error::{QkError, QkResult};

const SIGMA_MIN: f64 = 1e-9;
const SIGMA_MAX: f64 = 5.0;
const MAX_ITER: u32 = 100;

pub fn solve(
    target: f64, spot: f64, strike: f64, rate: f64, div_yield: f64, time: f64, is_call: bool,
) -> QkResult<BTreeMap<String, f64>> {
    if time <= 0.0 {
        return Err(QkError::new("implied_vol requires time > 0"));
    }

    let df_r = (-rate * time).exp();
    let df_q = (-div_yield * time).exp();
    let (lower, upper) = if is_call {
        ((spot * df_q - strike * df_r).max(0.0), spot * df_q)
    } else {
        ((strike * df_r - spot * df_q).max(0.0), strike * df_r)
    };

    let tol = 1e-12 * (1.0 + target.abs());
    if target < lower - tol || target > upper + tol {
        return Err(QkError::new(format!(
            "target price {target} violates no-arbitrage bounds [{lower}, {upper}]"
        )));
    }
    let mut out = BTreeMap::new();
    if target <= lower + tol {
        out.insert("implied_vol".into(), 0.0);
        out.insert("iterations".into(), 0.0);
        return Ok(out);
    }

    let mut sigma = (2.0 * PI / time).sqrt() * target / spot;
    sigma = sigma.clamp(1e-4, SIGMA_MAX);
    let mut lo = SIGMA_MIN;
    let mut hi = SIGMA_MAX;

    let f = |vol: f64| black_scholes::price(spot, strike, rate, div_yield, vol, time, is_call);

    let mut iterations: u32 = 0;
    loop {
        iterations += 1;
        let outp = f(sigma);
        let diff = outp["price"] - target;
        if diff.abs() <= tol {
            break;
        }
        if diff > 0.0 {
            hi = sigma;
        } else {
            lo = sigma;
        }
        let vega = outp["vega"];
        let mut step_ok = false;
        let mut sigma_next = 0.0;
        if vega > 1e-12 {
            let candidate = sigma - diff / vega;
            if candidate > lo && candidate < hi {
                step_ok = (candidate - sigma).abs() > 1e-14;
                sigma_next = candidate;
            }
        }
        if !step_ok {
            sigma_next = 0.5 * (lo + hi);
            if (sigma_next - sigma).abs() <= 1e-14 {
                break;
            }
        }
        sigma = sigma_next;
        if iterations >= MAX_ITER {
            break;
        }
    }

    if (f(sigma)["price"] - target).abs() > (tol).max(1e-8 * (1.0 + target.abs())) {
        return Err(QkError::new("implied_vol did not converge"));
    }

    out.insert("implied_vol".into(), sigma);
    out.insert("iterations".into(), iterations.min(MAX_ITER) as f64);
    Ok(out)
}
