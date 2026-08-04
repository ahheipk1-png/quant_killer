//! Forward pricing by cost of carry and put-call parity. Mirrors
//! python/quantkiller/models/forward.py and parity.py.

use std::collections::BTreeMap;

use crate::error::{QkError, QkResult};

pub fn forward_price(spot: f64, rate: f64, div_yield: f64, time: f64, strike: Option<f64>) -> BTreeMap<String, f64> {
    let fwd = spot * ((rate - div_yield) * time).exp();
    let mut out = BTreeMap::new();
    out.insert("forward_price".into(), fwd);
    if let Some(k) = strike {
        out.insert("value".into(), (fwd - k) * (-rate * time).exp());
    }
    out
}

pub fn parity(
    spot: f64, strike: f64, rate: f64, div_yield: f64, time: f64,
    call_price: Option<f64>, put_price: Option<f64>,
) -> QkResult<BTreeMap<String, f64>> {
    if call_price.is_none() && put_price.is_none() {
        return Err(QkError::new("put_call_parity needs call_price and/or put_price"));
    }
    let basis = spot * (-div_yield * time).exp() - strike * (-rate * time).exp();
    let mut out = BTreeMap::new();
    match (call_price, put_price) {
        (Some(c), Some(p)) => {
            out.insert("residual".into(), c - p - basis);
        }
        (Some(c), None) => {
            out.insert("put_price".into(), c - basis);
            out.insert("residual".into(), 0.0);
        }
        (None, Some(p)) => {
            out.insert("call_price".into(), p + basis);
            out.insert("residual".into(), 0.0);
        }
        (None, None) => unreachable!(),
    }
    Ok(out)
}
