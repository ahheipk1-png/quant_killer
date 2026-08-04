#pragma once
// Minimal JSON value + recursive-descent parser/serializer, sufficient for
// QuantKiller's flat request/response protocol (contracts/schema/). Written
// by hand rather than vendoring a dependency, consistent with this
// project's dependency-free-core philosophy.

#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

namespace quantkiller::json {

class Value;
using Object = std::map<std::string, Value>;
using Array = std::vector<Value>;

enum class Kind { Null, Bool, Number, String, Object, Array };

class Value {
public:
    Value() : kind_(Kind::Null) {}
    Value(std::nullptr_t) : kind_(Kind::Null) {}
    Value(bool b) : kind_(Kind::Bool), bool_(b) {}
    Value(double n) : kind_(Kind::Number), num_(n) {}
    Value(int n) : kind_(Kind::Number), num_(static_cast<double>(n)) {}
    Value(const char* s) : kind_(Kind::String), str_(s) {}
    Value(std::string s) : kind_(Kind::String), str_(std::move(s)) {}
    Value(Object o) : kind_(Kind::Object), obj_(std::make_shared<Object>(std::move(o))) {}
    Value(Array a) : kind_(Kind::Array), arr_(std::make_shared<Array>(std::move(a))) {}

    Kind kind() const { return kind_; }
    bool is_object() const { return kind_ == Kind::Object; }
    bool is_string() const { return kind_ == Kind::String; }
    bool is_number() const { return kind_ == Kind::Number; }
    bool is_bool() const { return kind_ == Kind::Bool; }
    bool is_null() const { return kind_ == Kind::Null; }

    double as_number() const {
        if (kind_ != Kind::Number) throw std::runtime_error("expected number");
        return num_;
    }
    bool as_bool() const {
        if (kind_ != Kind::Bool) throw std::runtime_error("expected bool");
        return bool_;
    }
    const std::string& as_string() const {
        if (kind_ != Kind::String) throw std::runtime_error("expected string");
        return str_;
    }
    const Object& as_object() const {
        if (kind_ != Kind::Object) throw std::runtime_error("expected object");
        return *obj_;
    }
    Object& as_object() {
        if (kind_ != Kind::Object) throw std::runtime_error("expected object");
        return *obj_;
    }
    const Array& as_array() const {
        if (kind_ != Kind::Array) throw std::runtime_error("expected array");
        return *arr_;
    }

    bool has(const std::string& key) const {
        return kind_ == Kind::Object && obj_->count(key) > 0;
    }
    const Value* find(const std::string& key) const {
        if (kind_ != Kind::Object) return nullptr;
        auto it = obj_->find(key);
        return it == obj_->end() ? nullptr : &it->second;
    }

    static Value parse(const std::string& text) {
        size_t pos = 0;
        skip_ws(text, pos);
        Value v = parse_value(text, pos);
        skip_ws(text, pos);
        return v;
    }

    std::string dump() const {
        std::ostringstream out;
        write(out);
        return out.str();
    }

private:
    Kind kind_;
    bool bool_ = false;
    double num_ = 0.0;
    std::string str_;
    std::shared_ptr<Object> obj_;
    std::shared_ptr<Array> arr_;

    void write(std::ostringstream& out) const {
        switch (kind_) {
            case Kind::Null: out << "null"; break;
            case Kind::Bool: out << (bool_ ? "true" : "false"); break;
            case Kind::Number: {
                if (num_ != num_) { out << "NaN"; break; }  // matches Python's json convention
                out.precision(17);
                out << num_;
                break;
            }
            case Kind::String: {
                out << '"';
                for (char c : str_) {
                    if (c == '"' || c == '\\') out << '\\';
                    out << c;
                }
                out << '"';
                break;
            }
            case Kind::Object: {
                out << '{';
                bool first = true;
                for (const auto& [k, v] : *obj_) {
                    if (!first) out << ',';
                    first = false;
                    out << '"' << k << "\":";
                    v.write(out);
                }
                out << '}';
                break;
            }
            case Kind::Array: {
                out << '[';
                bool first = true;
                for (const auto& v : *arr_) {
                    if (!first) out << ',';
                    first = false;
                    v.write(out);
                }
                out << ']';
                break;
            }
        }
    }

    static void skip_ws(const std::string& s, size_t& pos) {
        while (pos < s.size() && (s[pos] == ' ' || s[pos] == '\t' || s[pos] == '\n' || s[pos] == '\r')) pos++;
    }

    static Value parse_value(const std::string& s, size_t& pos) {
        skip_ws(s, pos);
        if (pos >= s.size()) throw std::runtime_error("unexpected end of JSON");
        char c = s[pos];
        if (c == '{') return parse_object(s, pos);
        if (c == '[') return parse_array(s, pos);
        if (c == '"') return Value(parse_string(s, pos));
        if (c == 't') { pos += 4; return Value(true); }
        if (c == 'f') { pos += 5; return Value(false); }
        if (c == 'n') { pos += 4; return Value(nullptr); }
        return parse_number(s, pos);
    }

    static Value parse_object(const std::string& s, size_t& pos) {
        Object obj;
        pos++;  // '{'
        skip_ws(s, pos);
        if (pos < s.size() && s[pos] == '}') { pos++; return Value(std::move(obj)); }
        while (true) {
            skip_ws(s, pos);
            std::string key = parse_string(s, pos);
            skip_ws(s, pos);
            if (s[pos] != ':') throw std::runtime_error("expected ':'");
            pos++;
            Value val = parse_value(s, pos);
            obj.emplace(std::move(key), std::move(val));
            skip_ws(s, pos);
            if (pos < s.size() && s[pos] == ',') { pos++; continue; }
            if (pos < s.size() && s[pos] == '}') { pos++; break; }
            throw std::runtime_error("expected ',' or '}'");
        }
        return Value(std::move(obj));
    }

    static Value parse_array(const std::string& s, size_t& pos) {
        Array arr;
        pos++;  // '['
        skip_ws(s, pos);
        if (pos < s.size() && s[pos] == ']') { pos++; return Value(std::move(arr)); }
        while (true) {
            Value val = parse_value(s, pos);
            arr.push_back(std::move(val));
            skip_ws(s, pos);
            if (pos < s.size() && s[pos] == ',') { pos++; continue; }
            if (pos < s.size() && s[pos] == ']') { pos++; break; }
            throw std::runtime_error("expected ',' or ']'");
        }
        return Value(std::move(arr));
    }

    static std::string parse_string(const std::string& s, size_t& pos) {
        if (s[pos] != '"') throw std::runtime_error("expected string");
        pos++;
        std::string out;
        while (pos < s.size() && s[pos] != '"') {
            if (s[pos] == '\\' && pos + 1 < s.size()) {
                pos++;
                char c = s[pos];
                if (c == 'n') out += '\n';
                else if (c == 't') out += '\t';
                else out += c;
            } else {
                out += s[pos];
            }
            pos++;
        }
        pos++;  // closing quote
        return out;
    }

    static Value parse_number(const std::string& s, size_t& pos) {
        size_t start = pos;
        if (pos < s.size() && (s[pos] == '-' || s[pos] == '+')) pos++;
        while (pos < s.size() && (isdigit(static_cast<unsigned char>(s[pos])) || s[pos] == '.' ||
               s[pos] == 'e' || s[pos] == 'E' || s[pos] == '+' || s[pos] == '-')) {
            pos++;
        }
        return Value(std::stod(s.substr(start, pos - start)));
    }
};

}  // namespace quantkiller::json
