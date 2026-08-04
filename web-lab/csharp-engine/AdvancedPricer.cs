using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;

namespace QuantKiller.Browser;

[SupportedOSPlatform("browser")]
public static partial class AdvancedPricer
{
    private const int HeaderSize = 64;
    private static readonly double[] Parameters = new double[324];
    private static double _lastStandardError;
    private static double _lastStandardDeviation;

    private sealed class Pcg32
    {
        private ulong _state;
        private readonly ulong _increment;

        public Pcg32(int seed, ulong sequence = 1)
        {
            _increment = (sequence << 1) | 1;
            NextUInt();
            _state = unchecked(_state + (uint)seed);
            NextUInt();
        }

        private uint NextUInt()
        {
            ulong old = _state;
            _state = unchecked(old * 6364136223846793005UL + _increment);
            uint xorshifted = (uint)(((old >> 18) ^ old) >> 27);
            int rotation = (int)(old >> 59);
            return (xorshifted >> rotation) | (xorshifted << ((32 - rotation) & 31));
        }

        public double Uniform() => (NextUInt() + 0.5) / 4294967296.0;
    }

    private sealed record Simulation(double[][] Paths, double[] Underlying, double[] LogReturns);

    [JSExport]
    public static void SetParameter(int index, double value)
    {
        if (index >= 0 && index < Parameters.Length) Parameters[index] = value;
    }

    [JSExport]
    public static double LastStandardError() => _lastStandardError;

    [JSExport]
    public static double LastStandardDeviation() => _lastStandardDeviation;

    private static double P(int index) => Parameters[index];

    private static double InverseNormal(double probability)
    {
        double[] a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
            138.3577518672690, -30.66479806614716, 2.506628277459239];
        double[] b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
            66.80131188771972, -13.28068155288572];
        double[] c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
            -2.549732539343734, 4.374664141464968, 2.938163982698783];
        double[] d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
        double p = Math.Min(Math.Max(probability, 1e-14), 1.0 - 1e-14);
        if (p < 0.02425)
        {
            double q = Math.Sqrt(-2.0 * Math.Log(p));
            return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
        }
        if (p <= 0.97575)
        {
            double q = p - 0.5;
            double r = q * q;
            return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
                (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
        }
        double tail = Math.Sqrt(-2.0 * Math.Log(1.0 - p));
        return -(((((c[0] * tail + c[1]) * tail + c[2]) * tail + c[3]) * tail + c[4]) * tail + c[5]) /
            ((((d[0] * tail + d[1]) * tail + d[2]) * tail + d[3]) * tail + 1.0);
    }

    private static double NormalCdf(double value)
    {
        double absolute = Math.Abs(value);
        double tail;
        if (absolute > 37.0) tail = 0.0;
        else
        {
            double exponential = Math.Exp(-0.5 * absolute * absolute);
            if (absolute < 7.07106781186547)
            {
                double numerator = 3.52624965998911e-2;
                numerator = numerator * absolute + 0.700383064443688;
                numerator = numerator * absolute + 6.37396220353165;
                numerator = numerator * absolute + 33.912866078383;
                numerator = numerator * absolute + 112.079291497871;
                numerator = numerator * absolute + 221.213596169931;
                numerator = numerator * absolute + 220.206867912376;
                double denominator = 8.83883476483184e-2;
                denominator = denominator * absolute + 1.75566716318264;
                denominator = denominator * absolute + 16.064177579207;
                denominator = denominator * absolute + 86.7807322029461;
                denominator = denominator * absolute + 296.564248779674;
                denominator = denominator * absolute + 637.333633378831;
                denominator = denominator * absolute + 793.826512519948;
                denominator = denominator * absolute + 440.413735824752;
                tail = exponential * numerator / denominator;
            }
            else
            {
                double fraction = absolute + 0.65;
                fraction = absolute + 4.0 / fraction;
                fraction = absolute + 3.0 / fraction;
                fraction = absolute + 2.0 / fraction;
                fraction = absolute + 1.0 / fraction;
                tail = exponential / (fraction * 2.506628274631);
            }
        }
        return value > 0.0 ? 1.0 - tail : tail;
    }

    private static double VanillaPayoff(double spot, double strike, bool isCall) =>
        isCall ? Math.Max(spot - strike, 0.0) : Math.Max(strike - spot, 0.0);

    private static double BlackScholes(double spot, double strike, double rate, double dividend,
        double volatility, double maturity, bool isCall)
    {
        if (maturity <= 0.0) return VanillaPayoff(spot, strike, isCall);
        if (volatility <= 1e-14)
        {
            double forward = spot * Math.Exp((rate - dividend) * maturity);
            return Math.Exp(-rate * maturity) * VanillaPayoff(forward, strike, isCall);
        }
        double root = Math.Sqrt(maturity);
        double d1 = (Math.Log(spot / strike) +
            (rate - dividend + 0.5 * volatility * volatility) * maturity) / (volatility * root);
        double d2 = d1 - volatility * root;
        double discountedSpot = spot * Math.Exp(-dividend * maturity);
        double discountedStrike = strike * Math.Exp(-rate * maturity);
        return isCall
            ? discountedSpot * NormalCdf(d1) - discountedStrike * NormalCdf(d2)
            : discountedStrike * NormalCdf(-d2) - discountedSpot * NormalCdf(-d1);
    }

    private static int AssetCount()
    {
        int product = (int)P(0);
        if (product == 4) return 2;
        if (product == 6) return Math.Clamp((int)P(35), 1, 3);
        return (int)P(55) != 0 ? Math.Clamp((int)P(56), 1, 3) : 1;
    }

    private static double[] Weights(int count)
    {
        double[] result = new double[count];
        double total = 0.0;
        for (int i = 0; i < count; i++) { result[i] = P(58 + i); total += result[i]; }
        if (Math.Abs(total) < 1e-14)
        {
            for (int i = 0; i < count; i++) result[i] = 1.0 / count;
        }
        else
        {
            for (int i = 0; i < count; i++) result[i] /= total;
        }
        return result;
    }

    private static double TermVol(double baseVol, double time)
    {
        double ending = baseVol * P(7) / P(6);
        double weight = Math.Clamp(time / P(13), 0.0, 1.0);
        return baseVol + (ending - baseVol) * weight;
    }

    private static double Leverage(double spot, double initial)
    {
        double ratio = Math.Max(spot / initial, 1e-8);
        return Math.Clamp(Math.Exp(P(8) * Math.Log(ratio)), 0.2, 5.0);
    }

    private static double[] Correlate(double[] values)
    {
        if (values.Length == 1) return values;
        double correlation = P(28);
        double[] result = new double[values.Length];
        result[0] = values[0];
        double l22 = Math.Sqrt(Math.Max(1.0 - correlation * correlation, 0.0));
        result[1] = correlation * values[0] + l22 * values[1];
        if (values.Length == 3)
        {
            double l32 = l22 > 1e-14 ? correlation * (1.0 - correlation) / l22 : 0.0;
            double l33 = Math.Sqrt(Math.Max(1.0 - correlation * correlation - l32 * l32, 0.0));
            result[2] = correlation * values[0] + l32 * values[1] + l33 * values[2];
        }
        return result;
    }

    private static double[] EffectiveUnderlying(double[][] paths, double[] initial)
    {
        int mode = (int)P(55);
        if (mode == 0 || paths.Length == 1) return paths[0];
        double[] weights = Weights(paths.Length);
        double initialWeighted = 0.0;
        for (int asset = 0; asset < paths.Length; asset++) initialWeighted += weights[asset] * initial[asset];
        double[] result = new double[paths[0].Length];
        for (int step = 0; step < result.Length; step++)
        {
            if (mode == 1)
            {
                for (int asset = 0; asset < paths.Length; asset++) result[step] += weights[asset] * paths[asset][step];
            }
            else if (mode == 2)
            {
                double[] performances = new double[paths.Length];
                for (int asset = 0; asset < paths.Length; asset++) performances[asset] = paths[asset][step] / initial[asset];
                Array.Sort(performances);
                Array.Reverse(performances);
                int rank = Math.Clamp((int)P(57), 1, performances.Length) - 1;
                result[step] = P(2) * performances[rank];
            }
            else if (mode == 3)
            {
                double performance = 0.0;
                for (int asset = 0; asset < paths.Length; asset++) performance += weights[asset] * paths[asset][step] / initial[asset];
                result[step] = P(2) * performance;
            }
            else
            {
                double weighted = 0.0;
                for (int asset = 0; asset < paths.Length; asset++) weighted += weights[asset] * paths[asset][step];
                result[step] = P(2) * weighted / initialWeighted;
            }
        }
        return result;
    }

    private static Simulation Simulate(double[] schedule, Pcg32 rng)
    {
        int assets = AssetCount();
        double[] initialAll = [P(2), P(22), P(25)];
        double[] volAll = [P(6), P(23), P(26)];
        double[] dividendAll = [P(5), P(24), P(27)];
        double[] initial = new double[assets];
        double[] baseVols = new double[assets];
        double[] dividends = new double[assets];
        Array.Copy(initialAll, initial, assets);
        Array.Copy(volAll, baseVols, assets);
        Array.Copy(dividendAll, dividends, assets);
        double[] spots = (double[])initial.Clone();
        double[] variances = new double[assets];
        double[][] paths = new double[assets][];
        for (int asset = 0; asset < assets; asset++)
        {
            variances[asset] = baseVols[asset] * baseVols[asset];
            paths[asset] = new double[schedule.Length];
        }
        double previousTime = 0.0;
        for (int step = 0; step < schedule.Length; step++)
        {
            double dt = schedule[step] - previousTime;
            double rootDt = Math.Sqrt(dt);
            double[] independentSpot = new double[assets];
            double[] independentVariance = new double[assets];
            for (int asset = 0; asset < assets; asset++) independentSpot[asset] = InverseNormal(rng.Uniform());
            for (int asset = 0; asset < assets; asset++) independentVariance[asset] = InverseNormal(rng.Uniform());
            double[] spotNormals = Correlate(independentSpot);
            for (int asset = 0; asset < assets; asset++)
            {
                double deterministic = TermVol(baseVols[asset], previousTime + 0.5 * dt);
                bool stochastic = (int)P(1) is 3 or 4;
                if (stochastic && P(11) <= 1e-14) variances[asset] = deterministic * deterministic;
                double variance = Math.Max(variances[asset], 0.0);
                double instantaneous;
                if ((int)P(1) == 0) instantaneous = baseVols[asset];
                else if ((int)P(1) == 1) instantaneous = deterministic;
                else if ((int)P(1) == 2) instantaneous = deterministic * Leverage(spots[asset], initial[asset]);
                else
                {
                    instantaneous = Math.Sqrt(variance);
                    if ((int)P(1) == 4) instantaneous *= Leverage(spots[asset], initial[asset]);
                }
                spots[asset] *= Math.Exp((P(4) - dividends[asset] - 0.5 * instantaneous * instantaneous) * dt +
                    instantaneous * rootDt * spotNormals[asset]);
                paths[asset][step] = spots[asset];
                if (stochastic && P(11) > 1e-14)
                {
                    double zVariance = P(12) * spotNormals[asset] +
                        Math.Sqrt(Math.Max(1.0 - P(12) * P(12), 0.0)) * independentVariance[asset];
                    double scale = baseVols[asset] / P(6);
                    double theta = Math.Pow(P(10) * scale, 2);
                    variances[asset] = Math.Max(variance + P(9) * (theta - variance) * dt +
                        P(11) * Math.Sqrt(variance) * rootDt * zVariance, 0.0);
                }
            }
            previousTime = schedule[step];
        }
        double[] underlying = EffectiveUnderlying(paths, initial);
        double initialUnderlying = P(2);
        if ((int)P(55) == 1)
        {
            double[] weights = Weights(assets);
            initialUnderlying = 0.0;
            for (int asset = 0; asset < assets; asset++) initialUnderlying += weights[asset] * initial[asset];
        }
        double[] logReturns = new double[schedule.Length];
        double previous = initialUnderlying;
        for (int step = 0; step < schedule.Length; step++)
        {
            logReturns[step] = Math.Log(underlying[step] / previous);
            previous = underlying[step];
        }
        return new Simulation(paths, underlying, logReturns);
    }

    private static double PhoenixValue(double[] path, double[] schedule, bool allowAutocall)
    {
        double present = 0.0;
        int missed = 0;
        for (int index = 0; index < path.Length; index++)
        {
            if (path[index] >= P(45) * P(2))
            {
                int count = (int)P(46) == 1 ? missed + 1 : 1;
                present += Math.Exp(-P(4) * schedule[index]) * P(30) * P(31) * count;
                missed = 0;
            }
            else if ((int)P(46) == 1) missed++;
            if (allowAutocall && path[index] >= P(32) * P(2))
                return present + Math.Exp(-P(4) * schedule[index]) * P(30);
        }
        double terminal = path[^1];
        double redemption = terminal >= P(33) * P(2) ? P(30) : P(30) * terminal / P(2);
        return present + Math.Exp(-P(4) * P(13)) * redemption;
    }

    private static double PathValue(Simulation simulation, double[] schedule)
    {
        int product = (int)P(0);
        double[] path = simulation.Underlying;
        double terminal = path[^1];
        double discount = Math.Exp(-P(4) * P(13));
        bool isCall = (int)P(14) == 1;
        if (product == 0)
        {
            bool succeeds = isCall ? terminal > P(3) : terminal < P(3);
            return discount * (succeeds ? P(16) : 0.0);
        }
        if (product is 1 or 2)
        {
            bool hit = false;
            foreach (double value in path)
            {
                if (product == 1 && ((int)P(18) == 1 ? value >= P(17) : value <= P(17))) hit = true;
                if (product == 2 && (value <= P(20) || value >= P(21))) hit = true;
            }
            bool active = (int)P(19) == 1 ? hit : !hit;
            return discount * VanillaPayoff(terminal, P(3), isCall) * (active ? 1.0 : 0.0);
        }
        if (product == 4)
        {
            double second = simulation.Paths[1][^1];
            double selected = (int)P(29) == 1 ? Math.Max(terminal, second) : Math.Min(terminal, second);
            return discount * VanillaPayoff(selected, P(3), isCall);
        }
        if (product == 5)
        {
            for (int index = 0; index < path.Length; index++)
            {
                if (path[index] >= P(32) * P(2))
                    return Math.Exp(-P(4) * schedule[index]) * P(30) * (1.0 + P(31) * (index + 1));
            }
            double redemption = terminal >= P(33) * P(2)
                ? P(30) * (1.0 + P(31) * path.Length) : P(30) * terminal / P(2);
            return discount * redemption;
        }
        if (product == 11) return PhoenixValue(path, schedule, true);
        if (product == 17) return PhoenixValue(path, schedule, false);
        if (product == 6)
        {
            int count = Math.Min((int)P(35), simulation.Paths.Length);
            HashSet<int> active = [];
            for (int asset = 0; asset < count; asset++) active.Add(asset);
            double[] initial = [P(2), P(22), P(25)];
            double total = 0.0;
            for (int step = 0; step < schedule.Length; step++)
            {
                int bestAsset = -1;
                double bestReturn = double.NegativeInfinity;
                foreach (int asset in active)
                {
                    double previous = step == 0 ? initial[asset] : simulation.Paths[asset][step - 1];
                    double intervalReturn = simulation.Paths[asset][step] / previous - 1.0;
                    if (intervalReturn > bestReturn) { bestReturn = intervalReturn; bestAsset = asset; }
                }
                total += bestReturn;
                active.Remove(bestAsset);
            }
            return discount * P(30) * Math.Max(total / schedule.Length - P(36), 0.0);
        }
        if (product == 7)
        {
            double extremum = path[0];
            foreach (double value in path) extremum = isCall ? Math.Max(extremum, value) : Math.Min(extremum, value);
            return discount * VanillaPayoff(extremum, P(3), isCall);
        }
        if (product == 8)
        {
            double locked = 0.0;
            for (int rungIndex = 0; rungIndex < (int)P(40); rungIndex++)
            {
                double rung = P(37 + rungIndex);
                foreach (double value in path)
                {
                    if (isCall && value >= rung) locked = Math.Max(locked, rung - P(3));
                    if (!isCall && value <= rung) locked = Math.Max(locked, P(3) - rung);
                }
            }
            return discount * Math.Max(locked, VanillaPayoff(terminal, P(3), isCall));
        }
        if (product == 9)
        {
            double remaining = P(13) - P(41);
            double effectiveVol = (int)P(1) == 0 ? P(6) : TermVol(P(6), P(41));
            if ((int)P(1) is 2 or 4) effectiveVol *= Leverage(terminal, P(2));
            double inner = BlackScholes(terminal, P(3), P(4), P(5), effectiveVol, remaining, (int)P(44) == 1);
            double payoff = (int)P(43) == 1 ? Math.Max(inner - P(42), 0.0) : Math.Max(P(42) - inner, 0.0);
            return Math.Exp(-P(4) * P(41)) * payoff;
        }
        if (product == 10)
        {
            double total = (int)P(54) == 1 ? P(2) : 0.0;
            foreach (double value in path) total += value;
            int count = path.Length + ((int)P(54) == 1 ? 1 : 0);
            return discount * VanillaPayoff(total / count, P(3), isCall);
        }
        if (product is 12 or 13 or 14 or 15)
        {
            double sumSquares = 0.0;
            foreach (double value in simulation.LogReturns) sumSquares += value * value;
            double variance = P(50) * sumSquares / schedule[^1];
            if (product == 12) return discount * P(49) * (variance - P(47));
            double volatility = Math.Sqrt(Math.Max(variance, 0.0));
            if (product == 13) return discount * P(49) * (volatility - P(48));
            double observed = product == 14 ? variance : volatility;
            double strike = product == 14 ? P(47) : P(48);
            return discount * P(49) * VanillaPayoff(observed, strike, isCall);
        }
        if (product == 16)
        {
            double present = 0.0;
            for (int index = 0; index < path.Length; index++)
            {
                if (path[index] >= P(53) * P(2)) break;
                double quantity = path[index] < P(3) ? P(51) * P(52) : P(51);
                present += Math.Exp(-P(4) * schedule[index]) * quantity * (path[index] - P(3));
            }
            return present;
        }
        throw new InvalidOperationException("Unsupported advanced product.");
    }

    private static double[] Solve3(double[,] matrix, double[] vector)
    {
        double[,] a = new double[3, 4];
        for (int row = 0; row < 3; row++)
        {
            for (int column = 0; column < 3; column++) a[row, column] = matrix[row, column];
            a[row, 3] = vector[row];
        }
        for (int column = 0; column < 3; column++)
        {
            int pivot = column;
            for (int row = column + 1; row < 3; row++)
                if (Math.Abs(a[row, column]) > Math.Abs(a[pivot, column])) pivot = row;
            for (int item = column; item < 4; item++) (a[column, item], a[pivot, item]) = (a[pivot, item], a[column, item]);
            if (Math.Abs(a[column, column]) < 1e-12) return [0.0, 0.0, 0.0];
            double scale = a[column, column];
            for (int item = column; item < 4; item++) a[column, item] /= scale;
            for (int row = 0; row < 3; row++)
            {
                if (row == column) continue;
                double factor = a[row, column];
                for (int item = column; item < 4; item++) a[row, item] -= factor * a[column, item];
            }
        }
        return [a[0, 3], a[1, 3], a[2, 3]];
    }

    private static double[] Bermudan(double[] schedule, int pathCount, Pcg32 rng)
    {
        double[][] paths = new double[pathCount][];
        for (int index = 0; index < pathCount; index++) paths[index] = Simulate(schedule, rng).Underlying;
        int last = schedule.Length - 1;
        double[] cashflow = new double[pathCount];
        double[] exerciseTime = new double[pathCount];
        for (int index = 0; index < pathCount; index++)
        {
            cashflow[index] = VanillaPayoff(paths[index][last], P(3), (int)P(14) == 1);
            exerciseTime[index] = schedule[last];
        }
        for (int dateIndex = last - 1; dateIndex >= 0; dateIndex--)
        {
            double time = schedule[dateIndex];
            List<(int Index, double X, double Intrinsic, double Y)> rows = [];
            for (int pathIndex = 0; pathIndex < pathCount; pathIndex++)
            {
                double intrinsic = VanillaPayoff(paths[pathIndex][dateIndex], P(3), (int)P(14) == 1);
                if (intrinsic > 0.0)
                {
                    double x = paths[pathIndex][dateIndex] / P(3);
                    double y = cashflow[pathIndex] * Math.Exp(-P(4) * (exerciseTime[pathIndex] - time));
                    rows.Add((pathIndex, x, intrinsic, y));
                }
            }
            double[] sums = new double[5];
            double[] targets = new double[3];
            foreach (var row in rows)
            {
                double[] powers = [1.0, row.X, row.X * row.X, Math.Pow(row.X, 3), Math.Pow(row.X, 4)];
                for (int index = 0; index < 5; index++) sums[index] += powers[index];
                targets[0] += row.Y; targets[1] += row.X * row.Y; targets[2] += row.X * row.X * row.Y;
            }
            double[] coefficients = Solve3(new double[,] {
                { sums[0], sums[1], sums[2] }, { sums[1], sums[2], sums[3] },
                { sums[2], sums[3], sums[4] } }, targets);
            foreach (var row in rows)
            {
                double continuation = coefficients[0] + coefficients[1] * row.X + coefficients[2] * row.X * row.X;
                if (row.Intrinsic > continuation)
                {
                    cashflow[row.Index] = row.Intrinsic;
                    exerciseTime[row.Index] = time;
                }
            }
        }
        double[] result = new double[pathCount];
        for (int index = 0; index < pathCount; index++) result[index] = cashflow[index] * Math.Exp(-P(4) * exerciseTime[index]);
        return result;
    }

    [JSExport]
    public static double Price(int paths, int seed)
    {
        int pathCount = Math.Max(paths, 100);
        int scheduleCount = Math.Clamp((int)P(15), 1, 260);
        double[] schedule = new double[scheduleCount];
        for (int index = 0; index < scheduleCount; index++) schedule[index] = P(HeaderSize + index);
        Pcg32 rng = new(seed);
        double[] samples;
        if ((int)P(0) == 3) samples = Bermudan(schedule, pathCount, rng);
        else
        {
            samples = new double[pathCount];
            for (int index = 0; index < pathCount; index++)
            {
                Simulation simulation = Simulate(schedule, rng);
                samples[index] = PathValue(simulation, schedule);
            }
        }
        double mean = 0.0;
        foreach (double value in samples) mean += value;
        mean /= pathCount;
        double variance = 0.0;
        foreach (double value in samples) variance += (value - mean) * (value - mean);
        variance /= Math.Max(pathCount - 1, 1);
        _lastStandardDeviation = Math.Sqrt(Math.Max(variance, 0.0));
        _lastStandardError = _lastStandardDeviation / Math.Sqrt(pathCount);
        return mean;
    }
}
