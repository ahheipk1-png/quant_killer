# Build and run

> Documentation status: synchronized with the current local server, assets, and validation commands on 2026-08-04.

## Run locally

From the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Open <http://127.0.0.1:8000/>. The server binds only to loopback and serves the `web/` directory.

Do not open HTML files directly with a `file:///` URL. Web Workers, WebAssembly streaming, JavaScript modules, Pyodide, and .NET assets require HTTP behavior and correct MIME types.

`serve.py` assigns:

- `.js` and `.mjs` → `application/javascript`,
- `.wasm` → `application/wasm`,
- `.json` → `application/json`,
- `Cache-Control: no-store` during development.

The current `web/` tree is approximately 47 MiB because it bundles Pyodide and
.NET WebAssembly. `no-store` is useful while editing but is unsuitable as a
hosted caching policy. Production assets should be content-hashed and immutable.

## Rebuild C++ WebAssembly

Activate an Emscripten SDK or supply its compiler explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1 -EmscriptenCompiler C:\path\to\em++.bat
```

The script compiles both `src/pricer.cpp` and `src/advanced_pricer.cpp`, exporting the functions listed in `build.ps1`, and writes `web/pricer.js` plus `web/pricer.wasm`.

## Other compiled engines

- Rust source is under `rust-engine/`; its browser artifact is `web/rust-pricer.wasm`.
- C# source is under `csharp-engine/`; browser runtime assets are bundled under `web/`.
- Python source used by Pyodide is under `web/python/`. `python-engine/pricer.py` is also retained as a source/reference implementation.

The root build script currently rebuilds C++ only. Confirm the appropriate Rust/.NET toolchain before changing their compiled browser artifacts.

## Cache-busting

Worker and module URLs use query versions such as `?v=4`. When changing a worker-loaded script, bump the relevant URL so an already-running browser session does not reuse a stale module. The development server also sends `no-store`, but explicit versions make worker dependency changes obvious.

The volatility page and browser report currently load
`volatility-models.js?v=3`; asset-version expectations are enforced by
`volatility-test.cjs`.

## Generated-file policy

Edit language source files, not minified/generated browser output. Rebuild after ABI or implementation changes. Keep `polyglot-contract.js`, worker bindings, exported C++ symbols, and every compiled implementation synchronized when the packed contract changes.

## Validate after a build or documentation update

Run all eight root tests listed in [validation](../testing/validation.md). There
is not yet a `package.json` or CI wrapper, so each command must currently be run
explicitly. Also open the executable report and conformance pages through HTTP;
Node-only tests cannot detect runtime download, MIME, worker, or browser layout failures.
