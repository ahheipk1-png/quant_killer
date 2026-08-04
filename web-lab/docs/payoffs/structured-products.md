# Structured products

> Documentation status: synchronized with the current autocall, Phoenix, and yield-seeker tests on 2026-08-04.

## Autocallable

At each observation, the note may redeem early when performance reaches the autocall barrier. Redemption returns notional plus the configured coupon. If never called, maturity redemption is protected above the protection barrier and downside-linked below it.

Reduction: unreachable autocall, zero coupon, and full protection produce a discounted zero-coupon note.

## Phoenix autocall

Phoenix separates the coupon barrier from the autocall barrier.

- Coupon is earned when the coupon condition is met.
- With memory enabled, missed coupons accumulate and are paid when a later coupon condition succeeds.
- Principal plus the applicable coupon amount is returned when the autocall condition is met.
- If never called, maturity principal is protected or downside-linked according to the protection barrier.

Payment times are discounted individually.

The implementation is observation-date based. Coupon-barrier and autocall-barrier
equality follow the explicit comparison in the payoff code and should be
preserved in direct boundary tests.

## Yield seeker

The implemented yield seeker is the non-callable counterpart of the Phoenix-style high-coupon barrier note:

- conditional coupons,
- optional memory,
- no autocall,
- protected or downside-linked maturity redemption.

This product name is market-dependent. The implementation's explicit payoff definition, rather than the label, is authoritative.

None of these reference products currently models issuer credit, funding,
business-day payment adjustment, quanto effects, or a legal term-sheet event
calendar. Those are production contract extensions, not implicit features.
