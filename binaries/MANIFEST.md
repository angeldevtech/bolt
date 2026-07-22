# Bundled Binary Manifest

Record exact provenance before publishing an installer. Generate SHA-256
values with PowerShell:

```powershell
Get-FileHash binaries/yt-dlp.exe -Algorithm SHA256
Get-FileHash binaries/ffmpeg.exe -Algorithm SHA256
```

| File | Version | Source URL | SHA-256 |
| --- | --- | --- | --- |
| `yt-dlp.exe` | 2026.07.04 | https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04 | `52FE3C26DCF71FBDC85B528589020BB0B8E383155CFA81B64DD447BBE35E24B8` |
| `ffmpeg.exe` | n4.4-ffmpeg-windows-build-helpers | https://github.com/yt-dlp/FFmpeg-Builds | `1B9728C7D8494BAF80DE221B637B851C4F00D23AFD9372CBEA0E98B111301B89` |
