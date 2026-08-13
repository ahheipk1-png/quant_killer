# Curran conditioning — step-by-step derivation

> Documentation status: written 2026-08-13 against `advanced-pricer.js`
> `conditionalAsianPrice`, after the quadrature restructuring. Every symbol
> below names the corresponding code variable so the implementation can be
> checked line by line against the math.

This page derives both Curran variants the lab exposes. It is deliberately
explicit — the point is that a reader can verify each step rather than take
the formula on trust.

**A note on the "one-moment" / "two-moment" labels.** They do *not* refer to
matching moments of the average's distribution (that is what Levy and shifted
lognormal do). They refer to how many *conditional* moments are used to
evaluate the inner expectation on each quadrature slice. See step 6.

## 1. Setup

The payoff is on the discrete arithmetic average over fixings
`t_1 < t_2 < ... < t_n` (sorted — this is relied on in step 3):

$$A = \frac{1}{n}\sum_{i=1}^{n} S(t_i)$$

Under Black-Scholes with continuously compounded rate `r` and carry `q`
(dividend plus borrow),

$$S(t_i) = S_0 \exp\!\Big(\big(r - q - \tfrac{\sigma^2}{2}\big)t_i + \sigma W(t_i)\Big)$$

so the log-prices `X_i = ln S(t_i)` are jointly normal with

$$m_i = \mathbb{E}[X_i] = \ln S_0 + \big(r - q - \tfrac{\sigma^2}{2}\big) t_i,
\qquad \operatorname{Cov}(X_i, X_j) = \sigma^2 \min(t_i, t_j)$$

The `min` is the whole reason the covariance is tractable: two log-prices share
exactly the Brownian increments up to the earlier of their two fixing times.

| Symbol | Code |
|---|---|
| `m_i` | `mean = logSpot + drift * times[i]`, with `drift = r − q − σ²/2` |
| `σ²` | `sigma2` |

## 2. The conditioning variable

Curran conditions on the **geometric** average, whose log is a plain average of
the log-prices and is therefore exactly normal:

$$Y = \ln\Big(\textstyle\prod_i S(t_i)\Big)^{1/n} = \frac{1}{n}\sum_{i=1}^n X_i$$

Being a linear combination of jointly normal variables, `Y ~ N(μ_Y, σ_Y²)` with

$$\mu_Y = \frac{1}{n}\sum_i m_i, \qquad
\sigma_Y^2 = \operatorname{Var}(Y) = \frac{1}{n^2}\sum_i\sum_j \sigma^2\min(t_i,t_j)$$

The quantity that does the work is the covariance of each fixing with `Y`:

$$c_i \equiv \operatorname{Cov}(X_i, Y)
= \operatorname{Cov}\Big(X_i, \tfrac1n\sum_j X_j\Big)
= \frac{1}{n}\sum_j \sigma^2 \min(t_i, t_j)$$

and note `σ_Y² = Cov(Y,Y) = (1/n)Σ_i c_i`, so the variance falls out of the
same array — no separate double sum is needed.

| Symbol | Code |
|---|---|
| `c_i` | `covarianceY[i]` |
| `σ_Y²` | `varianceY` |
| `σ_Y` | `rootVarianceY` |

## 3. Evaluating `c_i` in O(n)

Because the fixings are sorted, the inner sum splits at `i`:

$$\sum_j \min(t_i, t_j) = \underbrace{\sum_{j \le i} t_j}_{\text{prefix}} + \underbrace{(n - 1 - i)\, t_i}_{\text{later fixings all give } t_i}$$

(indices 0-based, matching the code). So a single running prefix sum gives every
`c_i`, and accumulating `(1/n)·c_i` alongside gives `σ_Y²`:

```js
prefixTime += times[i];
covarianceY[i] = weight * sigma2 * (prefixTime + times[i] * (count - 1 - i));
varianceY += weight * covarianceY[i];
```

This is an exact rewrite of the original `O(n²)` double loop, not an
approximation.

## 4. The conditioning identity

By the tower property, conditioning on `Y` and then integrating over its
density is exact:

$$e^{-rT}\,\mathbb{E}\big[(A-K)^+\big]
= e^{-rT}\int_{-\infty}^{\infty} \mathbb{E}\big[(A-K)^+ \,\big|\, Y = y\big]\,\varphi_Y(y)\,dy$$

Substituting `y = μ_Y + σ_Y z` puts it on the standard normal:

$$= e^{-rT}\int_{-\infty}^{\infty} \mathbb{E}\big[(A-K)^+ \,\big|\, Y = \mu_Y + \sigma_Y z\big]\,\frac{e^{-z^2/2}}{\sqrt{2\pi}}\,dz$$

**Nothing has been approximated yet.** The lab evaluates this by Simpson's rule
on `z ∈ [−8, 8]` with 320 intervals. The only approximation introduced so far is
truncating the tails at ±8 standard deviations.

## 5. Conditional law of each fixing

`(X_i, Y)` is bivariate normal, so the standard conditioning formulas give

$$\mathbb{E}[X_i \mid Y = y] = m_i + \frac{c_i}{\sigma_Y^2}(y - \mu_Y),
\qquad
v_i \equiv \operatorname{Var}(X_i \mid Y) = \sigma^2 t_i - \frac{c_i^2}{\sigma_Y^2}$$

Note `v_i` does **not** depend on `y` — a fact step 7 exploits heavily.

Substituting `y − μ_Y = σ_Y z` collapses the mean to something affine in `z`:

$$\mathbb{E}[X_i \mid Y] = m_i + \beta_i z, \qquad \beta_i \equiv \frac{c_i}{\sigma_Y}$$

Given `Y`, `X_i` is still normal, so `S(t_i) = e^{X_i}` is conditionally
lognormal and

$$\boxed{\;\mathbb{E}[S(t_i) \mid Y] = \exp\!\Big(m_i + \tfrac{v_i}{2}\Big)\, e^{\beta_i z} \;\equiv\; A_i\, e^{\beta_i z}\;}$$

| Symbol | Code |
|---|---|
| `v_i` | `logVariance` (floored at 0 for numerical safety) |
| `β_i` | `beta = covarianceY[i] / rootVarianceY` |
| `A_i e^{β_i z}` | `level[i]` — the running value at the current node |

Therefore the **conditional first moment** of the average is

$$M_1(z) = \mathbb{E}[A \mid Y] = \frac{1}{n}\sum_i A_i e^{\beta_i z}$$

which is `firstMoment` in the code.

## 6. The two variants — where the approximation actually enters

The inner expectation `E[(A−K)⁺ | Y]` is still not exact: conditionally, `A` is
a *sum of lognormals*, which has no closed form. The two variants differ only
in how they handle this.

### One-moment — collapse the slice to its mean

Treat `A` as deterministic given `Y`, equal to its conditional mean:

$$\mathbb{E}\big[(A-K)^+ \,\big|\, Y\big] \;\approx\; \big(M_1(z) - K\big)^+$$

```js
conditionalPayoff = Base.vanillaPayoff(firstMoment, config.strike, config.optionType);
```

**Sign of the error is predictable.** `(·)⁺` is convex, so by Jensen's
inequality `E[(A−K)⁺|Y] ≥ (E[A|Y]−K)⁺`; discarding the conditional spread can
only *understate* the price. This is a useful self-check: measured errors for
this variant on Asians are negative at every volatility tested
(−0.02 % at `σ√T = 0.2` through −0.56 % at `σ√T = 1.5`), exactly as the
inequality requires. A positive error would indicate a bug.

The approximation is good precisely when conditioning removes most of the
uncertainty. For an Asian it removes roughly 72 % of each fixing's variance,
and the residuals largely cancel across the average — hence errors of a few
basis points. For a **low-correlation basket** the geometric mean explains far
less, the residual is large, and this variant degrades badly (−0.73 % at ρ = 0),
which is why the two-moment version exists.

### Two-moment — fit a lognormal to the slice

Keep the conditional spread by matching two conditional moments. The second
requires the conditional covariance,

$$\gamma_{ij} \equiv \operatorname{Cov}(X_i, X_j \mid Y)
= \sigma^2\min(t_i,t_j) - \frac{c_i c_j}{\sigma_Y^2}$$

For conditionally jointly lognormal variables,

$$\mathbb{E}[S(t_i)S(t_j)\mid Y] = \mathbb{E}[S(t_i)\mid Y]\;\mathbb{E}[S(t_j)\mid Y]\;e^{\gamma_{ij}}$$

so

$$M_2(z) = \mathbb{E}[A^2 \mid Y] = \frac{1}{n^2}\sum_i\sum_j A_i A_j e^{(\beta_i+\beta_j)z}\, e^{\gamma_{ij}}$$

Then fit a lognormal `L` with `E[L] = M₁`, `E[L²] = M₂` and price it in closed
form — log-variance `V = ln(M₂/M₁²)`, and

$$\mathbb{E}\big[(L-K)^+\big] = M_1 N(d_1) - K N(d_2), \quad
d_1 = \frac{\ln(M_1/K) + V/2}{\sqrt V}, \quad d_2 = d_1 - \sqrt V$$

```js
conditionalPayoff = lognormalOption(firstMoment, secondMoment, strike, optionType, 1.0);
```

The discount factor is passed as `1.0` because discounting is applied once to
the completed integral in step 8. Puts come from parity inside
`lognormalOption`: `P = C − (E[A] − K)` in present-value terms.

## 7. Why the implementation is fast

Three quantities above are constant in `z`, and were being rebuilt on all 321
quadrature nodes:

1. **`c_i` and `σ_Y²`** — never depended on `z` at all, and now cost `O(n)`
   via step 3 rather than `O(n²)`.
2. **`A_i e^{β_i z}`** — one `exp` per fixing per node. But the nodes are
   *uniformly spaced*, so
   `A_i e^{\beta_i z_{k+1}} = \big(A_i e^{\beta_i z_k}\big)\cdot e^{\beta_i \Delta z}`.
   Precompute `level[i] = A_i e^{β_i z_0}` and `ratio[i] = e^{β_i Δz}` once,
   then step by a single multiply per node.
3. **`e^{γ_ij}`** — `γ_ij` is independent of `z` (step 5: `v_i` and hence the
   conditional covariance never see `y`). The two-moment variant was rebuilding
   this entire `n × n` block of exponentials on every node; 320 of the 321
   rebuilds were pure waste. It is now built once, exploiting symmetry, leaving
   only the quadratic form `M₂(z) = (1/n²)·levelᵀ K level` inside the loop.

With `e^{γ_ij}` hoisted, note `M₂` reduces to a plain weighted quadratic form in
`level[]`, since the `e^{(β_i+β_j)z}` factors are already carried inside
`level[i]·level[j]`.

Measured at 252 daily fixings: one-moment 2.24 ms → 0.12 ms, two-moment
122.3 ms → 19.3 ms. Agreement with the pre-change implementation is 8.4e-11
worst-case relative over 108 configurations — the expected drift from
accumulating the step-2 recurrence across 321 nodes.

## 8. Assembling the price

$$\text{Price} \approx e^{-rT}\cdot\frac{\Delta z}{3}\sum_{k=0}^{320} w_k\;
\text{payoff}(z_k)\;\frac{e^{-z_k^2/2}}{\sqrt{2\pi}}$$

with Simpson weights `w_k = 1, 4, 2, 4, ..., 4, 1`.

## Summary of approximations

Ranked by how much they actually cost:

| Step | Approximation | Exact? |
|---|---|---|
| 2–3 | Conditional distribution algebra | Exact |
| 4 | Tower property | Exact |
| 4 | Truncating `z` to ±8σ | Negligible |
| 4 | Simpson quadrature, 320 intervals | Negligible |
| 5 | Conditional lognormality of each `S(t_i)` | Exact under Black-Scholes |
| **6** | **Inner expectation over a sum of lognormals** | **The only material approximation** |

Everything except step 6 is either exact or numerically negligible, so the
accuracy of both variants is governed entirely by how well the conditional law
of `A` is captured — a point mass (one-moment) or a fitted lognormal
(two-moment).

## Which variant to use — measured

The one-moment/two-moment choice should follow **how correlated the things being
averaged are**, not the product name. All figures below are percentage error
against a randomized-QMC reference (8 shifts x 16384 Sobol points).

### Asian (one asset through time — internally very correlated)

`σ√T` from 0.2 to 1.5, one-year monthly fixings:

| Variant | Error range | Cost @252 daily fixings |
|---|---|---|
| one-moment | −0.02 % to −0.56 % | 0.13 ms |
| two-moment | +0.03 % to +0.05 % | 19.3 ms |

One-moment is the right default: two-moment buys no accuracy for ~150x the cost.

### Basket (separate assets — correlation is a free parameter)

3 assets, call/put x K ∈ {80,100,120} x ρ ∈ {0, 0.35, 0.9}, worst case per method:

| Product | one-moment | two-moment | Ju |
|---|---|---|---|
| vanilla | **−7.8 %** | +1.6 % | −0.16 % |
| digital | **−5.5 %** | +0.7 % | — |

One-moment is **not safe for low-correlation baskets**. Its error is worst
exactly where the residual conditional variance is largest and the payoff is
most sensitive to it: low ρ and out-of-the-money. Representative vanilla cases:

| Case | one-moment | two-moment | Ju |
|---|---|---|---|
| put K=80, ρ=0 | −7.78 % | +1.58 % | −0.16 % |
| call K=120, ρ=0 | −2.94 % | −0.20 % | +0.05 % |
| put K=100, ρ=0 | −1.59 % | +0.07 % | +0.01 % |
| put K=80, ρ=0.35 | −1.74 % | +0.10 % | −0.05 % |
| any, ρ=0.9 | ≤0.16 % | ≤0.7 % | — |

At ρ = 0.9 one-moment is excellent (≤0.16 %) — consistent with the mechanism in
step 6: high correlation means the geometric mean explains nearly everything, so
there is almost no residual variance to discard.

### Cost, 3-asset basket (bare pricer, no MC benchmark attached)

| Levy | shifted | Curran 1m | Curran 2m | Ju |
|---|---|---|---|---|
| 0.015 ms | 0.021 ms | 0.086 ms | 0.212 ms | **0.024 ms** |

**Ju is the correct default for baskets** — most accurate of everything tested
*and* cheaper than either Curran variant. This is the exact opposite of the
Asian case, and the reason is structural rather than numerical: Ju's cost is
cubic in its component count, which is `assets × fixings`. A basket has one
fixing, so a 3-asset basket is 3 components (27 operations). A one-year daily
Asian is 252, and a 3-asset daily Asian is 756 — past the 320-component ceiling
Ju refuses to price beyond.

Summary:

- **Asian → Curran one-moment.** Ju is 25 ms and caps out on long schedules.
- **Basket → Ju.** Curran one-moment is dangerous below ρ ≈ 0.9; if Ju is
  unavailable, use two-moment, never one-moment.

## Not available for baskets

Curran (either variant) is deliberately rejected for two combinations:

- **Basket barrier** — Curran approximates only the terminal marginal and
  carries no running-maximum structure, so it cannot price a path-dependent
  barrier. Basket barriers use the effective-GBM route instead.
- **Basket Asian** — `asianMoments` is single-asset (it integrates the
  one-asset time-covariance `σ²min(s,t)`), so on a basket underlying Curran,
  Levy, shifted and ADI would silently return the asset-1 price, about 59 % too
  high for an uncorrelated three-asset average. They now throw and point at
  Ju/MC/QMC.

## References

The conditioning approach is due to Michael Curran:

- Curran, M. (1992), "Beyond average intelligence", *RISK* 5(10).
- Curran, M. (1994), "Valuing Asian and Portfolio Options by Conditioning on
  the Geometric Mean Price", *Management Science* 40(12).

The derivation above is written from the conditioning argument directly rather
than transcribed from either paper, so it should be checked on its own terms.
**Which variant belongs to which paper has not been verified against the
sources** — the one-moment/two-moment split is described here as implemented,
not as attributed. That attribution is an open documentation item.
