//! QuantKiller CLI -- the universal cross-language bridge.
//! See python/quantkiller/cli.py for the shared request/response protocol.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, Read};

use quantkiller::error::QkError;
use quantkiller::models::{american, binomial, black_scholes, forward_parity, implied_vol, monte_carlo};
use quantkiller::ENGINE_NAME;
use serde_json::{json, Value};

fn get_num(params: &Value, key: &str) -> Result<f64, QkError> {
    params.get(key).and_then(|v| v.as_f64()).ok_or_else(|| QkError::new(format!("missing/invalid parameter '{key}'")))
}

fn get_num_default(params: &Value, key: &str, default: f64) -> f64 {
    params.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
}

fn get_opt_num(params: &Value, key: &str) -> Option<f64> {
    params.get(key).and_then(|v| v.as_f64())
}

fn get_int(params: &Value, key: &str) -> Result<i64, QkError> {
    params.get(key).and_then(|v| v.as_i64()).ok_or_else(|| QkError::new(format!("missing/invalid parameter '{key}'")))
}

fn get_int_default(params: &Value, key: &str, default: i64) -> i64 {
    params.get(key).and_then(|v| v.as_i64()).unwrap_or(default)
}

fn get_bool_default(params: &Value, key: &str, default: bool) -> bool {
    params.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

fn is_call(params: &Value) -> Result<bool, QkError> {
    match params.get("option_type").and_then(|v| v.as_str()) {
        Some("call") => Ok(true),
        Some("put") => Ok(false),
        other => Err(QkError::new(format!("option_type must be 'call' or 'put', got {other:?}"))),
    }
}

fn is_american(params: &Value) -> Result<bool, QkError> {
    match params.get("style").and_then(|v| v.as_str()).unwrap_or("european") {
        "european" => Ok(false),
        "american" => Ok(true),
        other => Err(QkError::new(format!("style must be 'european' or 'american', got {other}"))),
    }
}

fn to_json_map(results: BTreeMap<String, f64>) -> Value {
    let map: serde_json::Map<String, Value> =
        results.into_iter().map(|(k, v)| (k, json!(v))).collect();
    Value::Object(map)
}

fn dispatch(model: &str, params: &Value) -> Result<BTreeMap<String, f64>, QkError> {
    match model {
        "black_scholes" => Ok(black_scholes::price(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "vol")?,
            get_num(params, "time")?, is_call(params)?)),
        "binomial_crr" => binomial::price(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "vol")?,
            get_num(params, "time")?, is_call(params)?, is_american(params)?,
            get_int(params, "steps")? as usize),
        "monte_carlo_gbm" => monte_carlo::price(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "vol")?,
            get_num(params, "time")?, is_call(params)?, get_int(params, "paths")? as u64,
            get_int_default(params, "seed", 42) as u64, get_bool_default(params, "antithetic", true)),
        "implied_vol" => implied_vol::solve(
            get_num(params, "price")?, get_num(params, "spot")?, get_num(params, "strike")?,
            get_num(params, "rate")?, get_num_default(params, "div_yield", 0.0),
            get_num(params, "time")?, is_call(params)?),
        "forward" => Ok(forward_parity::forward_price(
            get_num(params, "spot")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "time")?,
            get_opt_num(params, "strike"))),
        "put_call_parity" => forward_parity::parity(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "time")?,
            get_opt_num(params, "call_price"), get_opt_num(params, "put_price")),
        "american_baw" => american::baw(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "vol")?,
            get_num(params, "time")?, is_call(params)?),
        "american_ju_zhong" => american::ju_zhong(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "vol")?,
            get_num(params, "time")?, is_call(params)?),
        "american_bjerksund_1993" => american::bjerksund_1993(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "vol")?,
            get_num(params, "time")?, is_call(params)?),
        "american_bjerksund_2002" => american::bjerksund_2002(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "vol")?,
            get_num(params, "time")?, is_call(params)?),
        "american_carr_randomization" => american::carr_randomization(
            get_num(params, "spot")?, get_num(params, "strike")?, get_num(params, "rate")?,
            get_num_default(params, "div_yield", 0.0), get_num(params, "vol")?,
            get_num(params, "time")?, get_int_default(params, "phases", 64) as u32, is_call(params)?),
        other => Err(QkError::new(format!("unknown model '{other}'; run 'quantkiller-cli models'"))),
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let code = run(&args);
    std::process::exit(code);
}

fn run(args: &[String]) -> i32 {
    if args.len() < 2 {
        print_usage();
        return 2;
    }
    match args[1].as_str() {
        "version" => {
            println!("{ENGINE_NAME}");
            0
        }
        "models" => {
            for name in [
                "black_scholes", "binomial_crr", "monte_carlo_gbm", "implied_vol", "forward",
                "put_call_parity", "american_baw", "american_ju_zhong", "american_bjerksund_1993",
                "american_bjerksund_2002", "american_carr_randomization",
            ] {
                println!("{name}");
            }
            0
        }
        "price" => run_price(args),
        _ => {
            print_usage();
            2
        }
    }
}

fn run_price(args: &[String]) -> i32 {
    let json_arg = args.iter().position(|a| a == "--json").and_then(|i| args.get(i + 1));
    let Some(json_arg) = json_arg else {
        println!("{}", json!({"ok": false, "error": "usage: quantkiller-cli price --json <file|->"}));
        return 2;
    };

    let raw = if json_arg == "-" {
        let mut buf = String::new();
        match io::stdin().read_to_string(&mut buf) {
            Ok(_) => buf,
            Err(e) => {
                println!("{}", json!({"ok": false, "error": format!("bad request input: {e}")}));
                return 1;
            }
        }
    } else {
        match fs::read_to_string(json_arg) {
            Ok(s) => s,
            Err(e) => {
                println!("{}", json!({"ok": false, "error": format!("bad request input: {e}")}));
                return 1;
            }
        }
    };

    let request: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            println!("{}", json!({"ok": false, "error": format!("bad request input: {e}")}));
            return 1;
        }
    };

    let model = match request.get("model").and_then(|v| v.as_str()) {
        Some(m) => m.to_string(),
        None => {
            println!("{}", json!({"ok": false, "error": "request must have 'model' (string) and 'params' (object)"}));
            return 1;
        }
    };
    let params = match request.get("params") {
        Some(p) if p.is_object() => p,
        _ => {
            println!("{}", json!({"ok": false, "error": "request must have 'model' (string) and 'params' (object)"}));
            return 1;
        }
    };

    match dispatch(&model, params) {
        Ok(results) => {
            println!("{}", json!({"ok": true, "model": model, "engine": ENGINE_NAME, "results": to_json_map(results)}));
            0
        }
        Err(e) => {
            println!("{}", json!({"ok": false, "error": e.0}));
            1
        }
    }
}

fn print_usage() {
    println!("quantkiller-cli price --json <file|->   price a JSON request");
    println!("quantkiller-cli models                  list available models");
    println!("quantkiller-cli version                 print engine identifier");
}
