//! Special functions per contracts/rng-spec.md (FROZEN). norm_cdf/norminv are
//! Hart(1968)/West(2005) and Acklam's rational approximations respectively,
//! implemented identically in every QuantKiller language rather than relying
//! on the platform's own erf (runtimes differ in the last bits).

pub const SQRT_TWO_PI: f64 = 2.5066282746310005;

pub fn norm_pdf(x: f64) -> f64 {
    (-0.5 * x * x).exp() / SQRT_TWO_PI
}

pub fn norm_cdf(x: f64) -> f64 {
    let absolute_x = x.abs();
    let tail = if absolute_x > 37.0 {
        0.0
    } else {
        let exponential = (-0.5 * absolute_x * absolute_x).exp();
        if absolute_x < 7.07106781186547 {
            let mut numerator = 3.52624965998911e-02_f64;
            numerator = numerator * absolute_x + 0.700383064443688;
            numerator = numerator * absolute_x + 6.37396220353165;
            numerator = numerator * absolute_x + 33.912866078383;
            numerator = numerator * absolute_x + 112.079291497871;
            numerator = numerator * absolute_x + 221.213596169931;
            numerator = numerator * absolute_x + 220.206867912376;
            let mut denominator = 8.83883476483184e-02_f64;
            denominator = denominator * absolute_x + 1.75566716318264;
            denominator = denominator * absolute_x + 16.064177579207;
            denominator = denominator * absolute_x + 86.7807322029461;
            denominator = denominator * absolute_x + 296.564248779674;
            denominator = denominator * absolute_x + 637.333633378831;
            denominator = denominator * absolute_x + 793.826512519948;
            denominator = denominator * absolute_x + 440.413735824752;
            exponential * numerator / denominator
        } else {
            let mut continued_fraction = absolute_x + 0.65;
            continued_fraction = absolute_x + 4.0 / continued_fraction;
            continued_fraction = absolute_x + 3.0 / continued_fraction;
            continued_fraction = absolute_x + 2.0 / continued_fraction;
            continued_fraction = absolute_x + 1.0 / continued_fraction;
            exponential / (continued_fraction * 2.506628274631)
        }
    };
    if x > 0.0 {
        1.0 - tail
    } else {
        tail
    }
}

const A: [f64; 6] = [
    -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00,
];
const B: [f64; 5] = [
    -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01,
];
const C: [f64; 6] = [
    -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00,
];
const D: [f64; 4] = [
    7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00,
];

const P_LOW: f64 = 0.02425;
const P_HIGH: f64 = 1.0 - P_LOW;

/// Inverse standard normal CDF for p in (0, 1). Acklam + one Halley refinement.
pub fn norminv(p: f64) -> f64 {
    assert!(p > 0.0 && p < 1.0, "norminv requires 0 < p < 1, got {p}");

    let mut x = if p < P_LOW {
        let q = (-2.0 * p.ln()).sqrt();
        ((((( C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if p <= P_HIGH {
        let q = p - 0.5;
        let r = q * q;
        ((((( A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        -((((( C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    };

    let e = norm_cdf(x) - p;
    let u = e * SQRT_TWO_PI * (0.5 * x * x).exp();
    x -= u / (1.0 + 0.5 * x * u);
    x
}
