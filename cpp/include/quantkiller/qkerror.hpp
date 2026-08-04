#pragma once
#include <stdexcept>
#include <string>

namespace quantkiller {

// Raised for invalid pricing inputs. The CLI maps this to {"ok": false, ...}.
class QkError : public std::runtime_error {
public:
    explicit QkError(const std::string& msg) : std::runtime_error(msg) {}
};

}  // namespace quantkiller
