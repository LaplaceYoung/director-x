# Managed media tools

Director X resolves explicit environment overrides first, then these plugin-managed tools, then the user runtime and system `PATH`.

## FFmpeg and FFprobe

- npm packages: `ffmpeg-static@5.3.0` and `@derhuerst/ffprobe-static@5.3.0`
- package binary release tag: `b6.1.1`
- package license: GPL-3.0-or-later
- binary source and license files are included by each npm package

The npm install selects the binary for the current operating system and architecture. Package versions are exact and lockfile-pinned. Run `directorx doctor` to inspect the version reported by the installed platform binary.

## yt-dlp

- upstream: `yt-dlp/yt-dlp`
- version: `2026.07.04`
- macOS standalone asset: `yt-dlp_macos`
- SHA-256: `498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b`
- upstream license: The Unlicense

The binary and upstream license text are included in `runtime/`. The binary is intentionally pinned and is not silently updated at runtime.
