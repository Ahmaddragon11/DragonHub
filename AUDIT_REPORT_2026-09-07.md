# DragonHub Security & Bug Audit Report

**Date:** 2026-09-07
**Version audited:** v1.3.0
**Method:** 10 parallel read-only agents (no source files modified)
**Scope:** Electron shell, services (files / downloader / archive / media / vault / settings / network), renderer XSS, dependencies/build, logic & UX bugs

> This file is the aggregated output of the 10 agents. No code was changed to produce it.
> Format per finding: `[SEVERITY] file:line — title — description + impact`

**Severity totals (approx):** Critical: 4 · High: ~30 · Medium: ~40 · Low: ~40 · Info: ~15

Top priorities to fix first are marked ⭐ below.

---

## 1) Electron Shell — `main/index.ts`, `preload/index.ts`, `ipc.ts`, CSP (Agent 1)

[High] `electron/preload/index.ts:5-13,26` + `electron/main/ipc.ts:107-127` — Generic `invoke(channel,...)` with full-disk `fs:*` — No channel allowlist in preload (`invoke` forwards any string), `on()` is allowlisted but `invoke` is not. Any renderer XSS = arbitrary file read/write/delete as user + persistence (e.g. Startup folder).

[High] `electron/main/ipc.ts:122` → `electron/main/services/files.ts:267-271` — `fs:open` = arbitrary `shell.openPath()` — only `safePath()`, no extension blocklist, no confirmation. Post-XSS RCE by opening attacker-dropped `.bat/.ps1/.exe/.lnk`.

[High] `electron/main/index.ts:116-132` + `preload:36` + `index.html:5` — `dh-file://` has no jail, serves any existing file — `decodeURIComponent → normalize → existsSync/statSync` check, then `net.fetch(fileURL)`. No allowlist/token, host unchecked, TOCTOU. CSP explicitly allows `dh-file:`. Post-XSS local file disclosure (`vault.bin`, `electron-store` JSON) + canvas exfil oracle.

[Medium] `electron/main/ipc.ts:20-28` — No sender/frame validation — `h()` ignores `event.sender`/`senderFrame`. Any future second window/webview inherits full privileged IPC.

[Medium] `electron/main/index.ts:68-74` — Incomplete navigation guard — only `setWindowOpenHandler` + main-frame `will-navigate`. Missing `will-frame-navigate`, `will-redirect`, `web-contents-created`/`did-create-window`, `will-attach-webview`. Iframe can navigate to `file://`/`dh-file:` HTML without CSP headers.

[Medium] `electron/main/services/downloader.ts:42-57,121,174,208,294` — SSRF literal-only + `redirect:follow` bypass — `validateUrl()` blocks literal private IPs only, but all fetches follow redirects without re-validation. Attacker URL 302 → `169.254.169.254`/intranet.

[Medium] `index.html:5` — CSP missing hardening — has `default-src 'self'; script-src 'self'` (good, no eval/remote) but missing `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-src/frame-ancestors`, `upgrade-insecure-requests`. `<base>` hijack / `<object>` possible if HTML injection achieved.

[Low] `electron/main/index.ts:139-141` — `onHeadersReceived` no-op with misleading comment (passes headers through, claims stripping).

[Low] `electron/main/ipc.ts:48-51` — `app:openExternal` allows any `https?`/`mailto:` incl. `http://localhost/...`, `mailto:` param injection.

[Low] `electron/main/ipc.ts:55` — `app:setLoginItem` renderer-controllable persistence (auto-start, no confirmation).

[Low] `electron/main/index.ts:206-212` — Window/app controls bypass `h()` wrapper (raw values, no envelope) — post-XSS DoS via `app:relaunch` loop.

[Low] `electron/main/index.ts:136-137` — No explicit device-permission deny (HID/USB/Serial/Bluetooth) — default deny today, but no explicit hardening.

[Low] `electron/main/services/files.ts:17` — `safePath()` control-char check only on `basename`, misses dirname; allows 32k paths.

[Low] `electron/preload/index.ts:36` vs `index.ts:118-119` — `toFileUrl` encoding asymmetry (`encodeURI` vs single `decodeURIComponent`) — wrong-file preview confusion.

[Low] `downloader.ts:75-76,319-320` + `settings.ts:36` — Unjailed download write dir (`downloadDir` only `slice(0,1024)`, no validation) → arbitrary directory write post-XSS.

[Info] `tsconfig.json:21` — `types:["node","vite/client"]` hides sandbox violations in renderer (can import `node:fs` types without tsc error).

**SECURITY_NOTES.md residual risks — all still present (confirmed):** (1) `dh-file://` no jail, (2) generic `invoke`, (3) full-disk `fs:*` no blocklist, (4) DNS-rebinding SSRF, (5) archive passwords in CLI args, (6) JS string key copies, (7) no vault brute-force counter.

**Checked OK:** window opts (`contextIsolation/sandbox/no-nodeIntegration`), `bypassCSP:false`, `setWindowOpenHandler` deny + https-only external, single-instance lock, preload `on()` allowlist, IPC error envelope (message only), `lstat`/visited-set/caps in list/search/folderSize, atomic writes, archive ZipSlip/bomb guards on main path, media clamps/allowlists, settings `sanitizePatch`/allowlist/50MB/proto guards, vault init/changePassword/import guards, downloader literal-IP block, `net:setPlan/setLimits` validation, vite `server.port 5173 strictPort`, CSP `script-src 'self'` + `connect-src 'self'`, `strict:true`.

---

## 2) File Service — `services/files.ts`, `ipc fs:*`, `Files.tsx`, `Editor.tsx` (Agent 2)

⭐ [High] `files.ts:15` — `safePath` is not a jail (null-byte/length/basename check + `resolve` only, explicitly not a sandbox). No IPC caller adds allowlist → any XSS = arbitrary FS access.

[Low] `files.ts:17` — control-char check only on basename; no block for ADS (`file:stream`), trailing dot/space, `CON/NUL`, UNC `\\?\` / `\\server\share`.

[Medium] `files.ts:28` — `listDir` unbounded `Promise.all(lstat)` — 100k-entry dir exhausts FDs/memory (DoS).

[Low] `files.ts:59` — `isHiddenWin` stub always false — hidden/system files shown even when `showHidden=false`.

[Low] `files.ts:42` — symlink-to-dir reported as file (`lstat.isDirectory()`), then `fs:open` follows link unexpectedly.

[Medium] `files.ts:75` — `readText` stat-then-read TOCTOU — growth between `stat` and `readFile` exceeds 20MB → main OOM + IPC blowup. Same in `readBase64`.

[Medium] `files.ts:96` — `readBase64` 50MB → ~66MB string + JSON IPC, TOCTOU, no streaming.

[Medium] `files.ts:82` — `writeText` no size limit — unbounded renderer string → main OOM / disk fill. No `fsync` before rename.

[High] `files.ts:82` — `writeText` silent overwrite — tmp+rename clobbers any path without confirm/backup (editor autosave uses it).

[Medium] `files.ts:107` — `createFile` exists-then-write race (no `wx`/`O_EXCL`) — concurrent bypass of already-exists guard.

[High] `files.ts:113` — `rename` silent overwrite, no same-path/self-containment check, no EXDEV fallback (unlike move).

[High] `files.ts:117` — `copy` `force:true` + `errorOnExist:false` — silent merge/overwrite, no quota/cancel/progress → data loss + disk-fill DoS.

[Medium] `files.ts:121` — copy/move into-itself check is case-sensitive prefix, not `realpath`-resolved → bypass on case-insensitive FS / symlinks.

[Medium] `files.ts:125` — `move` fallback copy+rm non-atomic — crash leaves duplicate/partial, swallows original error.

⭐ [Critical] `files.ts:138` — `remove` no guardrails — `rm recursive+force` on any `safePath` incl. `/`, `C:\`, home, userData. Single IPC wipes drive/home.

[High] `files.ts:138` — trash bypass client-controlled — `useTrash` boolean from renderer; `dialog:confirm` bypassable via direct IPC; `trashItem` failure has no fallback.

[High] `files.ts:267` — `openExternal` arbitrary program launch — no extension allowlist/confirm → XSS → 1-click RCE via `.exe/.msi/.ps1/.lnk/.bat`.

[Medium] `files.ts:277` — `hashFile` unbounded, no cancel — spam concurrent hashes → CPU/IO DoS.

[Low] `files.ts:165` — `getDrives` CSV parse bugs (`split(',')` naive, `Number()||undefined` turns free=0 into undefined, label always Drive). `PATH` lookup of `powershell.exe` is hijack surface (use absolute System32 path).

[High] `ipc.ts:107` — all `fs:*` handlers unauthenticated, no rate limit → XSS = full FS compromise + probing + DoS spam.

[Low] `ipc.ts:125` — `fs:exists` existence oracle (fingerprint apps/keys/wallets).

[Info] `ipc.ts:127` — `fs:join` + `fs:pathInfo` pure path constructor without `safePath` → enables jail-escape composition.

[Medium] `Files.tsx:77` — `doPaste` silent overwrite (no exists check; relies on main `force:true`; partial multi-file paste on error).

[Medium] `Files.tsx:93` — `doRename/doCreate` allow separators/traversal (`trim()` only; `../../`, `a/b`, ADS/reserved not blocked).

[Low] `Files.tsx:179` — breadcrumb root loss (`split` + rejoin loses leading `/`, UNC prefix, drive semantics).

[Low] `Files.tsx:152` — `Shift+Delete` permanent delete hotkey → accidental Recycle Bin bypass.

[Medium] `Editor.tsx:75` — session restore up to 32×20MB re-read from disk → 640MB into Monaco on startup (OOM/slow start).

[Medium] `Editor.tsx:100` — autosave clobbers external edits silently (no mtime/etag check, errors swallowed).

[Medium] `Editor.tsx:130` — openDialog multi-open OOM (loops every picked file, no count cap).

[Medium] `Editor.tsx:136` — save-as silent overwrite (no exists confirm).

[Low] `Editor.tsx:114` — duplicate-tab check case-sensitive (`===`) → `C:\A.txt` vs `c:\a.txt` split-brain edits.

[Low] `files.ts:63` — `stat` follows symlinks + leaks mode/mtime/atime (target probing).

[Low] `files.ts:197` — `search` query unbounded (huge query CPU DoS; lowercased seen-set breaks case-sensitive FS).

**Checked OK:** drives PowerShell `execFile` fixed argv + timeout (no injection); search/folderSize `lstat` + skip symlinks + visited caps; atomic tmp+random+cleanup; samePath + into-itself base-case guard; read caps enforced server-side (20/50MB); IPC error serialization safe; `openEntry` size gate + fallbacks; editor `stashTabs` caps (32 tabs, 1MB untitled).

---

## 3) Downloader + Network — `downloader.ts`, `netmonitor/netblock`, `Network.tsx` (Agent 3)

[High] `downloader.ts:42` — `validateUrl` blocks literal IPs only, no DNS resolution — domain/CNAME → 127/10/172.16/192.168/169.254 bypasses (documented as accepted, still SSRF primitive).

[High] `downloader.ts:48` — literal-IP blocklist incomplete — misses decimal/octal/hex/mixed encodings except single `2130706433` (e.g. `3232235777` = 192.168.1.1, `0xC0.0xA8...`, `[::ffff:7f00:1]`); `&&` precedence bug limits integer check.

⭐ [Critical] `downloader.ts:121,175,208,295` — probe/single/segmented/thumbnail fetches use `redirect:'follow'` without re-validation → attacker `https://public/302` → `127.0.0.1`/`169.254.169.254` bypasses everything. yt-dlp child (`:327`) follows redirects internally too.

⭐ [Critical] `downloader.ts:295` — thumbnail fetch has zero SSRF guard — `fetch(meta.thumbnail)` where thumbnail is remote video metadata (attacker-controlled), no `validateUrl`, no size/timeout; `arrayBuffer()` unbounded → intranet read + exfil oracle (`data:` URL to renderer) + OOM.

[High] `downloader.ts:72` — `add(url, opts.dir)` arbitrary directory creation — `dir` unsanitized, `mkdir -p` any path; reachable via `dl:add` + generic `invoke`.

[High] `downloader.ts:319` — `mediaDownload` arbitrary file write via `opts.dir` — unsanitized dir + `mkdir -p` + yt-dlp `-o dir/%(title)...`; `downloadDir` setting only `slice(0,1024)`.

[High] `downloader.ts:256` — arbitrary file delete via tampered `savePath` — `remove(id, deleteFile)` does `rm(savePath)`; `savePath` comes from persisted `downloads` collection writable via generic `data:set` (no schema) → set `savePath=/victim/file` then `dl:remove(deleteFile=true)`.

[Medium] `downloader.ts:24` — `sanitizeFilename` allows `..`/`.`/reserved/trailing-dot (only strips `<>:"/\|?*` + controls); `decodeURIComponent` outside `try` throws on malformed `%`.

[Medium] `downloader.ts:327` — yt-dlp `-o %(title).120s` unsanitized remote title in output path (relies on yt-dlp sanitization; traversal risk on some versions).

[High] `downloader.ts:329` — `opts.format` passed to yt-dlp without allow-list (docs claim allow-listed; `mediaDownload` has none). Argv array (no shell) so no shell injection, but selector injection + DoS.

[High] `downloader.ts:278` — `YTDlpWrap.downloadFromGithub(bin)` with no integrity check — fetches exe on first media download, executes blindly; pre-planted `%APPDATA%/DragonHub/bin/yt-dlp(.exe)` executed. Supply-chain/RCE.

[Medium] `downloader.ts:99` — queue/concurrency unbounded DoS — queue length unlimited, worst ~10×32=320 concurrent fetches + handles; `.dhpart` + `truncate(size)` preallocates untrusted `Content-Length` (10TB → disk exhaustion); no fetch timeout; segment retry holds slots.

[Low] `downloader.ts:137` — progress `setInterval(700ms)` per download + yt-dlp progress unbounded → renderer flood.

[Low] `downloader.ts:59` — `uniquePath` TOCTOU (exists-check then create) → symlink race (low, single-user).

⭐ [Critical] `ipc.ts:78` — generic `data:set` bypasses `net:setPlan`/`net:setLimits` validation — `netState/netPlan/netLimits` in `ALLOWED_DATA_KEYS` writable raw (50MB+proto guards only) → history/cap/allowance spoofing without validated handlers; `readKey` tolerant → fail-open.

[High] `netmonitor.ts:299` — system counters spoofable to force kill-switch — any local traffic inflates totals; attacker generates traffic → `enforceCap` → `onCapExceeded` → internet block (DoS). Fallback sums loopback/virtual → spurious jump.

[High] `netmonitor.ts:261` — midnight rollover desync when `restoreAtMidnight=false` — always clears `blockedByCap=false` (`:282`) but `index.ts:161` only unb
...[truncated 20887 chars]