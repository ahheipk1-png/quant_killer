param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$demoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$webRoot = Join-Path $demoRoot "web"

$pythonCandidates = @(
    "C:\Program64\Anaconda\python.exe",
    "C:\ProgramData\Anaconda3\python.exe"
)

$python = $pythonCandidates |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1

if (-not $python) {
    $pythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $python = $pythonCommand.Source
    }
}

if (-not $python) {
    throw "Python was not found. Serve the web folder with any local HTTP server."
}

Write-Host "Open http://127.0.0.1:$Port"
& $python (Join-Path $demoRoot "serve.py") --port $Port --directory $webRoot
