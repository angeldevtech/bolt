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

```bash
bun run tauri build
```

Windows x64 release builds produce an unsigned NSIS installer at
`src-tauri/target/release/bundle/nsis/*-setup.exe`. Installer includes yt-dlp
and ffmpeg, so users do not need Python, PATH configuration, or a package
manager. Bolt stores download history and replaceable yt-dlp copy under
`%LOCALAPPDATA%\Bolt`.

## Notes

* Windows x64 is supported for MVP release builds.
* yt-dlp and ffmpeg are bundled from `binaries/`.
* Update action requires internet access and can be affected by antivirus or
  locked files.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled binary
sources and licensing obligations.

## License

AGPL-3.0 © 2026 angeldevtech
