param(
    [string]$EmscriptenCompiler = ""
)

$ErrorActionPreference = "Stop"
$demoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    $runtimePython = Get-ChildItem -Path "$env:USERPROFILE\.cache\codex-runtimes" -Filter "python.exe" -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -match "dependencies\\python$" } |
        Select-Object -First 1
    if ($runtimePython) {
        $env:Path = "$($runtimePython.DirectoryName);$env:Path"
    }
}

if (-not $EmscriptenCompiler) {
    $compilerCommand = Get-Command "em++" -ErrorAction SilentlyContinue
    if ($compilerCommand) {
        $EmscriptenCompiler = $compilerCommand.Source
    } elseif ($env:EMSDK) {
        $candidates = @(
            (Join-Path $env:EMSDK "upstream\emscripten\em++.exe"),
            (Join-Path $env:EMSDK "upstream\emscripten\em++.bat")
        )
        $candidate = $candidates |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1
        if ($candidate) {
            $EmscriptenCompiler = $candidate
        }
    } else {
        $dotnetEmscripten = Get-ChildItem -Path "C:\Program Files\dotnet\packs" -Filter "em++.bat" -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($dotnetEmscripten) {
            $EmscriptenCompiler = $dotnetEmscripten.FullName
        }
    }
}

if (-not $EmscriptenCompiler -or -not (Test-Path -LiteralPath $EmscriptenCompiler)) {
    throw "Emscripten em++ was not found. Install emsdk, activate it, then rerun this script."
}

if ($EmscriptenCompiler -match "Microsoft.NET.Runtime.Emscripten") {
    $emscriptenTools = Split-Path -Parent (Split-Path -Parent $EmscriptenCompiler)
    $dotnetToolBin = Join-Path $emscriptenTools "bin"
    $nodeExecutable = $EmscriptenCompiler.Replace(".Sdk.win-x64", ".Node.win-x64").Replace("tools\emscripten\em++.bat", "tools\bin\node.exe")
    $env:DOTNET_EMSCRIPTEN_LLVM_ROOT = $dotnetToolBin
    $env:DOTNET_EMSCRIPTEN_BINARYEN_ROOT = $emscriptenTools
    $env:DOTNET_EMSCRIPTEN_NODE_JS = $nodeExecutable
    $env:EM_CACHE = $EmscriptenCompiler.Replace(".Sdk.win-x64", ".Cache.win-x64").Replace("em++.bat", "cache")
    $env:FROZEN_CACHE = "True"
}

$source = Join-Path $demoRoot "src\pricer.cpp"
$advancedSource = Join-Path $demoRoot "src\advanced_pricer.cpp"
$output = Join-Path $demoRoot "web\pricer.js"
$arguments = @(
    $source,
    $advancedSource,
    "-O3",
    "-std=c++17",
    "--no-entry",
    "-sWASM=1",
    "-sMODULARIZE=1",
    "-sEXPORT_NAME=createQuantKillerModule",
    "-sENVIRONMENT=web,worker,node",
    "-sFILESYSTEM=0",
    "-sEXPORTED_FUNCTIONS=_qk_mc_european_price,_qk_mc_last_std_error,_qk_mc_last_std_dev,_qk_mc_generate_distribution,_qk_mc_distribution_terminal,_qk_mc_distribution_payoff,_qk_bs_european_price,_qk_baw_american_price,_qk_ju_american_price,_qk_carr_randomization_price,_qk_bjerksund_american_price,_qk_bjerksund_2002_american_price,_qk_binomial_european_price,_qk_binomial_american_price,_qk_advanced_set_parameter,_qk_advanced_price,_qk_advanced_last_std_error,_qk_advanced_last_std_dev",
    "-sEXPORTED_RUNTIME_METHODS=cwrap",
    "-o",
    $output
)

& $EmscriptenCompiler @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Emscripten compilation failed with exit code $LASTEXITCODE."
}

Write-Host "Built web\pricer.js and web\pricer.wasm"
