# Installing the QuantKiller toolchains

QuantKiller spans five languages, so a full dev setup needs five toolchains. You only need the
toolchains for the languages you plan to build — each language folder's `BUILD.md` lists its
own minimal prerequisites:

[python/BUILD.md](python/BUILD.md) · [cpp/BUILD.md](cpp/BUILD.md) · [csharp/BUILD.md](csharp/BUILD.md) ·
[java/BUILD.md](java/BUILD.md) · [rust/BUILD.md](rust/BUILD.md) · [excel/BUILD.md](excel/BUILD.md)

## Windows — one command

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-toolchains.ps1
```

That script uses `winget` to install everything below. Individual commands:

```powershell
winget install --id Python.Python.3.12          --silent --accept-package-agreements --accept-source-agreements
winget install --id EclipseAdoptium.Temurin.21.JDK --silent --accept-package-agreements --accept-source-agreements
winget install --id Rustlang.Rustup             --silent --accept-package-agreements --accept-source-agreements
winget install --id Kitware.CMake               --silent --accept-package-agreements --accept-source-agreements
winget install --id GitHub.cli                  --silent --accept-package-agreements --accept-source-agreements
winget install --id Apache.Maven                --silent --accept-package-agreements --accept-source-agreements
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
brew install python@3.12 temurin@21 rust cmake maven gh
brew install --cask dotnet-sdk
xcode-select --install        # C++ toolchain
```

## Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y python3.12 python3-pip build-essential cmake maven openjdk-21-jdk
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# .NET SDK: https://learn.microsoft.com/dotnet/core/install/linux
# GitHub CLI: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
```

The Excel add-in is Windows-only (requires desktop Excel); everything else builds on all
three platforms.

## Verify

```powershell
powershell -File scripts/test-all.ps1
```

runs every language's test suite against the shared golden vectors.
