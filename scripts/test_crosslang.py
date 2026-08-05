#!/usr/bin/env python3
"""Cross-language CLI parity test.

Every language's own test suite checks its *library* against the golden
vectors (contracts/vectors/). That leaves one thing unproven: that the
actual CLI binaries -- with real process invocation and real JSON
encode/decode, not just the in-process function call -- agree with each
other. This script closes that gap: for every vector case, it runs the
*live CLI* of every language that's currently built, and checks every
pair of engines against each other within the vector's declared tolerance.

Usage:
    python scripts/test_crosslang.py

Skips any language whose CLI binary isn't found (build it first) rather
than failing -- this is meant to run locally with whatever's built, and
in CI after every language's build step.
"""

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VECTORS_DIR = ROOT / "contracts" / "vectors"


def find_first(*relative_paths):
    for rel in relative_paths:
        p = ROOT / rel
        if p.exists():
            return p
    return None


def run_python(request):
    proc = subprocess.run(
        [sys.executable, "-m", "quantkiller.cli", "price", "--json", "-"],
        input=json.dumps(request), capture_output=True, text=True, cwd=ROOT / "python",
    )
    return _parse(proc)


def run_exe(binary, request):
    proc = subprocess.run([str(binary), "price", "--json", "-"],
                           input=json.dumps(request), capture_output=True, text=True)
    return _parse(proc)


def run_dotnet(dll, request):
    proc = subprocess.run(["dotnet", str(dll), "price", "--json", "-"],
                           input=json.dumps(request), capture_output=True, text=True)
    return _parse(proc)


def _parse(proc):
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": f"non-JSON output (exit {proc.returncode}): {proc.stdout!r} {proc.stderr!r}"}


def discover_engines():
    engines = {"python": run_python}

    cpp_bin = find_first("cpp/build/Release/quantkiller.exe", "cpp/build/quantkiller",
                          "cpp/build/Debug/quantkiller.exe")
    if cpp_bin:
        engines["cpp"] = lambda req, b=cpp_bin: run_exe(b, req)

    rust_bin = find_first("rust/target/release/quantkiller-cli.exe", "rust/target/release/quantkiller-cli",
                           "rust/target/debug/quantkiller-cli.exe", "rust/target/debug/quantkiller-cli")
    if rust_bin:
        engines["rust"] = lambda req, b=rust_bin: run_exe(b, req)

    cs_dll = find_first("csharp/src/QuantKiller.Cli/bin/Release/net8.0/quantkiller.dll",
                         "csharp/src/QuantKiller.Cli/bin/Debug/net8.0/quantkiller.dll")
    if cs_dll:
        engines["csharp"] = lambda req, b=cs_dll: run_dotnet(b, req)

    return engines


def main():
    engines = discover_engines()
    print(f"engines available: {', '.join(sorted(engines))}")
    if len(engines) < 2:
        print("fewer than 2 engines built -- nothing to compare, skipping (not a failure)")
        return 0

    failures = 0
    checked_cases = 0

    for vector_file in sorted(VECTORS_DIR.glob("*.json")):
        doc = json.loads(vector_file.read_text(encoding="utf-8"))
        model = doc["model"]
        for case in doc["cases"]:
            request = {"model": model, "params": case["params"]}
            tol = case["tolerance"]
            responses = {}
            for name, run in engines.items():
                resp = run(request)
                if not resp.get("ok"):
                    print(f"FAIL {model}/{case['name']}: {name} engine errored: {resp.get('error')}")
                    failures += 1
                else:
                    responses[name] = resp["results"]
            checked_cases += 1

            names = sorted(responses)
            for i in range(len(names)):
                for j in range(i + 1, len(names)):
                    a_name, b_name = names[i], names[j]
                    a, b = responses[a_name], responses[b_name]
                    for field in a:
                        if field not in b:
                            continue
                        allowed = tol["abs"] + tol["rel"] * abs(a[field])
                        diff = abs(a[field] - b[field])
                        if diff > allowed:
                            print(f"FAIL {model}/{case['name']}.{field}: "
                                  f"{a_name}={a[field]!r} vs {b_name}={b[field]!r}, "
                                  f"diff {diff} > allowed {allowed}")
                            failures += 1

    print(f"checked {checked_cases} cases via {len(engines)} live CLI engines "
          f"({(len(engines) * (len(engines) - 1)) // 2} pairwise comparisons each)")
    if failures:
        print(f"{failures} FAILURES")
        return 1
    print("all engines agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
