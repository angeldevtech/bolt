# Bolt

Bolt is a minimal desktop wrapper around `yt-dlp`, focused on simplicity over flexibility.

## Why Bolt?

Bolt is designed for users who want a simple way to download media without dealing with technical options.

It intentionally limits choices to reduce friction:
- No format tweaking
- No codec decisions
- No configuration overhead

If you need full control, tools like `yt-dlp` are more appropriate.

Bolt focuses on a different goal:
**making common downloads as straightforward as possible.**
Paste → Click → Done.

## Features

* One-click downloads (MP3 / MP4 / HD)
* Clean, minimal interface
* Download history tracking
* Lightweight desktop app (Tauri)

## UI Overview

* **Main actions**: MP3 / MP4 / MP4 HD
* **History list**: quick access to past downloads
* **Config modal**: optional settings (kept minimal)

## Tech Stack

* Vite
* SolidJS
* TypeScript
* Bun
* Tauri (Rust backend)
* yt-dlp

## Development

```bash
bun install
bun run tauri dev
```

## Build

Run commands from Bolt repository root, same folder as `package.json`.

Install dependencies first:

```powershell
bun install --frozen-lockfile --ignore-scripts
```

### Production build

Production build hides application and child-process console windows. Generate it with:

```bash
bun run build:tauri
```

Generated files:

```text
src-tauri/target/release/app.exe
src-tauri/target/release/bundle/nsis/Bolt_0.1.0_x64-setup.exe
```

The NSIS installer is unsigned. It includes yt-dlp and ffmpeg, so users do not
need Python, PATH configuration, or a package manager.

### Diagnostic build

Diagnostic build shows one application console and writes logs under:
`%LOCALAPPDATA%\Bolt\logs\`.

```powershell
bun run build:tauri:diagnostic
```

This command uses Cargo feature `diagnostic` explicitly. It produces the same
output paths as production, so run it after production build when investigating
an issue. Copy or rename artifacts before generating another build if both are
needed.

Diagnostic output:

```text
src-tauri/target/release/app.exe
src-tauri/target/release/bundle/nsis/Bolt_0.1.0_x64-setup.exe
%LOCALAPPDATA%\Bolt\logs\
```

For quick frontend-only checks:

```powershell
bun run build:check
bun run build:vite
```

Build artifacts under `src-tauri/target/` are generated files and should not be
included in source review or release provenance. Publish only after verifying
the bundled binaries, installer hashes, signatures, and Defender/EDR results.

## Notes

* Windows x64 is supported for MVP release builds.
* yt-dlp and ffmpeg are bundled from `binaries/`.
* Update action requires internet access and can be affected by antivirus or
  locked files.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled binary
sources and licensing obligations.

## License

AGPL-3.0 © 2026 angeldevtech
