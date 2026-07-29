# QuantKiller — one-shot toolchain setup for Windows (uses winget)
# Run:  powershell -ExecutionPolicy Bypass -File scripts/setup-toolchains.ps1
# Note: VS Build Tools is a multi-GB download; expect 10-30 minutes.

$ErrorActionPreference = "Continue"

function Install-IfMissing($id, $probe, $extra = @()) {
    $found = $false
    try { if (Get-Command $probe -ErrorAction Stop) { $found = $true } } catch {}
    if ($found) {
        Write-Host "[skip] $id ($probe already on PATH)" -ForegroundColor DarkGray
        return
    }
    Write-Host "[install] $id ..." -ForegroundColor Cyan
    $args = @("install", "--id", $id, "--exact", "--silent",
              "--accept-package-agreements", "--accept-source-agreements") + $extra
    & winget @args
}

Install-IfMissing "Python.Python.3.12"             "python"
Install-IfMissing "EclipseAdoptium.Temurin.21.JDK" "javac"
Install-IfMissing "Rustlang.Rustup"                "cargo"
Install-IfMissing "Kitware.CMake"                  "cmake"
Install-IfMissing "GitHub.cli"                     "gh"
Install-IfMissing "Apache.Maven"                   "mvn"
Install-IfMissing "Microsoft.DotNet.SDK.8"         "dotnet"

# C++ compiler + linker (also needed by Rust's MSVC target)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVC = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -latest -property installationPath)
if ($hasVC) {
    Write-Host "[skip] VS Build Tools (C++ tools already present)" -ForegroundColor DarkGray
} else {
    Write-Host "[install] Visual Studio 2022 Build Tools + C++ workload (large!) ..." -ForegroundColor Cyan
    winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --silent `
        --accept-package-agreements --accept-source-agreements `
        --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}

Write-Host ""
Write-Host "Done. Open a NEW terminal so PATH changes take effect." -ForegroundColor Green
Write-Host "If 'python' still opens the Microsoft Store, disable the App Execution Alias"
Write-Host "(Settings > Apps > Advanced app settings > App execution aliases) or use 'py -3.12'."
