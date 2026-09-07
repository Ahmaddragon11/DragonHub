# Supported Formats & Known Limitations (v1.2.0)

## File manager previews
| Kind | Handled as | Notes |
|---|---|---|
| Text/code (`.txt .md .js .ts .py …`) | Built-in editor, up to 20MB | Larger files open with the system app |
| Images (`.png .jpg .jpeg .webp .gif .bmp .svg .avif .tiff .ico`) | Image Studio / thumbnail grid | SVG shown as image; RAW photos (`.cr2 .nef …`) not supported |
| Video/audio (`.mp4 .mkv .webm .avi .mov .mp3 .wav .flac .ogg .m4a …`) | Video & Audio Studio | Playback via system preview; processing needs FFmpeg binary (bundled) |
| Archives (`.zip .7z .tar .gz .tgz .bz2 .xz .rar`*) | Compression Center | `*` RAR extracts only if the 7-Zip build supports it |
| Everything else | System default app | Clear fallback, never a silent failure |

## Compression Center
- Create: `zip` (AES-256 optional), `7z` (AES-256 + header encryption), `tar`,
  `gzip`, `bzip2`, `xz`. Split volumes (7z/zip), compression levels store→ultra.
- Passwords apply to ZIP/7Z only; TAR-family formats store without encryption
  (shown in the UI where applicable).
- Extraction guards: traversal entries refused, 200k-entry / 50 GiB caps,
  auto-rename on collision (never silent overwrite).

## Image Studio (sharp)
- In: JPEG/PNG/WebP/GIF/AVIF/TIFF/SVG/BMP. Out: `jpeg png webp avif gif tiff`.
- Ops: resize (≤16384px), crop, rotate, flip/flop, grayscale, blur (≤100),
  sharpen, brightness/saturation/hue, watermark text (≤200 chars), EXIF strip
  (default on). Corrupt files fail with an error, originals kept by default.

## Video & Audio Studio (FFmpeg, bundled)
- Out: `mp4 mkv webm avi mov gif` + audio-only `mp3 aac wav flac ogg`.
- Codecs allow-listed (`libx264 libx265 libvpx-vp9 copy`, `aac libmp3lame libopus copy none`),
  CRF 0–51, presets ultrafast→veryslow, fps ≤120, speed 0.25–4×, trim validated.
- Long jobs report progress, are cancellable, and clean temp files on cancel/close.

## Downloads
- Direct HTTP(S) with multi-connection resume (server must send `Accept-Ranges`).
- Media mode via yt-dlp (YouTube + 1000+ sites): best-quality or MP3. First run
  downloads the yt-dlp binary from GitHub (~large, one-time, needs internet).
- Blocked: non-http(s) schemes and loopback/private-network targets.

## Secure Vault
- PBKDF2-HMAC-SHA512 600,000 iterations → AES-256-GCM. Auto-lock timer,
  clipboard auto-clear, encrypted `.dhvault` backup/restore.
- **The master password cannot be recovered by design.** Losing it + losing the
  backup means permanent loss — the UI states this on the setup screen.

## Known limitations (honest list)
1. No auto-updater — releases announced on Telegram; Settings has no fake toggle.
2. No undo for file copy/move/delete yet — deletes go to the Recycle Bin by default.
3. No cloud sync, no plugins — local-first by design; encrypted backup files are portable.
4. Media download success depends on the source site and may break when sites change.
5. `dh-file://` previews serve any existing local file to the (sandboxed) renderer;
   full per-folder jail is tracked future work (see SECURITY_NOTES.md).
6. Windows x64 only for installer/portable builds.
