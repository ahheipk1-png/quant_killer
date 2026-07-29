# QuantKiller — run every language's test suite against the shared golden vectors.
# Skips languages whose toolchain or project isn't present yet.
# Run:  powershell -File scripts/test-all.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$results = @()

function Run-Suite($name, $dir, $probe, $script) {
    if (-not (Test-Path (Join-Path $root $dir))) {
        $script:results += @{ name = $name; status = "absent" }; return
    }
    $has = $false
    try { if (Get-Command $probe -ErrorAction Stop) { $has = $true } } catch {}
    if (-not $has) {
        Write-Host "[skip] $name — '$probe' not on PATH" -ForegroundColor Yellow
        $script:results += @{ name = $name; status = "no-toolchain" }; return
    }
    Write-Host ""
    Write-Host "=== $name ===" -ForegroundColor Cyan
    Push-Location (Join-Path $root $dir)
    try {
        & $script
        if ($LASTEXITCODE -ne 0) { throw "$name tests failed (exit $LASTEXITCODE)" }
        $script:results += @{ name = $name; status = "pass" }
    } catch {
        $script:results += @{ name = $name; status = "FAIL" }
        Pop-Location
        throw
    }
    Pop-Location
}

Run-Suite "python" "python/pyproject.toml" "python" { python -m pytest -q }
Run-Suite "cpp"    "cpp/CMakeLists.txt"    "cmake"  {
    cmake -B build -DCMAKE_BUILD_TYPE=Release | Out-Host
    cmake --build build --config Release | Out-Host
    ctest --test-dir build -C Release --output-on-failure
}
Run-Suite "rust"   "rust/Cargo.toml"       "cargo"  { cargo test --quiet }
Run-Suite "csharp" "csharp/QuantKiller.sln" "dotnet" { dotnet test --nologo -v q }
Run-Suite "java"   "java/pom.xml"          "mvn"    { mvn -q -B test }

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
foreach ($r in $results) {
    $color = switch ($r.status) { "pass" { "Green" } "FAIL" { "Red" } default { "DarkGray" } }
    Write-Host ("{0,-8} {1}" -f $r.name, $r.status) -ForegroundColor $color
}
