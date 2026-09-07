# DragonHub Changelog

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
