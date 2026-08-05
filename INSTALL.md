# Installing the QuantKiller toolchains

QuantKiller spans four native languages (Python, C++, C#, Rust) plus Node.js for the separate
`web-lab/` browser demo. You only need the toolchains for what you plan to build; per-language
`BUILD.md` files are planned but not yet written (see `CLAUDE.md`/`AGENTS.md` for build commands
in the meantime).

## Windows — one command

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-toolchains.ps1
```

That script uses `winget` to install everything below. Individual commands:

```powershell
winget install --id Python.Python.3.12          --silent --accept-package-agreements --accept-source-agreements
winget install --id Rustlang.Rustup             --silent --accept-package-agreements --accept-source-agreements
winget install --id Kitware.CMake               --silent --accept-package-agreements --accept-source-agreements
winget install --id GitHub.cli                  --silent --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS           --silent --accept-package-agreements --accept-source-agreements
# C++ compiler + linker (also required by Rust's MSVC target) — large download:
winget install --id Microsoft.VisualStudio.2022.BuildTools --silent --accept-package-agreements --accept-source-agreements `
  --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

.NET SDK 8+ : `winget install Microsoft.DotNet.SDK.8`

> **Note:** open a *new* terminal after installing so PATH changes take effect.
> If `python` still opens the Microsoft Store, disable the alias under
> *Settings → Apps → Advanced app settings → App execution aliases*, or use `py -3.12`.

## macOS

```bash
brew install python@3.12 rust cmake node gh
brew install --cask dotnet-sdk
xcode-select --install        # C++ toolchain
```

## Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y python3.12 python3-pip build-essential cmake nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# .NET SDK: https://learn.microsoft.com/dotnet/core/install/linux
# GitHub CLI: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
```

The Excel add-in (planned, Phase 4) will be Windows-only (requires desktop Excel); everything
else builds on all three platforms.

## Verify

```powershell
powershell -File scripts/test-all.ps1
```

runs every language's test suite against the shared golden vectors. (This script predates the
current build layout and may need updating — see `CLAUDE.md` for the current per-language
commands if it doesn't work as-is.)
