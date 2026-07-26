# Third-Party Notices

Bolt bundles these Windows executables in its NSIS installer:

## yt-dlp

- File: `binaries/yt-dlp.exe`
- Project: https://github.com/yt-dlp/yt-dlp
- Version: 2026.07.04 Windows x64 standalone release
- License: GPLv3-or-later for the PyInstaller standalone executable. The yt-dlp source project is Unlicensed; release binaries include components with separate licenses.
- License text: https://www.gnu.org/licenses/gpl-3.0.txt
- Source: https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp.exe
- Corresponding source: https://github.com/yt-dlp/yt-dlp/tree/2026.07.04
- Bundled license texts: https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/THIRD_PARTY_LICENSES.txt
- SHA-256: 52FE3C26DCF71FBDC85B528589020BB0B8E383155CFA81B64DD447BBE35E24B8.

## FFmpeg

- File: `binaries/ffmpeg.exe`
- Project: https://ffmpeg.org/ and https://github.com/yt-dlp/FFmpeg-Builds
- Version: N-125767-gd09db42d8f, Windows x64 static `win64-gpl` build
- License: GPLv3-or-later for this build. It does not use the previous local build's `--enable-nonfree` configuration.
- License text: https://www.gnu.org/licenses/gpl-3.0.txt
- Binary archive: https://github.com/yt-dlp/FFmpeg-Builds/releases/download/autobuild-2026-07-25-15-15/ffmpeg-N-125767-gd09db42d8f-win64-gpl.zip
- Build recipe: https://github.com/yt-dlp/FFmpeg-Builds/tree/autobuild-2026-07-25-15-15
- Corresponding FFmpeg source commit: https://github.com/FFmpeg/FFmpeg/commit/d09db42d8f6b1665fb4bdbdd92f78c1e6be908f7
- Archive SHA-256: F368CBD8B9AE6D730C511320BD11ACC6DA40FC8651F4E20EE1F99427F7EF9FA6
- SHA-256: 812F647456E38A0E6D87B34E3444DA798A6C5FF2877168080DBBF992DA076E63.

## Deno

- File: `binaries/deno.exe`
- Project: https://github.com/denoland/deno
- Version: 2.9.3 (Windows x86_64 release archive)
- Source: https://github.com/denoland/deno/releases/download/v2.9.3/deno-x86_64-pc-windows-msvc.zip
- License: MIT, copyright the Deno authors. The Deno repository contains notices for its bundled components.
- License text: https://github.com/denoland/deno/blob/v2.9.3/LICENSE.md
- Archive SHA-256: 60343461AC5FE3A31F4EF12667F2946BB852E20655C8610AEB7E751E87F7DF3A
- SHA-256: BC925C8729F8764F750597F3A5A365F2A2DEDC0C64D21A2997BC5F2255658FC9.

## Pinned Binary Distribution

Bolt treats these executables as pinned release inputs, separate from Bolt
source code:

- `binaries/manifest.json` records source archives, versions, licenses, and SHA-256 values.
- `scripts/provision-binaries.ps1` downloads missing inputs, verifies archives and executables, and refuses mismatched local files unless `-Refresh` is explicit.
- `binaries/*.exe` remains ignored by Git. Clean checkouts obtain files through provisioning before Tauri packaging.
- The installer includes this notice file alongside executable resources.

License handling for pinned inputs:

- FFmpeg uses the `win64-gpl` build. Its GPLv3-or-later terms permit redistribution at no cost or for a fee. Corresponding build and source links remain pinned above.
- yt-dlp's official Windows standalone executable is GPLv3-or-later because of bundled components, even though yt-dlp source code is Unlicensed. Its corresponding source and bundled license texts remain linked above.
- Deno is MIT-licensed. Deno copyright and MIT notice remain linked above.
- FFmpeg builds using `--enable-nonfree`, `nonfree`, or `gpl-nonfree` variants are excluded. The previous local FFmpeg build used `--enable-nonfree` and is not a valid distributable input.

Bolt source code is licensed separately under GNU AGPLv3-only. Bundling these
sidecar executables does not relicense Bolt. Codec patent rights are separate
from copyright licenses and are not granted by this notice.

Repository-side pinned metadata and the provisioning command are in
[`binaries/manifest.json`](binaries/manifest.json) and
[`scripts/provision-binaries.ps1`](scripts/provision-binaries.ps1). The
installer bundles executable sidecars from the pinned archives. Upstream
source and license links above describe corresponding distribution materials.

## Bolt Project License

- License: GNU Affero General Public License, version 3 only (AGPL-3.0-only)
- Copyright: 2026 angeldevtech
- Project license notice: [`LICENSE`](LICENSE)
