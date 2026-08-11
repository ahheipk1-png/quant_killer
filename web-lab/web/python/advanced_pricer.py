import math


HEADER_SIZE = 64
MASK_64 = (1 << 64) - 1


class Pcg32:
    def __init__(self, seed=42, sequence=1):
        self.state = 0
        self.increment = ((sequence << 1) | 1) & MASK_64
        self.next_u32()
        self.state = (self.state + (int(seed) & 0xFFFFFFFF)) & MASK_64
        self.next_u32()

    def next_u32(self):
        old = self.state
        self.state = (old * 6364136223846793005 + self.increment) & MASK_64
        xorshifted = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rotation = (old >> 59) & 31
        return ((xorshifted >> rotation) | (xorshifted << ((32 - rotation) & 31))) & 0xFFFFFFFF

    def uniform(self):
        return (self.next_u32() + 0.5) / 4294967296.0


def inverse_normal_cdf(probability):
    a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
         138.3577518672690, -30.66479806614716, 2.506628277459239]
    b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
         66.80131188771972, -13.28068155288572]
    c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
         -2.549732539343734, 4.374664141464968, 2.938163982698783]
    d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
    p = min(max(float(probability), 1e-14), 1.0 - 1e-14)
    if p < 0.02425:
        q = math.sqrt(-2.0 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    if p <= 0.97575:
        q = p - 0.5
        r = q * q
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)
    q = math.sqrt(-2.0 * math.log(1.0 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)


def normal_cdf(value):
    return 0.5 * math.erfc(-value / math.sqrt(2.0))


def vanilla_payoff(spot, strike, is_call):
    return max(spot - strike, 0.0) if is_call else max(strike - spot, 0.0)


def black_scholes(spot, strike, rate, dividend, volatility, maturity, is_call):
    if maturity <= 0.0:
        return vanilla_payoff(spot, strike, is_call)
    if volatility <= 1e-14:
        forward = spot * math.exp((rate - dividend) * maturity)
        return math.exp(-rate * maturity) * vanilla_payoff(forward, strike, is_call)
    root = math.sqrt(maturity)
    d1 = (math.log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * maturity) / \
        (volatility * root)
    d2 = d1 - volatility * root
    discounted_spot = spot * math.exp(-dividend * maturity)
    discounted_strike = strike * math.exp(-rate * maturity)
    if is_call:
        return discounted_spot * normal_cdf(d1) - discounted_strike * normal_cdf(d2)
    return discounted_strike * normal_cdf(-d2) - discounted_spot * normal_cdf(-d1)


def _weights(p, count):
    values = [float(p[58 + index]) for index in range(count)]
    total = sum(values)
    if abs(total) < 1e-14:
        return [1.0 / count] * count
    return [value / total for value in values]


def _asset_count(p, extra):
    product = int(p[0])
    # rainbow/himalayan, when the caller supplies the arbitrary-length extra
    # asset array (see _basket_arrays), are no longer capped at 3.
    if extra is not None and product in (4, 6):
        return max(2, int(extra[0]))
    if product == 4:
        return 2
    if product == 6:
        return max(1, min(int(p[35]), 3))
    if int(p[55]) != 0:
        return max(1, min(int(p[56]), 3))
    return 1


def _basket_arrays(p, extra, assets):
    # extra layout: [assetCount, spot_2, vol_2, div_2, spot_3, vol_3, div_3, ...]
    # -- asset 1 (index 0) always reuses the primary spot/volatility/dividend
    # fields (p[2]/p[6]/p[5]), matching the JS reference engine's basketSpots.
    if extra is not None and len(extra) >= 1 + 3 * (assets - 1):
        initial = [p[2]]
        base_vols = [p[6]]
        dividends = [p[5]]
        for index in range(assets - 1):
            initial.append(extra[1 + 3 * index])
            base_vols.append(extra[2 + 3 * index])
            dividends.append(extra[3 + 3 * index])
        return initial, base_vols, dividends
    return [p[2], p[22], p[25]][:assets], [p[6], p[23], p[26]][:assets], [p[5], p[24], p[27]][:assets]


def _term_vol(p, base_vol, time):
    ending = base_vol * p[7] / p[6]
    weight = min(max(time / p[13], 0.0), 1.0)
    return base_vol + (ending - base_vol) * weight


def _leverage(spot, initial, beta):
    ratio = max(spot / initial, 1e-8)
    return min(max(math.exp(beta * math.log(ratio)), 0.2), 5.0)


def _correlate(values, correlation):
    # General equicorrelated Cholesky (mirrors exotic-pricer.js's
    # equicorrelatedNormals) -- for count<=3 this reproduces the previous
    # hand-unrolled 1/2/3-asset formulas exactly, since both are the same
    # Cholesky factorization of a constant off-diagonal correlation matrix.
    count = len(values)
    if count == 1:
        return values
    lower = [[0.0] * count for _ in range(count)]
    for row in range(count):
        for column in range(row + 1):
            value = 1.0 if row == column else correlation
            for offset in range(column):
                value -= lower[row][offset] * lower[column][offset]
            if row == column:
                lower[row][column] = math.sqrt(max(value, 0.0))
            elif abs(lower[column][column]) > 1e-14:
                lower[row][column] = value / lower[column][column]
            else:
                # Semidefinite pivot guard (matches the JS engines): at
                # |rho| = 1 the pivot is exactly zero and dividing would
                # give 0/0 NaNs instead of the comonotone limit.
                lower[row][column] = 0.0
    correlated = [0.0] * count
    for row in range(count):
        for column in range(row + 1):
            correlated[row] += lower[row][column] * values[column]
    return correlated


def _effective_underlying(p, paths, initial):
    mode = int(p[55])
    if mode == 0 or len(paths) == 1:
        return paths[0]
    weights = _weights(p, len(paths))
    initial_weighted = sum(weights[index] * initial[index] for index in range(len(paths)))
    result = []
    for step in range(len(paths[0])):
        if mode == 1:
            value = sum(weights[index] * paths[index][step] for index in range(len(paths)))
        elif mode == 2:
            performances = sorted(
                (paths[index][step] / initial[index] for index in range(len(paths))), reverse=True)
            rank = max(1, min(int(p[57]), len(performances))) - 1
            value = p[2] * performances[rank]
        elif mode == 3:
            performance = sum(weights[index] * paths[index][step] / initial[index]
                              for index in range(len(paths)))
            value = p[2] * performance
        else:
            weighted = sum(weights[index] * paths[index][step] for index in range(len(paths)))
            value = p[2] * weighted / initial_weighted
        result.append(value)
    return result


def _simulate_path(p, schedule, rng, extra):
    assets = _asset_count(p, extra)
    initial, base_vols, dividends = _basket_arrays(p, extra, assets)
    spots = initial[:]
    variances = [value * value for value in base_vols]
    paths = [[] for _ in range(assets)]
    previous_time = 0.0
    for time in schedule:
        dt = time - previous_time
        root_dt = math.sqrt(dt)
        spot_normals = _correlate(
            [inverse_normal_cdf(rng.uniform()) for _ in range(assets)], p[28])
        variance_independent = [inverse_normal_cdf(rng.uniform()) for _ in range(assets)]
        for asset in range(assets):
            deterministic = _term_vol(p, base_vols[asset], previous_time + 0.5 * dt)
            stochastic = int(p[1]) in (3, 4)
            if stochastic and p[11] <= 1e-14:
                variances[asset] = deterministic * deterministic
            variance = max(variances[asset], 0.0)
            if int(p[1]) == 0:
                instant = base_vols[asset]
            elif int(p[1]) == 1:
                instant = deterministic
            elif int(p[1]) == 2:
                instant = deterministic * _leverage(spots[asset], initial[asset], p[8])
            else:
                instant = math.sqrt(variance)
                if int(p[1]) == 4:
                    instant *= _leverage(spots[asset], initial[asset], p[8])
            spots[asset] *= math.exp(
                (p[4] - dividends[asset] - 0.5 * instant * instant) * dt +
                instant * root_dt * spot_normals[asset])
            paths[asset].append(spots[asset])
            if stochastic and p[11] > 1e-14:
                z_var = p[12] * spot_normals[asset] + \
                    math.sqrt(max(1.0 - p[12] * p[12], 0.0)) * variance_independent[asset]
                scale = base_vols[asset] / p[6]
                theta = (p[10] * scale) ** 2
                variances[asset] = max(
                    variance + p[9] * (theta - variance) * dt +
                    p[11] * math.sqrt(variance) * root_dt * z_var, 0.0)
        previous_time = time
    underlying = _effective_underlying(p, paths, initial)
    initial_underlying = p[2]
    if int(p[55]) == 1:
        weights = _weights(p, assets)
        initial_underlying = sum(weights[index] * initial[index] for index in range(assets))
    log_returns = []
    previous = initial_underlying
    for value in underlying:
        log_returns.append(math.log(value / previous))
        previous = value
    return paths, underlying, log_returns


def _phoenix_pv(p, path, schedule, allow_autocall):
    present = 0.0
    missed = 0
    for index, value in enumerate(path):
        if value >= p[45] * p[2]:
            count = missed + 1 if int(p[46]) else 1
            present += math.exp(-p[4] * schedule[index]) * p[30] * p[31] * count
            missed = 0
        elif int(p[46]):
            missed += 1
        if allow_autocall and value >= p[32] * p[2]:
            return present + math.exp(-p[4] * schedule[index]) * p[30]
    terminal = path[-1]
    redemption = p[30] if terminal >= p[33] * p[2] else p[30] * terminal / p[2]
    return present + math.exp(-p[4] * p[13]) * redemption


def _path_value(p, paths, underlying, log_returns, schedule, extra, ladder_rungs):
    product = int(p[0])
    terminal = underlying[-1]
    discount = math.exp(-p[4] * p[13])
    is_call = int(p[14]) == 1
    if product == 0:
        success = terminal > p[3] if is_call else terminal < p[3]
        return discount * (p[16] if success else 0.0)
    if product in (1, 2):
        if product == 1:
            hit = any(value >= p[17] if int(p[18]) else value <= p[17] for value in underlying)
        else:
            hit = any(value <= p[20] or value >= p[21] for value in underlying)
        active = hit if int(p[19]) else not hit
        return discount * vanilla_payoff(terminal, p[3], is_call) * (1.0 if active else 0.0)
    if product == 4:
        terminals = [path[-1] for path in paths]
        selected = max(terminals) if int(p[29]) else min(terminals)
        return discount * vanilla_payoff(selected, p[3], is_call)
    if product == 5:
        for index, value in enumerate(underlying):
            if value >= p[32] * p[2]:
                amount = p[30] * (1.0 + p[31] * (index + 1))
                return math.exp(-p[4] * schedule[index]) * amount
        redemption = p[30] * (1.0 + p[31] * len(underlying)) \
            if terminal >= p[33] * p[2] else p[30] * terminal / p[2]
        return discount * redemption
    if product == 11:
        return _phoenix_pv(p, underlying, schedule, True)
    if product == 17:
        return _phoenix_pv(p, underlying, schedule, False)
    if product == 6:
        assets = len(paths)
        active = set(range(assets))
        selected_returns = []
        initial, _, _ = _basket_arrays(p, extra, assets)
        for step in range(len(schedule)):
            best_asset = -1
            best_return = -math.inf
            for asset in active:
                previous = initial[asset] if step == 0 else paths[asset][step - 1]
                interval_return = paths[asset][step] / previous - 1.0
                if interval_return > best_return:
                    best_return = interval_return
                    best_asset = asset
            selected_returns.append(best_return)
            active.remove(best_asset)
        average = sum(selected_returns) / len(selected_returns)
        return discount * p[30] * max(average - p[36], 0.0)
    if product == 7:
        extremum = max(underlying) if is_call else min(underlying)
        return discount * vanilla_payoff(extremum, p[3], is_call)
    if product == 8:
        locked = 0.0
        rungs = list(ladder_rungs) if ladder_rungs is not None else [p[37], p[38], p[39]][:int(p[40])]
        for value in underlying:
            for rung in rungs:
                if is_call and value >= rung:
                    locked = max(locked, rung - p[3])
                if not is_call and value <= rung:
                    locked = max(locked, p[3] - rung)
        return discount * max(locked, vanilla_payoff(terminal, p[3], is_call))
    if product == 9:
        remaining = p[13] - p[41]
        effective_vol = p[6] if int(p[1]) == 0 else _term_vol(p, p[6], p[41])
        if int(p[1]) in (2, 4):
            effective_vol *= _leverage(terminal, p[2], p[8])
        inner = black_scholes(terminal, p[3], p[4], p[5], effective_vol,
                              remaining, int(p[44]) == 1)
        payoff = max(inner - p[42], 0.0) if int(p[43]) else max(p[42] - inner, 0.0)
        return math.exp(-p[4] * p[41]) * payoff
    if product == 10:
        values = ([p[2]] + underlying) if int(p[54]) else underlying
        average = sum(values) / len(values)
        return discount * vanilla_payoff(average, p[3], is_call)
    if product in (12, 13, 14, 15):
        elapsed = schedule[-1]
        variance = p[50] * sum(value * value for value in log_returns) / elapsed
        if product == 12:
            return discount * p[49] * (variance - p[47])
        volatility = math.sqrt(max(variance, 0.0))
        if product == 13:
            return discount * p[49] * (volatility - p[48])
        observed = variance if product == 14 else volatility
        strike = p[47] if product == 14 else p[48]
        return discount * p[49] * vanilla_payoff(observed, strike, is_call)
    if product == 16:
        present = 0.0
        for index, value in enumerate(underlying):
            if value >= p[53] * p[2]:
                break
            quantity = p[51] * p[52] if value < p[3] else p[51]
            present += math.exp(-p[4] * schedule[index]) * quantity * (value - p[3])
        return present
    raise ValueError("Unsupported advanced product")


def _solve_three_by_three(matrix, vector):
    a = [list(row) + [vector[index]] for index, row in enumerate(matrix)]
    for column in range(3):
        pivot = max(range(column, 3), key=lambda row: abs(a[row][column]))
        a[column], a[pivot] = a[pivot], a[column]
        if abs(a[column][column]) < 1e-12:
            return [0.0, 0.0, 0.0]
        scale = a[column][column]
        for item in range(column, 4):
            a[column][item] /= scale
        for row in range(3):
            if row == column:
                continue
            factor = a[row][column]
            for item in range(column, 4):
                a[row][item] -= factor * a[column][item]
    return [row[3] for row in a]


def _bermudan_price(p, schedule, path_count, rng):
    paths = [_simulate_path(p, schedule, rng, None)[1] for _ in range(path_count)]
    last = len(schedule) - 1
    cashflow = [vanilla_payoff(path[last], p[3], int(p[14]) == 1) for path in paths]
    exercise_time = [schedule[last]] * path_count
    for date_index in range(last - 1, -1, -1):
        time = schedule[date_index]
        rows = []
        for path_index, path in enumerate(paths):
            intrinsic = vanilla_payoff(path[date_index], p[3], int(p[14]) == 1)
            if intrinsic > 0.0:
                x = path[date_index] / p[3]
                y = cashflow[path_index] * math.exp(-p[4] * (exercise_time[path_index] - time))
                rows.append((path_index, x, intrinsic, y))
        sums = [0.0] * 5
        targets = [0.0] * 3
        for _, x, _, y in rows:
            powers = [1.0, x, x * x, x ** 3, x ** 4]
            for index in range(5):
                sums[index] += powers[index]
            targets[0] += y
            targets[1] += x * y
            targets[2] += x * x * y
        coefficients = _solve_three_by_three(
            [[sums[0], sums[1], sums[2]], [sums[1], sums[2], sums[3]],
             [sums[2], sums[3], sums[4]]], targets)
        for path_index, x, intrinsic, _ in rows:
            continuation = coefficients[0] + coefficients[1] * x + coefficients[2] * x * x
            if intrinsic > continuation:
                cashflow[path_index] = intrinsic
                exercise_time[path_index] = time
    return [cashflow[index] * math.exp(-p[4] * exercise_time[index])
            for index in range(path_count)]


def price_advanced(parameters, paths, seed, extra_assets=None, ladder_rungs=None):
    p = [float(value) for value in parameters]
    extra = list(extra_assets) if extra_assets is not None else None
    rungs = list(ladder_rungs) if ladder_rungs is not None else None
    path_count = max(100, int(paths))
    count = max(1, min(int(p[15]), 260))
    schedule = [p[HEADER_SIZE + index] for index in range(count)]
    rng = Pcg32(int(seed))
    if int(p[0]) == 3:
        samples = _bermudan_price(p, schedule, path_count, rng)
    else:
        samples = []
        for _ in range(path_count):
            raw_paths, underlying, log_returns = _simulate_path(p, schedule, rng, extra)
            samples.append(_path_value(p, raw_paths, underlying, log_returns, schedule, extra, rungs))
    mean = sum(samples) / path_count
    variance = sum((value - mean) ** 2 for value in samples) / max(path_count - 1, 1)
    standard_deviation = math.sqrt(max(variance, 0.0))
    return mean, standard_deviation / math.sqrt(path_count), standard_deviation
