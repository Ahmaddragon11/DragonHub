# DragonHub Changelog

## v1.4.5 — 2026-09-10 (startup/RAM/disk performance + icon + release fix)

### Added
- Faster startup: shorter splash delay, code-split heavy pages (Downloads,
  Compress, Images, Video, Vault, Network, Resources load on first visit),
  network/resource monitors start after first paint.

### Changed
- Lower RAM use: deferred notes search, async image decoding in file preview.
- Lower disk churn: settings auto-save 250ms → 800ms, network stats flush
  every ~10s instead of every 2s (live speeds and quota enforcement unchanged).
- Slightly larger app icon (transparent padding trimmed, artwork fills ~94%).

### Fixed
- Release workflow uploads only the Setup + Portable installers (fixes the
  duplicate-asset `7za.exe` failure); CI actions moved to Node 24.

## v1.4.0 — 2026-09-09 (resources monitor + floating card + network v2)

### Added
- New "Resources" page (الموارد والاستهلاك): live CPU (total + per-core heat grid),
  RAM, disks (capacity + activity), GPU and temperature with animated rings and sparklines.
- Top-consumers table: which app uses what (CPU/RAM), searchable and sortable,
  with system-process filter, compact mode and double-confirmed safe termination
  (never PID 0/4, protected system names, or DragonHub itself).
- System health score (0–100), sustained-threshold alerts (CPU/RAM 90% for 30s,
  customizable), freeze mode, data-source status badges and CSV/JSON report export.
- Floating monitor card (rescard): draggable always-on-top mini window (CPU/RAM rings,
  up/down speeds, disk use, top app) with small/medium sizes, opacity and position lock;
  it keeps updating while the main window is hidden to tray (same process).
- Network v2: tabbed page (Overview / Plan / Limits / History / Tools) with skeletons,
  saved active tab, current-connection info (SSID, signal, radio via `netsh wlan`),
  active-connections radar (`netstat -ano` + PID → process name).
- Per-application internet block (firewall rule per .exe, requires admin, same
  fail-open + needsAdmin contract as the global kill-switch).
- History bar charts (SVG) with daily average / best / worst day, quota-depletion
  forecast (`projectDepletion`, previously unused), 80%/90% cap banners, history CSV export.
- Optional speed test (~10MB, explicit confirmation + data-usage warning, rate-limited).

### Changed
- Network history retention readable up to 30 days in the UI (store keeps 90 days).
- Tray menu gains Show/Hide monitor card; `window-all-closed` no longer quits while
  the card is open; quit-restore firewall semantics unchanged.

### Security
- All new IPC channels (`res:*`, `net:connInfo`, `net:connections`, `net:appBlocked*`,
  `net:speedTest`, `res:card:*`) whitelisted in preload with the same single-sender
  (main + card windows) + rate-limit guards; `res:killProcess`/`net:speedTest` strictly limited.
- Per-app firewall rule names are derived server-side (basename + sha1 hash) and
  exe paths strictly validated (absolute `.exe`, no quotes/null bytes, no `..`).

## v1.3.0 — 2026-09-05 (network monitor & kill-switch)

### Added
- New "Network" page (الشبكة والاستهلاك): live down/up speeds plus today down/up/total,
  sampled passively from system interface counters (`netstat -e`, no admin, zero internet used by the app itself).
- Daily cap (GB) with optional auto-block of the whole PC internet when the quota is reached,
  auto-restore at local midnight with a renewed quota, plus optional restore-on-quit.
- Data plans: name + quota + cycle (daily / weekly / monthly / custom N days) + start date
  → automatic daily allowance, usage-vs-quota progress, and a 14-day history table; counters roll over at local midnight.
- Plan math display with worked examples (e.g. 70GB monthly → ~2.3GB/day) so the daily allowance is always explainable.

### Security
- Internet block uses Windows Firewall rules only and requires running as Administrator (UAC);
  without elevation the monitor keeps working and the block is reported as unavailable — never half-applied.
- Fail-open safety: startup cleanup removes stale block rules so a crash never leaves the PC offline;
  quit-restore is optional and midnight restore (when enabled) renews the quota.
- All network data stays local in `electron-store` — no cloud/phone sync, no telemetry, no external calls for monitoring.

### Fixed
- Interface counters reset on reboot handled by rebasing (a counter drop is never counted as negative usage or lost history).
- Midnight rollover snapshots today into history exactly once, even across sleep/wake and daylight-saving changes.

## v1.2.0 — 2026-09-05 (security & reliability pass)

### Security
- Archive extraction pre-scans entries: blocks `..` traversal, absolute paths, and zip bombs
  (200,000 entries / 50 GiB uncompressed caps). Extraction auto-renames instead of silently overwriting.
- Vault `changePassword` is crash-safe (new data blob written before meta, `.bak` backups of both)
  and wipes the old key from memory. Backup import validates file size (64MB), schema, and refuses
  bundles with weaker KDF settings than the app produces.
- Download URL validation blocks loopback/private-network literals (SSRF guard).
- Media/archive inputs from the renderer are clamped (dimensions, blur, quality, CRF, fps, speed,
  volume, bitrate, trim) and codec/format/preset values are allow-listed.
- Settings patches are validated and clamped (unknown keys dropped, ranges enforced, telemetry
  permanently off). Renderer data collections restricted to known keys with 50MB caps and
  prototype-pollution guards on import.
- File search and folder-size no longer follow symlinks (cycle-safe). Copy/move reject same-path
  (case-insensitive on Windows). Atomic writes use unique temp files with cleanup.
- Drive listing uses PowerShell with timeout (wmic is deprecated/removed on Windows 11).
- Only the `notifications` permission is granted (task reminders); camera/mic/geolocation stay denied.
- Single-instance guard skips all setup in the second process; Windows AppUserModelId set.

### Fixed
- File manager: text files over 20MB open with the system app instead of OOMing the editor;
  unknown binaries are never routed to the editor. Favorites save the actually-shown folder.
- Recurring tasks: completing one marks it done and spawns the next occurrence — history preserved.
- Notes: navigation params consumed once (no more StrictMode double-create duplicates).
  Markdown export includes title/tags/updated frontmatter.
- Editor: previous tab session restored (file tabs re-read from disk, small untitled buffers kept);
  untitled names use unique ids; theme follows the app setting reactively.
- Debounced notes/projects/tasks writes flush on tab-hide and app close (no lost last keystroke).
- Global shortcuts (Ctrl+B, Ctrl+1-9, F11…) no longer fire while typing in inputs or Monaco.

### Added
- Command palette (Ctrl+K) quick actions: new note / task / project / download, open vault.
- Vault edit form masks secrets with show/hide; generator fills the open form when editing;
  password fields cleared on lock and modal close; autocomplete hints added.
- Sidebar theme button cycles dark → light → system (icon reflects resolved theme).
- Kanban columns scroll horizontally on narrow screens.
- Honest About screen (updates via Telegram channel, explicit no-auto-updater note);
  Settings privacy row is a real permanently-off indicator with switch semantics.
- Accessibility: visible focus rings, `role="switch"` toggles, `prefers-reduced-motion`
  support, compact mode covers inputs.

## v1.1.0 — 2026-09-03
- Fixed startup crash (electron-store v8), replaced trash with `shell.trashItem`,
  fixed invalid Tailwind classes, CSP-compliant thumbnails, app icon, missing translation keys,
  editor auto-save, task reminders, splash hang guard, Ctrl+9 docs.

## v1.0.0 — 2026-09-02
- Initial release: notes, projects, tasks Kanban, dual-pane file manager, Monaco editor,
  segmented download manager + yt-dlp media, ZIP/7z/TAR/GZIP/XZ center, sharp image studio,
  FFmpeg video/audio studio, AES-256-GCM vault, themes, AR/EN, command palette, shortcuts.
