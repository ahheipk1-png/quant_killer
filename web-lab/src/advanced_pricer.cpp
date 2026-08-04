#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <numeric>
#include <unordered_set>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define QK_ADV_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define QK_ADV_EXPORT
#endif

namespace {
constexpr int kHeaderSize = 64;
std::array<double, 324> parameters{};
double last_standard_error = 0.0;
double last_standard_deviation = 0.0;

double p(int index) { return parameters[static_cast<std::size_t>(index)]; }

class Pcg32 {
public:
    explicit Pcg32(int seed, std::uint64_t sequence = 1)
        : state_(0), increment_((sequence << 1U) | 1U) {
        next_u32();
        state_ += static_cast<std::uint32_t>(seed);
        next_u32();
    }
    std::uint32_t next_u32() {
        const std::uint64_t old = state_;
        state_ = old * 6364136223846793005ULL + increment_;
        const auto xorshifted = static_cast<std::uint32_t>(((old >> 18U) ^ old) >> 27U);
        const auto rotation = static_cast<std::uint32_t>(old >> 59U);
        return (xorshifted >> rotation) | (xorshifted << ((32U - rotation) & 31U));
    }
    double uniform() { return (static_cast<double>(next_u32()) + 0.5) / 4294967296.0; }
private:
    std::uint64_t state_;
    std::uint64_t increment_;
};

double inverse_normal(double probability) {
    constexpr double a[] = {-39.69683028665376, 220.9460984245205, -275.9285104469687,
        138.3577518672690, -30.66479806614716, 2.506628277459239};
    constexpr double b[] = {-54.47609879822406, 161.5858368580409, -155.6989798598866,
        66.80131188771972, -13.28068155288572};
    constexpr double c[] = {-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
        -2.549732539343734, 4.374664141464968, 2.938163982698783};
    constexpr double d[] = {0.007784695709041462, 0.3224671290700398,
        2.445134137142996, 3.754408661907416};
    const double value = std::clamp(probability, 1e-14, 1.0 - 1e-14);
    if (value < 0.02425) {
        const double q = std::sqrt(-2.0 * std::log(value));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    }
    if (value <= 0.97575) {
        const double q = value - 0.5;
        const double r = q * q;
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
    }
    const double q = std::sqrt(-2.0 * std::log(1.0 - value));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
}

double normal_cdf(double value) { return 0.5 * std::erfc(-value / std::sqrt(2.0)); }
double payoff(double spot, double strike, bool is_call) {
    return is_call ? std::max(spot - strike, 0.0) : std::max(strike - spot, 0.0);
}
double black_scholes(double spot, double strike, double rate, double dividend,
                     double volatility, double maturity, bool is_call) {
    if (maturity <= 0.0) return payoff(spot, strike, is_call);
    if (volatility <= 1e-14) {
        const double forward = spot * std::exp((rate - dividend) * maturity);
        return std::exp(-rate * maturity) * payoff(forward, strike, is_call);
    }
    const double root = std::sqrt(maturity);
    const double d1 = (std::log(spot / strike) +
        (rate - dividend + 0.5 * volatility * volatility) * maturity) / (volatility * root);
    const double d2 = d1 - volatility * root;
    const double ds = spot * std::exp(-dividend * maturity);
    const double dk = strike * std::exp(-rate * maturity);
    return is_call ? ds * normal_cdf(d1) - dk * normal_cdf(d2)
                   : dk * normal_cdf(-d2) - ds * normal_cdf(-d1);
}

int asset_count() {
    const int product = static_cast<int>(p(0));
    if (product == 4) return 2;
    if (product == 6) return std::clamp(static_cast<int>(p(35)), 1, 3);
    return static_cast<int>(p(55)) != 0 ? std::clamp(static_cast<int>(p(56)), 1, 3) : 1;
}
std::vector<double> weights(int count) {
    std::vector<double> result(static_cast<std::size_t>(count));
    double total = 0.0;
    for (int i = 0; i < count; ++i) { result[i] = p(58 + i); total += result[i]; }
    if (std::abs(total) < 1e-14) std::fill(result.begin(), result.end(), 1.0 / count);
    else for (double& value : result) value /= total;
    return result;
}
double term_vol(double base_vol, double time) {
    const double ending = base_vol * p(7) / p(6);
    const double weight = std::clamp(time / p(13), 0.0, 1.0);
    return base_vol + (ending - base_vol) * weight;
}
double leverage(double spot, double initial) {
    const double ratio = std::max(spot / initial, 1e-8);
    return std::clamp(std::exp(p(8) * std::log(ratio)), 0.2, 5.0);
}
std::vector<double> correlate(const std::vector<double>& values) {
    if (values.size() == 1) return values;
    const double correlation = p(28);
    std::vector<double> result(values.size());
    result[0] = values[0];
    const double l22 = std::sqrt(std::max(1.0 - correlation * correlation, 0.0));
    result[1] = correlation * values[0] + l22 * values[1];
    if (values.size() == 3) {
        const double l32 = l22 > 1e-14 ? correlation * (1.0 - correlation) / l22 : 0.0;
        const double l33 = std::sqrt(std::max(1.0 - correlation * correlation - l32 * l32, 0.0));
        result[2] = correlation * values[0] + l32 * values[1] + l33 * values[2];
    }
    return result;
}

struct Simulation {
    std::vector<std::vector<double>> paths;
    std::vector<double> underlying;
    std::vector<double> log_returns;
};

std::vector<double> effective_underlying(const std::vector<std::vector<double>>& paths,
                                         const std::vector<double>& initial) {
    const int mode = static_cast<int>(p(55));
    if (mode == 0 || paths.size() == 1) return paths[0];
    const auto basket_weights = weights(static_cast<int>(paths.size()));
    double initial_weighted = 0.0;
    for (std::size_t i = 0; i < paths.size(); ++i) initial_weighted += basket_weights[i] * initial[i];
    std::vector<double> result(paths[0].size());
    for (std::size_t step = 0; step < result.size(); ++step) {
        if (mode == 1) {
            for (std::size_t asset = 0; asset < paths.size(); ++asset)
                result[step] += basket_weights[asset] * paths[asset][step];
        } else if (mode == 2) {
            std::vector<double> performance(paths.size());
            for (std::size_t asset = 0; asset < paths.size(); ++asset)
                performance[asset] = paths[asset][step] / initial[asset];
            std::sort(performance.begin(), performance.end(), std::greater<double>());
            const int rank = std::clamp(static_cast<int>(p(57)), 1, static_cast<int>(performance.size())) - 1;
            result[step] = p(2) * performance[static_cast<std::size_t>(rank)];
        } else if (mode == 3) {
            double performance = 0.0;
            for (std::size_t asset = 0; asset < paths.size(); ++asset)
                performance += basket_weights[asset] * paths[asset][step] / initial[asset];
            result[step] = p(2) * performance;
        } else {
            double weighted = 0.0;
            for (std::size_t asset = 0; asset < paths.size(); ++asset)
                weighted += basket_weights[asset] * paths[asset][step];
            result[step] = p(2) * weighted / initial_weighted;
        }
    }
    return result;
}

Simulation simulate(const std::vector<double>& schedule, Pcg32& rng) {
    const int assets = asset_count();
    const std::array<double, 3> initial_all{p(2), p(22), p(25)};
    const std::array<double, 3> vol_all{p(6), p(23), p(26)};
    const std::array<double, 3> dividend_all{p(5), p(24), p(27)};
    std::vector<double> initial(initial_all.begin(), initial_all.begin() + assets);
    std::vector<double> base_vols(vol_all.begin(), vol_all.begin() + assets);
    std::vector<double> dividends(dividend_all.begin(), dividend_all.begin() + assets);
    std::vector<double> spots = initial;
    std::vector<double> variances(assets);
    std::vector<std::vector<double>> paths(assets, std::vector<double>(schedule.size()));
    for (int asset = 0; asset < assets; ++asset) variances[asset] = base_vols[asset] * base_vols[asset];
    double previous_time = 0.0;
    for (std::size_t step = 0; step < schedule.size(); ++step) {
        const double dt = schedule[step] - previous_time;
        const double root_dt = std::sqrt(dt);
        std::vector<double> independent_spot(assets), independent_variance(assets);
        for (double& value : independent_spot) value = inverse_normal(rng.uniform());
        for (double& value : independent_variance) value = inverse_normal(rng.uniform());
        const auto spot_normals = correlate(independent_spot);
        for (int asset = 0; asset < assets; ++asset) {
            const double deterministic = term_vol(base_vols[asset], previous_time + 0.5 * dt);
            const bool stochastic = static_cast<int>(p(1)) == 3 || static_cast<int>(p(1)) == 4;
            if (stochastic && p(11) <= 1e-14) variances[asset] = deterministic * deterministic;
            const double variance = std::max(variances[asset], 0.0);
            double instantaneous;
            if (static_cast<int>(p(1)) == 0) instantaneous = base_vols[asset];
            else if (static_cast<int>(p(1)) == 1) instantaneous = deterministic;
            else if (static_cast<int>(p(1)) == 2)
                instantaneous = deterministic * leverage(spots[asset], initial[asset]);
            else {
                instantaneous = std::sqrt(variance);
                if (static_cast<int>(p(1)) == 4) instantaneous *= leverage(spots[asset], initial[asset]);
            }
            spots[asset] *= std::exp((p(4) - dividends[asset] - 0.5 * instantaneous * instantaneous) * dt +
                instantaneous * root_dt * spot_normals[asset]);
            paths[asset][step] = spots[asset];
            if (stochastic && p(11) > 1e-14) {
                const double z_variance = p(12) * spot_normals[asset] +
                    std::sqrt(std::max(1.0 - p(12) * p(12), 0.0)) * independent_variance[asset];
                const double scale = base_vols[asset] / p(6);
                const double theta = std::pow(p(10) * scale, 2);
                variances[asset] = std::max(variance + p(9) * (theta - variance) * dt +
                    p(11) * std::sqrt(variance) * root_dt * z_variance, 0.0);
            }
        }
        previous_time = schedule[step];
    }
    auto underlying = effective_underlying(paths, initial);
    double previous = p(2);
    if (static_cast<int>(p(55)) == 1) {
        const auto basket_weights = weights(assets);
        previous = 0.0;
        for (int asset = 0; asset < assets; ++asset) previous += basket_weights[asset] * initial[asset];
    }
    std::vector<double> log_returns(schedule.size());
    for (std::size_t step = 0; step < schedule.size(); ++step) {
        log_returns[step] = std::log(underlying[step] / previous);
        previous = underlying[step];
    }
    return {std::move(paths), std::move(underlying), std::move(log_returns)};
}

double phoenix_value(const std::vector<double>& path, const std::vector<double>& schedule,
                     bool allow_autocall) {
    double present = 0.0;
    int missed = 0;
    for (std::size_t index = 0; index < path.size(); ++index) {
        if (path[index] >= p(45) * p(2)) {
            const int count = static_cast<int>(p(46)) == 1 ? missed + 1 : 1;
            present += std::exp(-p(4) * schedule[index]) * p(30) * p(31) * count;
            missed = 0;
        } else if (static_cast<int>(p(46)) == 1) ++missed;
        if (allow_autocall && path[index] >= p(32) * p(2))
            return present + std::exp(-p(4) * schedule[index]) * p(30);
    }
    const double terminal = path.back();
    const double redemption = terminal >= p(33) * p(2) ? p(30) : p(30) * terminal / p(2);
    return present + std::exp(-p(4) * p(13)) * redemption;
}

double path_value(const Simulation& simulation, const std::vector<double>& schedule) {
    const int product = static_cast<int>(p(0));
    const auto& path = simulation.underlying;
    const double terminal = path.back();
    const double discount = std::exp(-p(4) * p(13));
    const bool is_call = static_cast<int>(p(14)) == 1;
    if (product == 0) {
        const bool succeeds = is_call ? terminal > p(3) : terminal < p(3);
        return discount * (succeeds ? p(16) : 0.0);
    }
    if (product == 1 || product == 2) {
        bool hit = false;
        for (double value : path) {
            if (product == 1 && (static_cast<int>(p(18)) == 1 ? value >= p(17) : value <= p(17))) hit = true;
            if (product == 2 && (value <= p(20) || value >= p(21))) hit = true;
        }
        const bool active = static_cast<int>(p(19)) == 1 ? hit : !hit;
        return discount * payoff(terminal, p(3), is_call) * (active ? 1.0 : 0.0);
    }
    if (product == 4) {
        const double second = simulation.paths[1].back();
        const double selected = static_cast<int>(p(29)) == 1 ? std::max(terminal, second) : std::min(terminal, second);
        return discount * payoff(selected, p(3), is_call);
    }
    if (product == 5) {
        for (std::size_t index = 0; index < path.size(); ++index) {
            if (path[index] >= p(32) * p(2))
                return std::exp(-p(4) * schedule[index]) * p(30) * (1.0 + p(31) * (index + 1));
        }
        const double redemption = terminal >= p(33) * p(2)
            ? p(30) * (1.0 + p(31) * path.size()) : p(30) * terminal / p(2);
        return discount * redemption;
    }
    if (product == 11) return phoenix_value(path, schedule, true);
    if (product == 17) return phoenix_value(path, schedule, false);
    if (product == 6) {
        const int count = std::min(static_cast<int>(p(35)), static_cast<int>(simulation.paths.size()));
        std::unordered_set<int> active;
        for (int asset = 0; asset < count; ++asset) active.insert(asset);
        const std::array<double, 3> initial{p(2), p(22), p(25)};
        double total = 0.0;
        for (std::size_t step = 0; step < schedule.size(); ++step) {
            int best_asset = -1;
            double best_return = -std::numeric_limits<double>::infinity();
            for (int asset : active) {
                const double previous = step == 0 ? initial[asset] : simulation.paths[asset][step - 1];
                const double interval_return = simulation.paths[asset][step] / previous - 1.0;
                if (interval_return > best_return) { best_return = interval_return; best_asset = asset; }
            }
            total += best_return;
            active.erase(best_asset);
        }
        return discount * p(30) * std::max(total / schedule.size() - p(36), 0.0);
    }
    if (product == 7) {
        const double extremum = is_call ? *std::max_element(path.begin(), path.end())
                                        : *std::min_element(path.begin(), path.end());
        return discount * payoff(extremum, p(3), is_call);
    }
    if (product == 8) {
        double locked = 0.0;
        for (int rung_index = 0; rung_index < static_cast<int>(p(40)); ++rung_index) {
            const double rung = p(37 + rung_index);
            for (double value : path) {
                if (is_call && value >= rung) locked = std::max(locked, rung - p(3));
                if (!is_call && value <= rung) locked = std::max(locked, p(3) - rung);
            }
        }
        return discount * std::max(locked, payoff(terminal, p(3), is_call));
    }
    if (product == 9) {
        const double remaining = p(13) - p(41);
        double effective_vol = static_cast<int>(p(1)) == 0 ? p(6) : term_vol(p(6), p(41));
        if (static_cast<int>(p(1)) == 2 || static_cast<int>(p(1)) == 4)
            effective_vol *= leverage(terminal, p(2));
        const double inner = black_scholes(terminal, p(3), p(4), p(5), effective_vol,
            remaining, static_cast<int>(p(44)) == 1);
        const double outer = static_cast<int>(p(43)) == 1 ? std::max(inner - p(42), 0.0)
                                                          : std::max(p(42) - inner, 0.0);
        return std::exp(-p(4) * p(41)) * outer;
    }
    if (product == 10) {
        double total = static_cast<int>(p(54)) == 1 ? p(2) : 0.0;
        total += std::accumulate(path.begin(), path.end(), 0.0);
        const int count = static_cast<int>(path.size()) + (static_cast<int>(p(54)) == 1 ? 1 : 0);
        return discount * payoff(total / count, p(3), is_call);
    }
    if (product >= 12 && product <= 15) {
        double sum_squares = 0.0;
        for (double value : simulation.log_returns) sum_squares += value * value;
        const double variance = p(50) * sum_squares / schedule.back();
        if (product == 12) return discount * p(49) * (variance - p(47));
        const double volatility = std::sqrt(std::max(variance, 0.0));
        if (product == 13) return discount * p(49) * (volatility - p(48));
        const double observed = product == 14 ? variance : volatility;
        const double strike = product == 14 ? p(47) : p(48);
        return discount * p(49) * payoff(observed, strike, is_call);
    }
    if (product == 16) {
        double present = 0.0;
        for (std::size_t index = 0; index < path.size(); ++index) {
            if (path[index] >= p(53) * p(2)) break;
            const double quantity = path[index] < p(3) ? p(51) * p(52) : p(51);
            present += std::exp(-p(4) * schedule[index]) * quantity * (path[index] - p(3));
        }
        return present;
    }
    return std::numeric_limits<double>::quiet_NaN();
}

std::array<double, 3> solve3(std::array<std::array<double, 3>, 3> matrix,
                             std::array<double, 3> vector) {
    std::array<std::array<double, 4>, 3> a{};
    for (int row = 0; row < 3; ++row) {
        for (int column = 0; column < 3; ++column) a[row][column] = matrix[row][column];
        a[row][3] = vector[row];
    }
    for (int column = 0; column < 3; ++column) {
        int pivot = column;
        for (int row = column + 1; row < 3; ++row)
            if (std::abs(a[row][column]) > std::abs(a[pivot][column])) pivot = row;
        std::swap(a[column], a[pivot]);
        if (std::abs(a[column][column]) < 1e-12) return {0.0, 0.0, 0.0};
        const double scale = a[column][column];
        for (int item = column; item < 4; ++item) a[column][item] /= scale;
        for (int row = 0; row < 3; ++row) {
            if (row == column) continue;
            const double factor = a[row][column];
            for (int item = column; item < 4; ++item) a[row][item] -= factor * a[column][item];
        }
    }
    return {a[0][3], a[1][3], a[2][3]};
}

std::vector<double> bermudan(const std::vector<double>& schedule, int path_count, Pcg32& rng) {
    std::vector<std::vector<double>> paths(path_count);
    for (auto& path : paths) path = simulate(schedule, rng).underlying;
    const int last = static_cast<int>(schedule.size()) - 1;
    std::vector<double> cashflow(path_count), exercise_time(path_count, schedule.back());
    for (int i = 0; i < path_count; ++i)
        cashflow[i] = payoff(paths[i][last], p(3), static_cast<int>(p(14)) == 1);
    struct Row { int index; double x; double intrinsic; double y; };
    for (int date = last - 1; date >= 0; --date) {
        std::vector<Row> rows;
        for (int index = 0; index < path_count; ++index) {
            const double intrinsic = payoff(paths[index][date], p(3), static_cast<int>(p(14)) == 1);
            if (intrinsic > 0.0) rows.push_back({index, paths[index][date] / p(3), intrinsic,
                cashflow[index] * std::exp(-p(4) * (exercise_time[index] - schedule[date]))});
        }
        std::array<double, 5> sums{};
        std::array<double, 3> targets{};
        for (const auto& row : rows) {
            const std::array<double, 5> powers{1.0, row.x, row.x * row.x,
                std::pow(row.x, 3), std::pow(row.x, 4)};
            for (int i = 0; i < 5; ++i) sums[i] += powers[i];
            targets[0] += row.y; targets[1] += row.x * row.y; targets[2] += row.x * row.x * row.y;
        }
        const auto coefficients = solve3({{{sums[0], sums[1], sums[2]},
            {sums[1], sums[2], sums[3]}, {sums[2], sums[3], sums[4]}}}, targets);
        for (const auto& row : rows) {
            const double continuation = coefficients[0] + coefficients[1] * row.x + coefficients[2] * row.x * row.x;
            if (row.intrinsic > continuation) { cashflow[row.index] = row.intrinsic; exercise_time[row.index] = schedule[date]; }
        }
    }
    for (int i = 0; i < path_count; ++i) cashflow[i] *= std::exp(-p(4) * exercise_time[i]);
    return cashflow;
}
}  // namespace

extern "C" {
QK_ADV_EXPORT void qk_advanced_set_parameter(int index, double value) {
    if (index >= 0 && index < static_cast<int>(parameters.size())) parameters[index] = value;
}
QK_ADV_EXPORT double qk_advanced_last_std_error() { return last_standard_error; }
QK_ADV_EXPORT double qk_advanced_last_std_dev() { return last_standard_deviation; }
QK_ADV_EXPORT double qk_advanced_price(int paths, int seed) {
    const int path_count = std::max(paths, 100);
    const int schedule_count = std::clamp(static_cast<int>(p(15)), 1, 260);
    std::vector<double> schedule(schedule_count);
    for (int i = 0; i < schedule_count; ++i) schedule[i] = p(kHeaderSize + i);
    Pcg32 rng(seed);
    std::vector<double> samples;
    if (static_cast<int>(p(0)) == 3) samples = bermudan(schedule, path_count, rng);
    else {
        samples.resize(path_count);
        for (double& sample : samples) sample = path_value(simulate(schedule, rng), schedule);
    }
    const double mean = std::accumulate(samples.begin(), samples.end(), 0.0) / path_count;
    double variance = 0.0;
    for (double value : samples) variance += (value - mean) * (value - mean);
    variance /= std::max(path_count - 1, 1);
    last_standard_deviation = std::sqrt(std::max(variance, 0.0));
    last_standard_error = last_standard_deviation / std::sqrt(static_cast<double>(path_count));
    return mean;
}
}
