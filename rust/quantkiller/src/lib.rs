//! QuantKiller -- free, open, verified derivatives pricing.
//!
//! Rust reference-parity engine. Every model here must match
//! python/quantkiller/models/ against the shared golden vectors in
//! contracts/vectors/.

pub mod error;
pub mod models;
pub mod qkmath;
pub mod rng;

pub const ENGINE_NAME: &str = "rust/0.1.0";
