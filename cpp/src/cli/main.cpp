// QuantKiller CLI -- the universal cross-language bridge.
// See python/quantkiller/cli.py for the shared request/response protocol.

#include <fstream>
#include <iostream>
#include <map>
#include <optional>
#include <sstream>
#include <string>

#include "quantkiller/json_lite.hpp"
#include "quantkiller/models/american.hpp"
#include "quantkiller/models/binomial.hpp"
#include "quantkiller/models/black_scholes.hpp"
#include "quantkiller/models/forward_parity.hpp"
#include "quantkiller/models/implied_vol.hpp"
#include "quantkiller/models/monte_carlo.hpp"
#include "quantkiller/qkerror.hpp"

using quantkiller::QkError;
using namespace quantkiller::models;
namespace qjson = quantkiller::json;

namespace {

constexpr const char* kEngineName = "cpp/0.1.0";

double get_num(const qjson::Value& p, const std::string& key) {
    const auto* v = p.find(key);
    if (!v || !v->is_number()) throw QkError("missing/invalid parameter '" + key + "'");
    return v->as_number();
}
double get_num_default(const qjson::Value& p, const std::string& key, double def) {
    const auto* v = p.find(key);
    return (v && v->is_number()) ? v->as_number() : def;
}
std::optional<double> get_opt_num(const qjson::Value& p, const std::string& key) {
    const auto* v = p.find(key);
    if (v && v->is_number()) return v->as_number();
    return std::nullopt;
}
int get_int(const qjson::Value& p, const std::string& key) {
    return static_cast<int>(get_num(p, key));
}
int get_int_default(const qjson::Value& p, const std::string& key, int def) {
    return static_cast<int>(get_num_default(p, key, static_cast<double>(def)));
}
bool get_bool_default(const qjson::Value& p, const std::string& key, bool def) {
    const auto* v = p.find(key);
    return (v && v->is_bool()) ? v->as_bool() : def;
}
bool is_call(const qjson::Value& p) {
    const auto* v = p.find("option_type");
    if (!v || !v->is_string()) throw QkError("option_type must be 'call' or 'put'");
    if (v->as_string() == "call") return true;
    if (v->as_string() == "put") return false;
    throw QkError("option_type must be 'call' or 'put'");
}
bool is_american(const qjson::Value& p) {
    const auto* v = p.find("style");
    std::string s = (v && v->is_string()) ? v->as_string() : "european";
    if (s == "european") return false;
    if (s == "american") return true;
    throw QkError("style must be 'european' or 'american'");
}

qjson::Value to_json(const std::map<std::string, double>& results) {
    qjson::Object obj;
    for (const auto& [k, v] : results) obj.emplace(k, qjson::Value(v));
    return qjson::Value(std::move(obj));
}

std::map<std::string, double> dispatch(const std::string& model, const qjson::Value& p) {
    if (model == "black_scholes") {
        return black_scholes_price(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "vol"), get_num(p, "time"), is_call(p));
    }
    if (model == "binomial_crr") {
        return binomial_price(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "vol"), get_num(p, "time"),
            is_call(p), is_american(p), get_int(p, "steps"));
    }
    if (model == "monte_carlo_gbm") {
        return monte_carlo_price(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "vol"), get_num(p, "time"), is_call(p),
            get_int(p, "paths"), static_cast<std::uint64_t>(get_int_default(p, "seed", 42)),
            get_bool_default(p, "antithetic", true));
    }
    if (model == "implied_vol") {
        return implied_vol_solve(get_num(p, "price"), get_num(p, "spot"), get_num(p, "strike"),
            get_num(p, "rate"), get_num_default(p, "div_yield", 0.0), get_num(p, "time"), is_call(p));
    }
    if (model == "forward") {
        return forward_price(get_num(p, "spot"), get_num(p, "rate"), get_num_default(p, "div_yield", 0.0),
            get_num(p, "time"), get_opt_num(p, "strike"));
    }
    if (model == "put_call_parity") {
        return put_call_parity(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "time"),
            get_opt_num(p, "call_price"), get_opt_num(p, "put_price"));
    }
    if (model == "american_baw") {
        return baw_price(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "vol"), get_num(p, "time"), is_call(p));
    }
    if (model == "american_ju_zhong") {
        return ju_zhong_price(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "vol"), get_num(p, "time"), is_call(p));
    }
    if (model == "american_bjerksund_1993") {
        return bjerksund_1993_price(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "vol"), get_num(p, "time"), is_call(p));
    }
    if (model == "american_bjerksund_2002") {
        return bjerksund_2002_price(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "vol"), get_num(p, "time"), is_call(p));
    }
    if (model == "american_carr_randomization") {
        return carr_randomization_price(get_num(p, "spot"), get_num(p, "strike"), get_num(p, "rate"),
            get_num_default(p, "div_yield", 0.0), get_num(p, "vol"), get_num(p, "time"),
            get_int_default(p, "phases", 64), is_call(p));
    }
    throw QkError("unknown model '" + model + "'; run 'quantkiller models'");
}

int run_price(int argc, char** argv) {
    std::string json_arg;
    for (int i = 2; i < argc - 1; i++) {
        if (std::string(argv[i]) == "--json") json_arg = argv[i + 1];
    }
    if (json_arg.empty()) {
        std::cout << R"({"ok":false,"error":"usage: quantkiller price --json <file|->"})" << std::endl;
        return 2;
    }

    std::string raw;
    try {
        if (json_arg == "-") {
            std::ostringstream ss;
            ss << std::cin.rdbuf();
            raw = ss.str();
        } else {
            std::ifstream in(json_arg);
            if (!in) throw std::runtime_error("cannot open file");
            std::ostringstream ss;
            ss << in.rdbuf();
            raw = ss.str();
        }
    } catch (const std::exception& exc) {
        qjson::Object err = {{"ok", qjson::Value(false)}, {"error", qjson::Value(std::string("bad request input: ") + exc.what())}};
        std::cout << qjson::Value(err).dump() << std::endl;
        return 1;
    }

    qjson::Value request;
    try {
        request = qjson::Value::parse(raw);
    } catch (const std::exception& exc) {
        qjson::Object err = {{"ok", qjson::Value(false)}, {"error", qjson::Value(std::string("bad request input: ") + exc.what())}};
        std::cout << qjson::Value(err).dump() << std::endl;
        return 1;
    }

    const auto* model_v = request.find("model");
    const auto* params_v = request.find("params");
    if (!model_v || !model_v->is_string() || !params_v || !params_v->is_object()) {
        qjson::Object err = {{"ok", qjson::Value(false)},
            {"error", qjson::Value(std::string("request must have 'model' (string) and 'params' (object)"))}};
        std::cout << qjson::Value(err).dump() << std::endl;
        return 1;
    }

    try {
        auto results = dispatch(model_v->as_string(), *params_v);
        qjson::Object resp = {{"ok", qjson::Value(true)}, {"model", qjson::Value(model_v->as_string())},
            {"engine", qjson::Value(std::string(kEngineName))}, {"results", to_json(results)}};
        std::cout << qjson::Value(resp).dump() << std::endl;
        return 0;
    } catch (const QkError& exc) {
        qjson::Object err = {{"ok", qjson::Value(false)}, {"error", qjson::Value(std::string(exc.what()))}};
        std::cout << qjson::Value(err).dump() << std::endl;
        return 1;
    }
}

void print_usage() {
    std::cout << "quantkiller price --json <file|->   price a JSON request\n"
              << "quantkiller models                  list available models\n"
              << "quantkiller version                 print engine identifier\n";
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        print_usage();
        return 2;
    }
    const std::string command = argv[1];
    if (command == "version") {
        std::cout << kEngineName << std::endl;
        return 0;
    }
    if (command == "models") {
        for (const char* name : {"black_scholes", "binomial_crr", "monte_carlo_gbm", "implied_vol",
             "forward", "put_call_parity", "american_baw", "american_ju_zhong",
             "american_bjerksund_1993", "american_bjerksund_2002", "american_carr_randomization"}) {
            std::cout << name << "\n";
        }
        return 0;
    }
    if (command == "price") return run_price(argc, argv);
    print_usage();
    return 2;
}
