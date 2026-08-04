//! Black-Scholes-Merton closed form with continuous dividend yield, plus
//! Greeks. Mirrors python/quantkiller/models/black_scholes.py exactly,
//! including the T==0 and vol==0 edge conventions.

use std::collections::BTreeMap;

use crate::qkmath::{norm_cdf, norm_pdf};

pub fn price(
    spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, is_call: bool,
) -> BTreeMap<String, f64> {
    let sign = if is_call { 1.0 } else { -1.0 };
    let mut out = BTreeMap::new();

    if time == 0.0 {
        let intrinsic = (sign * (spot - strike)).max(0.0);
        let delta = if spot == strike {
            sign * 0.5
        } else if sign * (spot - strike) > 0.0 {
            sign
        } else {
            0.0
        };
        out.insert("price".into(), intrinsic);
        out.insert("delta".into(), delta);
        out.insert("gamma".into(), 0.0);
        out.insert("vega".into(), 0.0);
        out.insert("theta".into(), 0.0);
        out.insert("rho".into(), 0.0);
        return out;
    }

    let df_r = (-rate * time).exp();
    let df_q = (-div_yield * time).exp();

    if vol == 0.0 {
        let fwd = spot * df_q / df_r;
        let intrinsic = (sign * (fwd - strike)).max(0.0) * df_r;
        let in_money = sign * (fwd - strike) > 0.0;
        let delta = if in_money { sign * df_q } else { 0.0 };
        out.insert("price".into(), intrinsic);
        out.insert("delta".into(), delta);
        out.insert("gamma".into(), 0.0);
        out.insert("vega".into(), 0.0);
        out.insert("theta".into(), 0.0);
        out.insert("rho".into(), 0.0);
        return out;
    }

    let sqrt_t = time.sqrt();
    let d1 = ((spot / strike).ln() + (rate - div_yield + 0.5 * vol * vol) * time) / (vol * sqrt_t);
    let d2 = d1 - vol * sqrt_t;
    let pdf_d1 = norm_pdf(d1);

    let gamma = df_q * pdf_d1 / (spot * vol * sqrt_t);
    let vega = spot * df_q * pdf_d1 * sqrt_t;

    let (p, delta, theta, rho);
    if is_call {
        let nd1 = norm_cdf(d1);
        let nd2 = norm_cdf(d2);
        p = spot * df_q * nd1 - strike * df_r * nd2;
        delta = df_q * nd1;
        theta = -spot * df_q * pdf_d1 * vol / (2.0 * sqrt_t) + div_yield * spot * df_q * nd1
            - rate * strike * df_r * nd2;
        rho = strike * time * df_r * nd2;
    } else {
        let nmd1 = norm_cdf(-d1);
        let nmd2 = norm_cdf(-d2);
        p = strike * df_r * nmd2 - spot * df_q * nmd1;
        delta = -df_q * nmd1;
        theta = -spot * df_q * pdf_d1 * vol / (2.0 * sqrt_t) - div_yield * spot * df_q * nmd1
            + rate * strike * df_r * nmd2;
        rho = -strike * time * df_r * nmd2;
    }

    out.insert("price".into(), p);
    out.insert("delta".into(), delta);
    out.insert("gamma".into(), gamma);
    out.insert("vega".into(), vega);
    out.insert("theta".into(), theta);
    out.insert("rho".into(), rho);
    out.insert("d1".into(), d1);
    out.insert("d2".into(), d2);
    out
}
