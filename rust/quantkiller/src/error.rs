use std::fmt;

/// Raised for invalid pricing inputs. The CLI maps this to {"ok": false, ...}.
#[derive(Debug, Clone)]
pub struct QkError(pub String);

impl fmt::Display for QkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for QkError {}

impl QkError {
    pub fn new(msg: impl Into<String>) -> Self {
        QkError(msg.into())
    }
}

pub type QkResult<T> = Result<T, QkError>;
