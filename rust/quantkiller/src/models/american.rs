//! American-exercise approximations beyond the CRR tree in binomial.rs.
//! Ported from python/quantkiller/models/american.py (itself absorbed from
//! the web-lab merge) -- see that file's docstring for paper references.
//! Barone-Adesi-Whaley, Ju-Zhong, Bjerksund-Stensland 1993/2002, and Carr
//! randomization (PSOR finite-difference, Richardson-extrapolated in phase
//! count).

use std::collections::BTreeMap;

use super::black_scholes;
use crate::error::{QkError, QkResult};
use crate::qkmath::{norm_cdf, norm_pdf};

fn intrinsic(spot: f64, strike: f64, is_call: bool) -> f64 {
    (if is_call { spot - strike } else { strike - spot }).max(0.0)
}

fn european(spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, is_call: bool) -> f64 {
    black_scholes::price(spot, strike, rate, div_yield, vol, time, is_call)["price"]
}

fn validate_american(rate: f64, div_yield: f64) -> QkResult<()> {
    if rate < 0.0 || div_yield < 0.0 {
        return Err(QkError::new("this American approximation requires rate >= 0 and div_yield >= 0"));
    }
    Ok(())
}

fn one(price: f64) -> BTreeMap<String, f64> {
    let mut m = BTreeMap::new();
    m.insert("price".into(), price);
    m
}

// ----- Barone-Adesi-Whaley -----

fn baw_critical_price(strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, is_call: bool) -> (f64, f64) {
    let variance = vol * vol * time;
    let root_variance = variance.sqrt();
    let risk_free_discount = (-rate * time).exp();
    let dividend_discount = (-div_yield * time).exp();
    let n = 2.0 * (dividend_discount / risk_free_discount).ln() / variance;
    let m = -2.0 * risk_free_discount.ln() / variance;
    let carry_time = (dividend_discount / risk_free_discount).ln();

    let upper_exponent;
    let upper;
    let mut boundary;
    if is_call {
        upper_exponent = (-(n - 1.0) + ((n - 1.0) * (n - 1.0) + 4.0 * m).sqrt()) / 2.0;
        upper = strike / (1.0 - 1.0 / upper_exponent);
        let h = -(carry_time + 2.0 * root_variance) * strike / (upper - strike);
        boundary = strike + (upper - strike) * (1.0 - h.exp());
    } else {
        upper_exponent = (-(n - 1.0) - ((n - 1.0) * (n - 1.0) + 4.0 * m).sqrt()) / 2.0;
        upper = strike / (1.0 - 1.0 / upper_exponent);
        let h = (carry_time - 2.0 * root_variance) * strike / (strike - upper);
        boundary = upper + (strike - upper) * h.exp();
    }

    let coefficient = if (1.0 - risk_free_discount).abs() > 1.0e-12 {
        -2.0 * risk_free_discount.ln() / (variance * (1.0 - risk_free_discount))
    } else {
        2.0 / variance
    };
    let exponent = if is_call {
        (-(n - 1.0) + ((n - 1.0) * (n - 1.0) + 4.0 * coefficient).sqrt()) / 2.0
    } else {
        (-(n - 1.0) - ((n - 1.0) * (n - 1.0) + 4.0 * coefficient).sqrt()) / 2.0
    };

    for _ in 0..100 {
        let forward_boundary = boundary * dividend_discount / risk_free_discount;
        let d1 = ((forward_boundary / strike).ln() + 0.5 * variance) / root_variance;
        let euro = european(boundary, strike, rate, div_yield, vol, time, is_call);
        if is_call {
            let lhs = boundary - strike;
            let rhs = euro + (1.0 - dividend_discount * norm_cdf(d1)) * boundary / exponent;
            let slope = dividend_discount * norm_cdf(d1) * (1.0 - 1.0 / exponent)
                + (1.0 - dividend_discount * norm_pdf(d1) / root_variance) / exponent;
            if (lhs - rhs).abs() / strike <= 1.0e-8 {
                break;
            }
            boundary = (strike + rhs - slope * boundary) / (1.0 - slope);
        } else {
            let lhs = strike - boundary;
            let rhs = euro - (1.0 - dividend_discount * norm_cdf(-d1)) * boundary / exponent;
            let slope = -dividend_discount * norm_cdf(-d1) * (1.0 - 1.0 / exponent)
                - (1.0 + dividend_discount * norm_pdf(-d1) / root_variance) / exponent;
            if (lhs - rhs).abs() / strike <= 1.0e-8 {
                break;
            }
            boundary = (strike - rhs + slope * boundary) / (1.0 + slope);
        }
    }
    (boundary, exponent)
}

pub fn baw(spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, is_call: bool) -> QkResult<BTreeMap<String, f64>> {
    validate_american(rate, div_yield)?;
    let euro = european(spot, strike, rate, div_yield, vol, time, is_call);
    let intr = intrinsic(spot, strike, is_call);
    if vol == 0.0 || (is_call && div_yield <= 0.0) {
        return Ok(one(euro.max(intr)));
    }
    let (boundary, exponent) = baw_critical_price(strike, rate, div_yield, vol, time, is_call);
    let variance = vol * vol * time;
    let d1 = ((boundary * ((rate - div_yield) * time).exp() / strike).ln() + 0.5 * variance) / variance.sqrt();
    let dividend_discount = (-div_yield * time).exp();
    let value = if is_call {
        let coefficient = boundary / exponent * (1.0 - dividend_discount * norm_cdf(d1));
        if spot < boundary { euro + coefficient * (spot / boundary).powf(exponent) } else { intr }
    } else {
        let coefficient = -boundary / exponent * (1.0 - dividend_discount * norm_cdf(-d1));
        if spot > boundary { euro + coefficient * (spot / boundary).powf(exponent) } else { intr }
    };
    Ok(one(value.max(euro).max(intr)))
}

// ----- Ju-Zhong -----

pub fn ju_zhong(spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, is_call: bool) -> QkResult<BTreeMap<String, f64>> {
    validate_american(rate, div_yield)?;
    let euro = european(spot, strike, rate, div_yield, vol, time, is_call);
    let intr = intrinsic(spot, strike, is_call);
    if vol == 0.0 || (is_call && div_yield <= 0.0) {
        return Ok(one(euro.max(intr)));
    }
    if rate.abs() < 1e-9 {
        return baw(spot, strike, rate, div_yield, vol, time, is_call);
    }

    let (boundary, _) = baw_critical_price(strike, rate, div_yield, vol, time, is_call);
    let phi = if is_call { 1.0 } else { -1.0 };
    let variance = vol * vol * time;
    let root_variance = variance.sqrt();
    let risk_free_discount = (-rate * time).exp();
    let dividend_discount = (-div_yield * time).exp();
    let h = 1.0 - risk_free_discount;
    let alpha = -2.0 * risk_free_discount.ln() / variance;
    let beta = 2.0 * (dividend_discount / risk_free_discount).ln() / variance;
    let radical = ((beta - 1.0) * (beta - 1.0) + 4.0 * alpha / h).sqrt();
    let exponent = (-(beta - 1.0) + phi * radical) / 2.0;
    let exponent_prime = -phi * alpha / (h * h * radical);
    let european_boundary = european(boundary, strike, rate, div_yield, vol, time, is_call);
    let premium_boundary = phi * (boundary - strike) - european_boundary;
    let denominator = 2.0 * exponent + beta - 1.0;
    if premium_boundary.abs() < 1e-12 || denominator.abs() < 1e-12 {
        return baw(spot, strike, rate, div_yield, vol, time, is_call);
    }
    let forward_boundary = boundary * dividend_discount / risk_free_discount;
    let d1 = ((forward_boundary / strike).ln() + 0.5 * variance) / root_variance;
    let d2 = d1 - root_variance;
    let european_h = forward_boundary * norm_pdf(d1) / (alpha * root_variance)
        - phi * forward_boundary * norm_cdf(phi * d1) * dividend_discount.ln() / risk_free_discount.ln()
        + phi * strike * norm_cdf(phi * d2);
    let quadratic = (1.0 - h) * alpha * exponent_prime / (2.0 * denominator);
    let linear = -(1.0 - h) * alpha / denominator * (european_h / premium_boundary + 1.0 / h + exponent_prime / denominator);
    let log_ratio = (spot / boundary).ln();
    let chi = log_ratio * (quadratic * log_ratio + linear);
    if !chi.is_finite() || (1.0 - chi).abs() <= 1e-8 {
        return baw(spot, strike, rate, div_yield, vol, time, is_call);
    }
    let continuation_region = phi * (boundary - spot) > 0.0;
    let value = if continuation_region {
        euro + premium_boundary * (spot / boundary).powf(exponent) / (1.0 - chi)
    } else {
        intr
    };
    Ok(one(value.max(euro).max(intr)))
}

// ----- Bjerksund-Stensland 1993 -----

fn bjerksund_phi(spot: f64, gamma: f64, boundary: f64, trigger: f64, rate_time: f64, carry_time: f64, variance: f64) -> f64 {
    let root_variance = variance.sqrt();
    let lambda = -rate_time + gamma * carry_time + 0.5 * gamma * (gamma - 1.0) * variance;
    let d = -((spot / boundary).ln() + carry_time + (gamma - 0.5) * variance) / root_variance;
    let kappa = 2.0 * carry_time / variance + 2.0 * gamma - 1.0;
    lambda.exp() * (norm_cdf(d) - (trigger / spot).powf(kappa) * norm_cdf(d - 2.0 * (trigger / spot).ln() / root_variance))
}

fn bjerksund_call(spot: f64, strike: f64, risk_free_discount: f64, dividend_discount: f64, variance: f64) -> f64 {
    let rate_time = (1.0 / risk_free_discount).ln();
    let carry_time = (dividend_discount / risk_free_discount).ln();
    let euro = european(spot, strike, rate_time, rate_time - carry_time, variance.sqrt(), 1.0, true);
    let intr = (spot - strike).max(0.0);
    if dividend_discount >= 1.0 && dividend_discount >= risk_free_discount {
        return euro.max(intr);
    }
    let beta = 0.5 - carry_time / variance + ((carry_time / variance - 0.5).powi(2) + 2.0 * rate_time / variance).sqrt();
    if beta <= 1.0 {
        return euro.max(intr);
    }
    let boundary_infinity = beta / (beta - 1.0) * strike;
    let boundary_zero = if (carry_time - rate_time).abs() < 1.0e-14 {
        strike
    } else {
        strike.max(rate_time / (rate_time - carry_time) * strike)
    };
    let h = -(carry_time + 2.0 * variance.sqrt()) * boundary_zero / (boundary_infinity - boundary_zero);
    let boundary = boundary_zero + (boundary_infinity - boundary_zero) * (1.0 - h.exp());
    let forward = spot * dividend_discount / risk_free_discount;
    if spot >= boundary {
        return intr;
    }
    if (boundary / forward).ln() / variance.sqrt() > 12.5 {
        return euro.max(intr);
    }
    let value = (boundary - strike) * (spot / boundary).powf(beta)
        * (1.0 - bjerksund_phi(spot, beta, boundary, boundary, rate_time, carry_time, variance))
        + spot * bjerksund_phi(spot, 1.0, boundary, boundary, rate_time, carry_time, variance)
        - spot * bjerksund_phi(spot, 1.0, strike, boundary, rate_time, carry_time, variance)
        - strike * bjerksund_phi(spot, 0.0, boundary, boundary, rate_time, carry_time, variance)
        + strike * bjerksund_phi(spot, 0.0, strike, boundary, rate_time, carry_time, variance);
    value.max(euro).max(intr)
}

pub fn bjerksund_1993(spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, is_call: bool) -> QkResult<BTreeMap<String, f64>> {
    validate_american(rate, div_yield)?;
    let euro = european(spot, strike, rate, div_yield, vol, time, is_call);
    let intr = intrinsic(spot, strike, is_call);
    if vol == 0.0 {
        return Ok(one(euro.max(intr)));
    }
    let risk_free_discount = (-rate * time).exp();
    let dividend_discount = (-div_yield * time).exp();
    let variance = vol * vol * time;
    let value = if is_call {
        bjerksund_call(spot, strike, risk_free_discount, dividend_discount, variance)
    } else {
        bjerksund_call(strike, spot, dividend_discount, risk_free_discount, variance)
    };
    Ok(one(value.max(euro).max(intr)))
}

// ----- Bjerksund-Stensland 2002 -----

fn bivariate_normal_cdf(first: f64, second: f64, correlation: f64) -> f64 {
    if first <= -10.0 || second <= -10.0 {
        return 0.0;
    }
    if first >= 10.0 {
        return norm_cdf(second);
    }
    if second >= 10.0 {
        return norm_cdf(first);
    }
    if correlation.abs() < 1.0e-14 {
        return norm_cdf(first) * norm_cdf(second);
    }
    let intervals = 512;
    let lower = -10.0_f64;
    let upper = first.min(10.0);
    let width = (upper - lower) / intervals as f64;
    let correlation_scale = (1.0 - correlation * correlation).sqrt();
    let integrand = |value: f64| norm_pdf(value) * norm_cdf((second - correlation * value) / correlation_scale);
    let mut total = integrand(lower) + integrand(upper);
    for index in 1..intervals {
        total += (if index % 2 == 0 { 2.0 } else { 4.0 }) * integrand(lower + index as f64 * width);
    }
    (total * width / 3.0).clamp(0.0, 1.0)
}

#[allow(clippy::too_many_arguments)]
fn bjerksund_2002_phi(spot: f64, horizon: f64, gamma: f64, cap: f64, trigger: f64, rate: f64, carry: f64, vol: f64) -> f64 {
    let variance = vol * vol;
    let denominator = vol * horizon.sqrt();
    let lambda = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance;
    let kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
    let drift = (carry + (gamma - 0.5) * variance) * horizon;
    let d1 = -((spot / cap).ln() + drift) / denominator;
    let d2 = d1 - 2.0 * (trigger / spot).ln() / denominator;
    (lambda * horizon).exp() * spot.powf(gamma) * (norm_cdf(d1) - (trigger / spot).powf(kappa) * norm_cdf(d2))
}

#[allow(clippy::too_many_arguments)]
fn bjerksund_2002_psi(
    spot: f64, time: f64, gamma: f64, cap: f64, first_boundary: f64, second_boundary: f64,
    split_time: f64, rate: f64, carry: f64, vol: f64,
) -> f64 {
    let variance = vol * vol;
    let lambda = -rate + gamma * carry + 0.5 * gamma * (gamma - 1.0) * variance;
    let kappa = 2.0 * carry / variance + 2.0 * gamma - 1.0;
    let gamma_carry = carry + (gamma - 0.5) * variance;
    let short_scale = vol * split_time.sqrt();
    let full_scale = vol * time.sqrt();
    let short_drift = gamma_carry * split_time;
    let full_drift = gamma_carry * time;
    let correlation = (split_time / time).sqrt();

    let d1 = -((spot / second_boundary).ln() + short_drift) / short_scale;
    let d2 = -((first_boundary * first_boundary / (spot * second_boundary)).ln() + short_drift) / short_scale;
    let d3 = -((spot / second_boundary).ln() - short_drift) / short_scale;
    let d4 = -((first_boundary * first_boundary / (spot * second_boundary)).ln() - short_drift) / short_scale;
    let e1 = -((spot / cap).ln() + full_drift) / full_scale;
    let e2 = -((first_boundary * first_boundary / (spot * cap)).ln() + full_drift) / full_scale;
    let e3 = -((second_boundary * second_boundary / (spot * cap)).ln() + full_drift) / full_scale;
    let e4 = -((spot * second_boundary * second_boundary / (cap * first_boundary * first_boundary)).ln() + full_drift) / full_scale;

    let value = bivariate_normal_cdf(d1, e1, correlation)
        - (first_boundary / spot).powf(kappa) * bivariate_normal_cdf(d2, e2, correlation)
        - (second_boundary / spot).powf(kappa) * bivariate_normal_cdf(d3, e3, -correlation)
        + (second_boundary / first_boundary).powf(kappa) * bivariate_normal_cdf(d4, e4, -correlation);
    (lambda * time).exp() * spot.powf(gamma) * value
}

fn bjerksund_2002_call(spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64) -> f64 {
    let euro = european(spot, strike, rate, div_yield, vol, time, true);
    let intr = (spot - strike).max(0.0);
    let carry = rate - div_yield;
    if vol == 0.0 || carry >= rate {
        return euro.max(intr);
    }
    let variance = vol * vol;
    let beta = 0.5 - carry / variance + ((carry / variance - 0.5).powi(2) + 2.0 * rate / variance).sqrt();
    if beta <= 1.0 {
        return euro.max(intr);
    }
    let boundary_infinity = beta / (beta - 1.0) * strike;
    let boundary_zero = strike.max(rate / (rate - carry) * strike);
    let boundary = |horizon: f64| {
        let h = -(carry * horizon + 2.0 * vol * horizon.sqrt()) * strike * strike
            / ((boundary_infinity - boundary_zero) * boundary_zero);
        boundary_zero + (boundary_infinity - boundary_zero) * (1.0 - h.exp())
    };
    let split_time = 0.5 * (5.0_f64.sqrt() - 1.0) * time;
    let first_boundary = boundary(time);
    let second_boundary = boundary(time - split_time);
    if spot >= first_boundary {
        return intr;
    }
    let alpha_first = (first_boundary - strike) * first_boundary.powf(-beta);
    let alpha_second = (second_boundary - strike) * second_boundary.powf(-beta);
    let phi = bjerksund_2002_phi;
    let psi = bjerksund_2002_psi;
    let value = alpha_first * spot.powf(beta)
        - alpha_first * phi(spot, split_time, beta, first_boundary, first_boundary, rate, carry, vol)
        + phi(spot, split_time, 1.0, first_boundary, first_boundary, rate, carry, vol)
        - phi(spot, split_time, 1.0, second_boundary, first_boundary, rate, carry, vol)
        - strike * phi(spot, split_time, 0.0, first_boundary, first_boundary, rate, carry, vol)
        + strike * phi(spot, split_time, 0.0, second_boundary, first_boundary, rate, carry, vol)
        + alpha_second * phi(spot, split_time, beta, second_boundary, first_boundary, rate, carry, vol)
        - alpha_second * psi(spot, time, beta, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol)
        + psi(spot, time, 1.0, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol)
        - psi(spot, time, 1.0, strike, first_boundary, second_boundary, split_time, rate, carry, vol)
        - strike * psi(spot, time, 0.0, second_boundary, first_boundary, second_boundary, split_time, rate, carry, vol)
        + strike * psi(spot, time, 0.0, strike, first_boundary, second_boundary, split_time, rate, carry, vol);
    value.max(euro).max(intr)
}

pub fn bjerksund_2002(spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, is_call: bool) -> QkResult<BTreeMap<String, f64>> {
    validate_american(rate, div_yield)?;
    let euro = european(spot, strike, rate, div_yield, vol, time, is_call);
    let intr = intrinsic(spot, strike, is_call);
    let value = if is_call {
        bjerksund_2002_call(spot, strike, rate, div_yield, vol, time)
    } else {
        bjerksund_2002_call(strike, spot, div_yield, rate, vol, time)
    };
    Ok(one(value.max(euro).max(intr)))
}

// ----- Carr randomization -----

fn payoff(terminal_spot: f64, strike: f64, is_call: bool) -> f64 {
    (if is_call { terminal_spot - strike } else { strike - terminal_spot }).max(0.0)
}

fn carr_randomization_core(spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, phases: u32, is_call: bool) -> f64 {
    let grid_points: usize = 501;
    let intr = payoff(spot, strike, is_call);
    if vol == 0.0 {
        let fwd = spot * ((rate - div_yield) * time).exp();
        return intr.max((-rate * time).exp() * payoff(fwd, strike, is_call));
    }
    if is_call && div_yield == 0.0 {
        return european(spot, strike, rate, div_yield, vol, time, true);
    }

    let drift = rate - div_yield - 0.5 * vol * vol;
    let half_width = 2.0_f64
        .max((strike / spot).ln().abs() + 1.5)
        .max(5.0 * vol * time.sqrt() + drift.abs() * time);
    let x_min = spot.ln() - half_width;
    let dx = 2.0 * half_width / grid_points as f64;
    let mut exercise = vec![0.0_f64; grid_points + 1];
    for (index, value) in exercise.iter_mut().enumerate() {
        *value = payoff((x_min + index as f64 * dx).exp(), strike, is_call);
    }
    let mut previous = exercise.clone();
    let mut current = exercise.clone();
    let intensity = phases as f64 / time;
    let diffusion = 0.5 * vol * vol / (dx * dx);
    let mut lower_generator = diffusion - drift / (2.0 * dx);
    let mut upper_generator = diffusion + drift / (2.0 * dx);
    if lower_generator < 0.0 || upper_generator < 0.0 {
        lower_generator = diffusion + (-drift).max(0.0) / dx;
        upper_generator = diffusion + drift.max(0.0) / dx;
    }
    let lower = -lower_generator;
    let upper = -upper_generator;
    let diagonal = rate + intensity + lower_generator + upper_generator;
    let omega = 1.2;

    for _phase in 0..phases {
        current.copy_from_slice(&previous);
        current[0] = if is_call { 0.0 } else { exercise[0] };
        current[grid_points] = if is_call { exercise[grid_points] } else { 0.0 };
        for _iteration in 0..10000 {
            let mut max_change = 0.0_f64;
            for index in 1..grid_points {
                let continuation = (intensity * previous[index] - lower * current[index - 1] - upper * current[index + 1]) / diagonal;
                let relaxed = current[index] + omega * (continuation - current[index]);
                let updated = exercise[index].max(relaxed);
                max_change = max_change.max((updated - current[index]).abs());
                current[index] = updated;
            }
            if max_change < 1.0e-10 {
                break;
            }
        }
        std::mem::swap(&mut previous, &mut current);
    }

    let grid_position = (spot.ln() - x_min) / dx;
    let left = (grid_position.floor() as usize).min(grid_points - 1);
    let weight = grid_position - left as f64;
    previous[left] * (1.0 - weight) + previous[left + 1] * weight
}

pub fn carr_randomization(
    spot: f64, strike: f64, rate: f64, div_yield: f64, vol: f64, time: f64, phases: u32, is_call: bool,
) -> QkResult<BTreeMap<String, f64>> {
    validate_american(rate, div_yield)?;
    if !(4..=256).contains(&phases) {
        return Err(QkError::new("carr_randomization requires 4 <= phases <= 256"));
    }
    let coarse = carr_randomization_core(spot, strike, rate, div_yield, vol, time, phases, is_call);
    let fine = carr_randomization_core(spot, strike, rate, div_yield, vol, time, 2 * phases, is_call);
    let extrapolated = 2.0 * fine - coarse;
    let lower = payoff(spot, strike, is_call);
    let upper = if is_call { spot } else { strike };
    Ok(one(extrapolated.clamp(lower, upper)))
}
