const HEADER_SIZE: usize = 64;
const PARAMETER_COUNT: usize = 324;
const PCG_MULTIPLIER: u64 = 6_364_136_223_846_793_005;

static mut PARAMETERS: [f64; PARAMETER_COUNT] = [0.0; PARAMETER_COUNT];
static mut LAST_STANDARD_ERROR: f64 = 0.0;
static mut LAST_STANDARD_DEVIATION: f64 = 0.0;

fn p(index: usize) -> f64 { unsafe { PARAMETERS[index] } }

struct Pcg32 { state: u64, increment: u64 }
impl Pcg32 {
    fn new(seed: u64) -> Self {
        let mut rng = Self { state: 0, increment: 3 };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }
    fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(PCG_MULTIPLIER).wrapping_add(self.increment);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        xorshifted.rotate_right((old >> 59) as u32)
    }
    fn uniform(&mut self) -> f64 { (self.next_u32() as f64 + 0.5) / 4_294_967_296.0 }
}

fn inverse_normal(probability: f64) -> f64 {
    let a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
        138.3577518672690, -30.66479806614716, 2.506628277459239];
    let b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
        66.80131188771972, -13.28068155288572];
    let c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
        -2.549732539343734, 4.374664141464968, 2.938163982698783];
    let d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    let value = probability.clamp(1e-14, 1.0 - 1e-14);
    if value < 0.02425 {
        let q = libm::sqrt(-2.0 * libm::log(value));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    }
    if value <= 0.97575 {
        let q = value - 0.5;
        let r = q * q;
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
    }
    let q = libm::sqrt(-2.0 * libm::log(1.0 - value));
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
}

fn normal_cdf(value: f64) -> f64 { 0.5 * libm::erfc(-value / libm::sqrt(2.0)) }
fn payoff(spot: f64, strike: f64, is_call: bool) -> f64 {
    if is_call { (spot - strike).max(0.0) } else { (strike - spot).max(0.0) }
}
fn black_scholes(spot: f64, strike: f64, rate: f64, dividend: f64,
                 volatility: f64, maturity: f64, is_call: bool) -> f64 {
    if maturity <= 0.0 { return payoff(spot, strike, is_call); }
    if volatility <= 1e-14 {
        let forward = spot * libm::exp((rate - dividend) * maturity);
        return libm::exp(-rate * maturity) * payoff(forward, strike, is_call);
    }
    let root = libm::sqrt(maturity);
    let d1 = (libm::log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * maturity) /
        (volatility * root);
    let d2 = d1 - volatility * root;
    let ds = spot * libm::exp(-dividend * maturity);
    let dk = strike * libm::exp(-rate * maturity);
    if is_call { ds * normal_cdf(d1) - dk * normal_cdf(d2) }
    else { dk * normal_cdf(-d2) - ds * normal_cdf(-d1) }
}

fn asset_count() -> usize {
    match p(0) as i32 {
        4 => 2,
        6 => (p(35) as usize).clamp(1, 3),
        _ if p(55) as i32 != 0 => (p(56) as usize).clamp(1, 3),
        _ => 1,
    }
}
fn weights(count: usize) -> Vec<f64> {
    let mut result: Vec<f64> = (0..count).map(|index| p(58 + index)).collect();
    let total: f64 = result.iter().sum();
    if total.abs() < 1e-14 { result.fill(1.0 / count as f64); }
    else { for value in &mut result { *value /= total; } }
    result
}
fn term_vol(base_vol: f64, time: f64) -> f64 {
    let ending = base_vol * p(7) / p(6);
    let weight = (time / p(13)).clamp(0.0, 1.0);
    base_vol + (ending - base_vol) * weight
}
fn leverage(spot: f64, initial: f64) -> f64 {
    let ratio = (spot / initial).max(1e-8);
    libm::exp(p(8) * libm::log(ratio)).clamp(0.2, 5.0)
}
fn correlate(values: &[f64]) -> Vec<f64> {
    if values.len() == 1 { return values.to_vec(); }
    let correlation = p(28);
    let mut result = vec![0.0; values.len()];
    result[0] = values[0];
    let l22 = libm::sqrt((1.0 - correlation * correlation).max(0.0));
    result[1] = correlation * values[0] + l22 * values[1];
    if values.len() == 3 {
        let l32 = if l22 > 1e-14 { correlation * (1.0 - correlation) / l22 } else { 0.0 };
        let l33 = libm::sqrt((1.0 - correlation * correlation - l32 * l32).max(0.0));
        result[2] = correlation * values[0] + l32 * values[1] + l33 * values[2];
    }
    result
}

struct Simulation { paths: Vec<Vec<f64>>, underlying: Vec<f64>, log_returns: Vec<f64> }

fn effective_underlying(paths: &[Vec<f64>], initial: &[f64]) -> Vec<f64> {
    let mode = p(55) as i32;
    if mode == 0 || paths.len() == 1 { return paths[0].clone(); }
    let basket_weights = weights(paths.len());
    let initial_weighted: f64 = basket_weights.iter().zip(initial).map(|(w, s)| w * s).sum();
    let mut result = vec![0.0; paths[0].len()];
    for step in 0..result.len() {
        result[step] = match mode {
            1 => paths.iter().enumerate().map(|(a, path)| basket_weights[a] * path[step]).sum(),
            2 => {
                let mut performance: Vec<f64> = paths.iter().enumerate()
                    .map(|(a, path)| path[step] / initial[a]).collect();
                performance.sort_by(|a, b| b.partial_cmp(a).unwrap());
                let rank = (p(57) as usize).clamp(1, performance.len()) - 1;
                p(2) * performance[rank]
            },
            3 => p(2) * paths.iter().enumerate()
                .map(|(a, path)| basket_weights[a] * path[step] / initial[a]).sum::<f64>(),
            _ => p(2) * paths.iter().enumerate()
                .map(|(a, path)| basket_weights[a] * path[step]).sum::<f64>() / initial_weighted,
        };
    }
    result
}

fn simulate(schedule: &[f64], rng: &mut Pcg32) -> Simulation {
    let assets = asset_count();
    let initial = [p(2), p(22), p(25)][..assets].to_vec();
    let base_vols = [p(6), p(23), p(26)][..assets].to_vec();
    let dividends = [p(5), p(24), p(27)][..assets].to_vec();
    let mut spots = initial.clone();
    let mut variances: Vec<f64> = base_vols.iter().map(|value| value * value).collect();
    let mut paths = vec![vec![0.0; schedule.len()]; assets];
    let mut previous_time = 0.0;
    for (step, &time) in schedule.iter().enumerate() {
        let dt = time - previous_time;
        let root_dt = libm::sqrt(dt);
        let independent_spot: Vec<f64> = (0..assets).map(|_| inverse_normal(rng.uniform())).collect();
        let independent_variance: Vec<f64> = (0..assets).map(|_| inverse_normal(rng.uniform())).collect();
        let spot_normals = correlate(&independent_spot);
        for asset in 0..assets {
            let deterministic = term_vol(base_vols[asset], previous_time + 0.5 * dt);
            let stochastic = p(1) as i32 == 3 || p(1) as i32 == 4;
            if stochastic && p(11) <= 1e-14 { variances[asset] = deterministic * deterministic; }
            let variance = variances[asset].max(0.0);
            let instantaneous = match p(1) as i32 {
                0 => base_vols[asset],
                1 => deterministic,
                2 => deterministic * leverage(spots[asset], initial[asset]),
                4 => libm::sqrt(variance) * leverage(spots[asset], initial[asset]),
                _ => libm::sqrt(variance),
            };
            spots[asset] *= libm::exp((p(4) - dividends[asset] - 0.5 * instantaneous * instantaneous) * dt +
                instantaneous * root_dt * spot_normals[asset]);
            paths[asset][step] = spots[asset];
            if stochastic && p(11) > 1e-14 {
                let z_variance = p(12) * spot_normals[asset] +
                    libm::sqrt((1.0 - p(12) * p(12)).max(0.0)) * independent_variance[asset];
                let scale = base_vols[asset] / p(6);
                let theta = (p(10) * scale) * (p(10) * scale);
                variances[asset] = (variance + p(9) * (theta - variance) * dt +
                    p(11) * libm::sqrt(variance) * root_dt * z_variance).max(0.0);
            }
        }
        previous_time = time;
    }
    let underlying = effective_underlying(&paths, &initial);
    let mut previous = p(2);
    if p(55) as i32 == 1 {
        previous = weights(assets).iter().zip(&initial).map(|(w, s)| w * s).sum();
    }
    let mut log_returns = Vec::with_capacity(schedule.len());
    for &value in &underlying {
        log_returns.push(libm::log(value / previous));
        previous = value;
    }
    Simulation { paths, underlying, log_returns }
}

fn phoenix_value(path: &[f64], schedule: &[f64], allow_autocall: bool) -> f64 {
    let mut present = 0.0;
    let mut missed = 0;
    for (index, &value) in path.iter().enumerate() {
        if value >= p(45) * p(2) {
            let count = if p(46) as i32 == 1 { missed + 1 } else { 1 };
            present += libm::exp(-p(4) * schedule[index]) * p(30) * p(31) * count as f64;
            missed = 0;
        } else if p(46) as i32 == 1 { missed += 1; }
        if allow_autocall && value >= p(32) * p(2) {
            return present + libm::exp(-p(4) * schedule[index]) * p(30);
        }
    }
    let terminal = *path.last().unwrap();
    let redemption = if terminal >= p(33) * p(2) { p(30) } else { p(30) * terminal / p(2) };
    present + libm::exp(-p(4) * p(13)) * redemption
}

fn path_value(simulation: &Simulation, schedule: &[f64]) -> f64 {
    let product = p(0) as i32;
    let path = &simulation.underlying;
    let terminal = *path.last().unwrap();
    let discount = libm::exp(-p(4) * p(13));
    let is_call = p(14) as i32 == 1;
    match product {
        0 => discount * if (is_call && terminal > p(3)) || (!is_call && terminal < p(3)) { p(16) } else { 0.0 },
        1 | 2 => {
            let hit = if product == 1 {
                path.iter().any(|&v| if p(18) as i32 == 1 { v >= p(17) } else { v <= p(17) })
            } else { path.iter().any(|&v| v <= p(20) || v >= p(21)) };
            let active = if p(19) as i32 == 1 { hit } else { !hit };
            discount * payoff(terminal, p(3), is_call) * if active { 1.0 } else { 0.0 }
        },
        4 => {
            let second = *simulation.paths[1].last().unwrap();
            let selected = if p(29) as i32 == 1 { terminal.max(second) } else { terminal.min(second) };
            discount * payoff(selected, p(3), is_call)
        },
        5 => {
            for (index, &value) in path.iter().enumerate() {
                if value >= p(32) * p(2) {
                    return libm::exp(-p(4) * schedule[index]) * p(30) * (1.0 + p(31) * (index + 1) as f64);
                }
            }
            let redemption = if terminal >= p(33) * p(2) {
                p(30) * (1.0 + p(31) * path.len() as f64)
            } else { p(30) * terminal / p(2) };
            discount * redemption
        },
        11 => phoenix_value(path, schedule, true),
        17 => phoenix_value(path, schedule, false),
        6 => {
            let count = (p(35) as usize).min(simulation.paths.len());
            let initial = [p(2), p(22), p(25)];
            let mut active = vec![true; count];
            let mut total = 0.0;
            for step in 0..schedule.len() {
                let mut best_asset = 0;
                let mut best_return = f64::NEG_INFINITY;
                for asset in 0..count {
                    if !active[asset] { continue; }
                    let previous = if step == 0 { initial[asset] } else { simulation.paths[asset][step - 1] };
                    let interval_return = simulation.paths[asset][step] / previous - 1.0;
                    if interval_return > best_return { best_return = interval_return; best_asset = asset; }
                }
                total += best_return;
                active[best_asset] = false;
            }
            discount * p(30) * (total / schedule.len() as f64 - p(36)).max(0.0)
        },
        7 => {
            let extremum = if is_call { path.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b)) }
                else { path.iter().fold(f64::INFINITY, |a, &b| a.min(b)) };
            discount * payoff(extremum, p(3), is_call)
        },
        8 => {
            let mut locked: f64 = 0.0;
            for rung_index in 0..p(40) as usize {
                let rung = p(37 + rung_index);
                for &value in path {
                    if is_call && value >= rung { locked = locked.max(rung - p(3)); }
                    if !is_call && value <= rung { locked = locked.max(p(3) - rung); }
                }
            }
            discount * locked.max(payoff(terminal, p(3), is_call))
        },
        9 => {
            let remaining = p(13) - p(41);
            let mut effective_vol = if p(1) as i32 == 0 { p(6) } else { term_vol(p(6), p(41)) };
            if p(1) as i32 == 2 || p(1) as i32 == 4 { effective_vol *= leverage(terminal, p(2)); }
            let inner = black_scholes(terminal, p(3), p(4), p(5), effective_vol, remaining, p(44) as i32 == 1);
            let outer = if p(43) as i32 == 1 { (inner - p(42)).max(0.0) } else { (p(42) - inner).max(0.0) };
            libm::exp(-p(4) * p(41)) * outer
        },
        10 => {
            let total: f64 = path.iter().sum::<f64>() + if p(54) as i32 == 1 { p(2) } else { 0.0 };
            let count = path.len() + if p(54) as i32 == 1 { 1 } else { 0 };
            discount * payoff(total / count as f64, p(3), is_call)
        },
        12..=15 => {
            let variance = p(50) * simulation.log_returns.iter().map(|v| v * v).sum::<f64>() / schedule[schedule.len() - 1];
            if product == 12 { return discount * p(49) * (variance - p(47)); }
            let volatility = libm::sqrt(variance.max(0.0));
            if product == 13 { return discount * p(49) * (volatility - p(48)); }
            let observed = if product == 14 { variance } else { volatility };
            let strike = if product == 14 { p(47) } else { p(48) };
            discount * p(49) * payoff(observed, strike, is_call)
        },
        16 => {
            let mut present = 0.0;
            for (index, &value) in path.iter().enumerate() {
                if value >= p(53) * p(2) { break; }
                let quantity = if value < p(3) { p(51) * p(52) } else { p(51) };
                present += libm::exp(-p(4) * schedule[index]) * quantity * (value - p(3));
            }
            present
        },
        _ => f64::NAN,
    }
}

fn solve3(matrix: [[f64; 3]; 3], vector: [f64; 3]) -> [f64; 3] {
    let mut a = [[0.0; 4]; 3];
    for row in 0..3 { for column in 0..3 { a[row][column] = matrix[row][column]; } a[row][3] = vector[row]; }
    for column in 0..3 {
        let mut pivot = column;
        for row in column + 1..3 { if a[row][column].abs() > a[pivot][column].abs() { pivot = row; } }
        a.swap(column, pivot);
        if a[column][column].abs() < 1e-12 { return [0.0; 3]; }
        let scale = a[column][column];
        for item in column..4 { a[column][item] /= scale; }
        for row in 0..3 {
            if row == column { continue; }
            let factor = a[row][column];
            for item in column..4 { a[row][item] -= factor * a[column][item]; }
        }
    }
    [a[0][3], a[1][3], a[2][3]]
}

fn bermudan(schedule: &[f64], path_count: usize, rng: &mut Pcg32) -> Vec<f64> {
    let paths: Vec<Vec<f64>> = (0..path_count).map(|_| simulate(schedule, rng).underlying).collect();
    let last = schedule.len() - 1;
    let mut cashflow: Vec<f64> = paths.iter().map(|path| payoff(path[last], p(3), p(14) as i32 == 1)).collect();
    let mut exercise_time = vec![schedule[last]; path_count];
    for date in (0..last).rev() {
        let mut rows: Vec<(usize, f64, f64, f64)> = Vec::new();
        for index in 0..path_count {
            let intrinsic = payoff(paths[index][date], p(3), p(14) as i32 == 1);
            if intrinsic > 0.0 {
                let x = paths[index][date] / p(3);
                let y = cashflow[index] * libm::exp(-p(4) * (exercise_time[index] - schedule[date]));
                rows.push((index, x, intrinsic, y));
            }
        }
        let mut sums = [0.0; 5];
        let mut targets = [0.0; 3];
        for &(_, x, _, y) in &rows {
            let powers = [1.0, x, x * x, libm::pow(x, 3.0), libm::pow(x, 4.0)];
            for i in 0..5 { sums[i] += powers[i]; }
            targets[0] += y; targets[1] += x * y; targets[2] += x * x * y;
        }
        let coefficients = solve3([[sums[0], sums[1], sums[2]], [sums[1], sums[2], sums[3]],
            [sums[2], sums[3], sums[4]]], targets);
        for &(index, x, intrinsic, _) in &rows {
            let continuation = coefficients[0] + coefficients[1] * x + coefficients[2] * x * x;
            if intrinsic > continuation { cashflow[index] = intrinsic; exercise_time[index] = schedule[date]; }
        }
    }
    for index in 0..path_count { cashflow[index] *= libm::exp(-p(4) * exercise_time[index]); }
    cashflow
}

#[no_mangle]
pub extern "C" fn qk_advanced_set_parameter(index: i32, value: f64) {
    if index >= 0 && (index as usize) < PARAMETER_COUNT { unsafe { PARAMETERS[index as usize] = value; } }
}
#[no_mangle]
pub extern "C" fn qk_advanced_last_std_error() -> f64 { unsafe { LAST_STANDARD_ERROR } }
#[no_mangle]
pub extern "C" fn qk_advanced_last_std_dev() -> f64 { unsafe { LAST_STANDARD_DEVIATION } }
#[no_mangle]
pub extern "C" fn qk_advanced_price(paths: i32, seed: i32) -> f64 {
    let path_count = (paths as usize).max(100);
    let schedule_count = (p(15) as usize).clamp(1, 260);
    let schedule: Vec<f64> = (0..schedule_count).map(|index| p(HEADER_SIZE + index)).collect();
    let mut rng = Pcg32::new(seed as u32 as u64);
    let samples = if p(0) as i32 == 3 { bermudan(&schedule, path_count, &mut rng) }
        else { (0..path_count).map(|_| path_value(&simulate(&schedule, &mut rng), &schedule)).collect() };
    let mean = samples.iter().sum::<f64>() / path_count as f64;
    let variance = samples.iter().map(|value| (value - mean) * (value - mean)).sum::<f64>() /
        (path_count - 1).max(1) as f64;
    unsafe {
        LAST_STANDARD_DEVIATION = libm::sqrt(variance.max(0.0));
        LAST_STANDARD_ERROR = LAST_STANDARD_DEVIATION / libm::sqrt(path_count as f64);
    }
    mean
}
