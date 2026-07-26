# Bundled Binary Manifest

`manifest.json` is the source of truth for provisioning. It pins exact
download URLs, archive hashes, executable hashes, and versions. Run:

```powershell
bun run prepare:binaries
```

This leaves matching files alone. Use `-Refresh` only when intentionally
replacing a mismatched local file:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/provision-binaries.ps1 -Refresh
```

The current pins are:

| File | Version | Source URL | Archive SHA-256 | Executable SHA-256 |
| --- | --- | --- | --- | --- |
| `yt-dlp.exe` | 2026.07.04 | https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp.exe | n/a | `52FE3C26DCF71FBDC85B528589020BB0B8E383155CFA81B64DD447BBE35E24B8` |
| `ffmpeg.exe` | N-125767-gd09db42d8f | https://github.com/yt-dlp/FFmpeg-Builds/releases/download/autobuild-2026-07-25-15-15/ffmpeg-N-125767-gd09db42d8f-win64-gpl.zip | `F368CBD8B9AE6D730C511320BD11ACC6DA40FC8651F4E20EE1F99427F7EF9FA6` | `812F647456E38A0E6D87B34E3444DA798A6C5FF2877168080DBBF992DA076E63` |
| `deno.exe` | 2.9.3 | https://github.com/denoland/deno/releases/download/v2.9.3/deno-x86_64-pc-windows-msvc.zip | `60343461AC5FE3A31F4EF12667F2946BB852E20655C8610AEB7E751E87F7DF3A` | `BC925C8729F8764F750597F3A5A365F2A2DEDC0C64D21A2997BC5F2255658FC9` |

All URLs are pinned release assets, not rolling `latest` URLs. Executables
remain ignored by Git and must be provisioned before a clean build.
