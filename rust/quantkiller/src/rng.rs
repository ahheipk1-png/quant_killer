//! PCG32 (PCG-XSH-RR 64/32) per contracts/rng-spec.md (FROZEN).

use crate::qkmath::norminv;

const MULT: u64 = 6364136223846793005;

pub struct Pcg32 {
    state: u64,
    inc: u64,
}

impl Pcg32 {
    pub fn new(seed: u64) -> Self {
        Self::with_seq(seed, 1)
    }

    pub fn with_seq(seed: u64, seq: u64) -> Self {
        let mut rng = Pcg32 { state: 0, inc: (seq << 1) | 1 };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(MULT).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        (xorshifted >> rot) | (xorshifted << ((32u32.wrapping_sub(rot)) & 31))
    }

    /// Uniform double in the open interval (0, 1) -- spec section 2.
    pub fn next_uniform(&mut self) -> f64 {
        (self.next_u32() as f64 + 0.5) * 2f64.powi(-32)
    }

    /// Standard normal draw via inverse CDF -- spec section 3.
    pub fn next_normal(&mut self) -> f64 {
        norminv(self.next_uniform())
    }
}
