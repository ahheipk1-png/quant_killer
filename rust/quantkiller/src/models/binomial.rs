//! Cox-Ross-Rubinstein binomial tree, European and American. Mirrors
//! python/quantkiller/models/binomial.py's loop order exactly.

use std::collections::BTreeMap;

use crate::error::{QkError, QkResult};

pub fn price(
    spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64,
    is_call: bool, american: bool, steps: usize,
) -> QkResult<BTreeMap<String, f64>> {
    let sign = if is_call { 1.0 } else { -1.0 };
    if vol <= 0.0 {
        return Err(QkError::new("binomial_crr requires vol > 0"));
    }
    if time <= 0.0 {
        return Err(QkError::new("binomial_crr requires time > 0"));
    }

    let dt = time / steps as f64;
    let u = (vol * dt.sqrt()).exp();
    let d = 1.0 / u;
    let a = ((rate - div_yield) * dt).exp();
    let p = (a - d) / (u - d);
    if !(p > 0.0 && p < 1.0) {
        return Err(QkError::new(format!("CRR risk-neutral probability out of (0,1): p={p}")));
    }
    let disc = (-rate * dt).exp();
    let u2 = u * u;

    let mut values = vec![0.0_f64; steps + 1];
    let mut s = spot * d.powi(steps as i32);
    for j in 0..=steps {
        values[j] = (sign * (s - strike)).max(0.0);
        s *= u2;
    }

    let mut v2: Option<[f64; 3]> = None;
    let mut v1: Option<[f64; 2]> = None;

    for i in (0..steps).rev() {
        s = spot * d.powi(i as i32);
        for j in 0..=i {
            let mut cont = disc * (p * values[j + 1] + (1.0 - p) * values[j]);
            if american {
                cont = cont.max(sign * (s - strike));
            }
            values[j] = cont;
            s *= u2;
        }
        if i == 2 {
            v2 = Some([values[0], values[1], values[2]]);
        } else if i == 1 {
            v1 = Some([values[0], values[1]]);
        }
    }

    let root = values[0];
    let mut out = BTreeMap::new();
    out.insert("price".into(), root);
    if steps >= 2 {
        if let (Some(v1), Some(v2)) = (v1, v2) {
            let s_u = spot * u;
            let s_d = spot * d;
            let delta = (v1[1] - v1[0]) / (s_u - s_d);
            let s_uu = spot * u2;
            let s_mid = spot;
            let s_dd = spot * d * d;
            let delta_up = (v2[2] - v2[1]) / (s_uu - s_mid);
            let delta_dn = (v2[1] - v2[0]) / (s_mid - s_dd);
            let gamma = (delta_up - delta_dn) / (0.5 * (s_uu - s_dd));
            let theta = (v2[1] - root) / (2.0 * dt);
            out.insert("delta".into(), delta);
            out.insert("gamma".into(), gamma);
            out.insert("theta".into(), theta);
        }
    }
    Ok(out)
}
