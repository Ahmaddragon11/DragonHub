# DragonHub Changelog

## v1.4.9 — 2026-10-15 (GitHub/Telegram links, real screenshot capture & hardening)

### Added
- **GitHub repository button** in the About page and the sidebar, next to the
  Telegram contact button. It asks for confirmation, then opens the project page
  (`https://github.com/Ahmaddragon11/DragonHub`) in your default browser.
- **Real screenshot capture**: pick a region, the active window or a full
  display, then copy, save or annotate (pen, rectangle, arrow, highlight, blur,
  undo) with multi-monitor and per-monitor DPI support.
- **Animated update card** with a rotating gradient border plus live download
  speed and time remaining (ETA).
- **Vault recovery**: forgot your password? Restore an encrypted backup or erase
  the vault and start over (typed confirmation), backed by a real locked-state
  restore path in the main process.
- **Per-feature animated gradient rings** across the dashboard tiles, page headers
  and contact buttons, each feature with its own hue.
- **Icon flight micro-interactions**: button and sidebar glyphs lift on hover and
  fly away when pressed.
- **Layered background detail**: a masked micro-grid plus slowly drifting accent
  pools, following the ambient-glow and low-power settings.

### Changed
- Contacting the developer on Telegram now asks for confirmation before opening
  the browser.
- Redesigned dashboard and welcome screen (live clock, daily progress ring and a
  layered hero), and a rebuilt Task Manager (sticky summary bar, sortable and
  groupable process table, performance dashboard).
- Section switching is a crossfade now - the incoming page mounts immediately, so
  a stalled animation can never leave the workspace blank.
- Media option lists use a new icon-based select control with aligned fields,
  alongside smoother route transitions and a richer text selection.

### Fixed
- Deep hardening pass across the downloads, files, archive, media, network,
  settings and vault services.
- Select fields no longer show a repeated chevron glyph in dark mode (the theme
  background shorthand was resetting the arrow, tiling it across the field).

### Security
- Stricter IPC/preload channel allow-lists, bounded external-URL opening, and
  isolated, hardened screenshot-overlay channels.

## v1.4.8 â€” 2026-10-10 (device section, appearance customisation & hardening pass)

### Added
- **Device section** with two new pages: a Task Manager (live process table with
  search, hide-system toggle, sortable columns and guarded End Task) and a
  region-capture Screenshot tool (drag to select, full-screen capture, per-monitor
  picker, optional delay, copy to clipboard or save as PNG).
- **Appearance customisation**: wallpaper with blur/dim controls, optional ambient
  glow, and a low-power mode that flattens shadows and disables glass and motion.
- `scripts/check-runtime-deps.mjs` â€” CI guard that fails the build if a
  main-process runtime dependency is declared only in `devDependencies`.
- ESLint 9, Prettier, `.editorconfig` and `.gitattributes`; `noUnusedLocals` and
  `noUnusedParameters` enabled.

### Security
- **Update installers are now checksum-verified** before they can be executed:
  the published `SHA256SUMS.txt` is fetched over the same host-allowlisted path
  and compared with a timing-safe digest check. A mismatch deletes the file and
  refuses to install.
- **Removed a command-injection vector** in the hidden-file probe â€” it spawned
  `cmd.exe /c attrib`, which re-parses `&`, `|`, `^` and `>` inside
  renderer-supplied directory names. `attrib.exe` is now invoked directly with an
  argv array and no shell.
- The floating card window can no longer be left without a working Quit action;
  the window API surface is now fully typed instead of cast.

### Fixed
- **Copy/move/rename overwrite now works.** The confirmation dialog asked "Already
  exists. Overwrite?" but the flag was never forwarded to the filesystem layer, so
  every confirmed overwrite failed with EEXIST. Overwrite is now passed only after
  an explicit confirmation.
- **`sharp` is a production dependency.** It was listed under `devDependencies`
  while being loaded by the main process, so the image studio and every thumbnail
  path failed with `MODULE_NOT_FOUND` in packaged builds.
- **Missing `side.workspace` key** made the first sidebar group header render as
  the literal string `side.workspace` in every language.
- **`safePath` rejected valid Windows paths**: TAB, LF and CR are legal in file
  names but were refused as control characters, as were the legal `&`, `^` and
  `!`.
- CI now runs the unit tests and dependency guard, release-notes generation no
  longer fails unrelated pull requests, and a second push can no longer cancel a
  release midway through publishing.

### Fixed (earlier in this release)
- **Compress page no longer leaks unhandled promise rejections**: every
  `fs:pathInfo` promise (incoming path from the file manager, add files, add
  folder, pick archive) is now guarded â€” an IPC failure shows an error toast
  instead of silently leaving the destination fields empty.
- **Downloader directory matching is now case-aware** on Windows/macOS: a
  dialog returning the same folder with a different drive-letter case
  (`c:\â€¦` vs `C:\â€¦`) no longer silently falls back to the default download dir.
- **Vault** now shows "No results" (instead of "Nothing here yet") when a
  search or type filter is active, matching every other page's behavior.

### Changed
- **Full i18n coverage**: window controls (minimize / maximize / restore) now
  have proper tooltips and localized `aria-label`s; the Compression page
  subtitle, archive "Packed" column, Video format groups (Video/Audio),
  Resources table headers (CPU% / RAM / CPU time / PID) and the Network
  radar PID/State columns are translated â€” 812 keys per language with
  verified key parity between Arabic and English.
- Resource alert desktop notifications (`CPU â‰¥ â€¦%` / `RAM â‰¥ â€¦%`) are now
  localized instead of hardcoded English.

## v1.4.7 â€” 2026-10-10 (onboarding, global shortcuts & polish)

### Added
- **First-run onboarding**: a 3-step welcome wizard (language â†’ theme/accent â†’
  feature tour). Shown once, then the running version is remembered so it never
  reappears (`app:lastSeenVersion` / `app:markVersionSeen`, stored in `appMeta`).
- **"What's new" after updates**: a dialog listing the running version's
  highlights from the built-in `CHANGELOG` (works offline), shown once per release.
- **Silent background update check** every 24h (Settings â†’ Check for updates);
  shows a toast and a red dot on the About sidebar icon when a newer release exists.
- **Real global (system-wide) shortcuts** â€” previously `globalShortcut` was
  imported but never registered:
  - `Ctrl+Shift+D` â€” show/hide the window (to tray).
  - `Ctrl+Shift+Space` â€” show the window and open the command palette.
  - Toggle in Settings â†’ General; re-registered live when the setting changes;
    a key already taken by another app is silently skipped.
- **Richer tray menu**: New note, Quick task, Focus timer and Settings alongside
  the existing show/card/Telegram/quit actions.
- **Command palette** now indexes recent file locations (open straight into the
  file manager at that path).
- **Notes editor**: lightweight Markdown toolbar (bold/italic/heading/quote/
  lists/task/code/link) that acts on the selection, plus `Tab`/`Shift+Tab`
  indentation and `Ctrl+B`/`Ctrl+I` â€” no editor library, keeps the bundle small.
- **Settings page**: sticky section index with active-section highlighting and a
  search box that filters sections by title and keywords.

### Fixed
- **Hidden files on Windows** are now actually detected (batch `attrib` per folder
  with a short cache) â€” `showHiddenFiles` finally honours the hidden attribute
  instead of always reporting files as visible.
- **Symbolic links to folders** open in the file browser instead of falling back
  to the system app (resolved once via `fs:stat`).

### Changed
- **Network plan/limits/history/app-blocks** can no longer be written through the
  generic `data:set` channel (`GENERIC_SET_BLOCKED_KEYS`); only their validated
  handlers (`net:setPlan`, `net:setLimits`, monitor rollover) persist them.
- Focus timer keeps the device awake while a session runs (`app:keepAwake`).
- Recent file locations are included in the data backup (`recentFiles`).

### Quality
- First automated tests: **30 Vitest cases** over the pure helpers
  (`lib/tasks.ts`, `lib/fuzzy.ts`, `lib/netplan.ts`). `npm test`.

## Unreleased â€” premium foundation (design system, motion, palette v2)

### Added
- Command palette v2: fuzzy search across commands, notes, tasks and projects
  (titles + content), recent items, match highlighting, keyboard hints.
- Keyboard shortcuts overlay (`?` / `Ctrl+/`), back/forward navigation
  (`Alt+â†/â†’`, mouse buttons, title-bar arrows), `/` focuses page search.
- Dashboard "Today" agenda with one-click complete and day progress; Focus
  timer is now on the dashboard; "Jump back in" recents.
- Smart task quick-add: `Call Sam tomorrow 3pm !high #work` (Arabic basics too).
- Undo for deleted notes, tasks and projects.
- Responsive shell: icon rail on narrow windows, drawer on small screens.
- Error boundaries: a crashing section no longer blanks the app.
- `npm run dev:web`: browser preview of the renderer with demo data.

### Changed
- New design tokens (radius, elevation, motion), calmer surfaces, unified
  primitives (Segmented, Tooltip, Kbd, Skeleton), focus-trapped dialogs,
  keyboard-navigable context menus, actionable toasts.
- Motion system with shared springs/easings; respects reduced motion.
- Store access via shallow selectors (far fewer re-renders).
- Static ambient background instead of perpetually animated blurred blobs.

### Fixed
- Production build ran out of memory on low-RAM machines.
- Focus timer drifted while the window was hidden.

## v1.4.6 â€” 2026-10-09 (in-app updates)

### Added
- Check for a newer release and download its Windows installer from the About page.
- Update download progress, cancellation, and install-now-or-later controls.

### Security
- Validate GitHub release URLs, download hosts, and Windows installer signatures before launch.

## v1.4.5 â€” 2026-09-10 (startup/RAM/disk performance + icon + release fix)

### Added
- Faster startup: shorter splash delay, code-split heavy pages (Downloads,
  Compress, Images, Video, Vault, Network, Resources load on first visit),
  network/resource monitors start after first paint.

### Changed
- Lower RAM use: deferred notes search, async image decoding in file preview.
- Lower disk churn: settings auto-save 250ms â†’ 800ms, network stats flush
  every ~10s instead of every 2s (live speeds and quota enforcement unchanged).
- Slightly larger app icon (transparent padding trimmed, artwork fills ~94%).

### Fixed
- Release workflow uploads only the Setup + Portable installers (fixes the
  duplicate-asset `7za.exe` failure); CI actions moved to Node 24.

## v1.4.0 â€” 2026-09-09 (resources monitor + floating card + network v2)

### Added
- New "Resources" page (Ø§Ù„Ù…ÙˆØ§Ø±Ø¯ ÙˆØ§Ù„Ø§Ø³ØªÙ‡Ù„Ø§Ùƒ): live CPU (total + per-core heat grid),
  RAM, disks (capacity + activity), GPU and temperature with animated rings and sparklines.
- Top-consumers table: which app uses what (CPU/RAM), searchable and sortable,
  with system-process filter, compact mode and double-confirmed safe termination
  (never PID 0/4, protected system names, or DragonHub itself).
- System health score (0â€“100), sustained-threshold alerts (CPU/RAM 90% for 30s,
  customizable), freeze mode, data-source status badges and CSV/JSON report export.
- Floating monitor card (rescard): draggable always-on-top mini window (CPU/RAM rings,
  up/down speeds, disk use, top app) with small/medium sizes, opacity and position lock;
  it keeps updating while the main window is hidden to tray (same process).
- Network v2: tabbed page (Overview / Plan / Limits / History / Tools) with skeletons,
  saved active tab, current-connection info (SSID, signal, radio via `netsh wlan`),
  active-connections radar (`netstat -ano` + PID â†’ process name).
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

## v1.3.0 â€” 2026-09-05 (network monitor & kill-switch)

### Added
- New "Network" page (Ø§Ù„Ø´Ø¨ÙƒØ© ÙˆØ§Ù„Ø§Ø³ØªÙ‡Ù„Ø§Ùƒ): live down/up speeds plus today down/up/total,
  sampled passively from system interface counters (`netstat -e`, no admin, zero internet used by the app itself).
- Daily cap (GB) with optional auto-block of the whole PC internet when the quota is reached,
  auto-restore at local midnight with a renewed quota, plus optional restore-on-quit.
- Data plans: name + quota + cycle (daily / weekly / monthly / custom N days) + start date
  â†’ automatic daily allowance, usage-vs-quota progress, and a 14-day history table; counters roll over at local midnight.
- Plan math display with worked examples (e.g. 70GB monthly â†’ ~2.3GB/day) so the daily allowance is always explainable.

### Security
- Internet block uses Windows Firewall rules only and requires running as Administrator (UAC);
  without elevation the monitor keeps working and the block is reported as unavailable â€” never half-applied.
- Fail-open safety: startup cleanup removes stale block rules so a crash never leaves the PC offline;
  quit-restore is optional and midnight restore (when enabled) renews the quota.
- All network data stays local in `electron-store` â€” no cloud/phone sync, no telemetry, no external calls for monitoring.

### Fixed
- Interface counters reset on reboot handled by rebasing (a counter drop is never counted as negative usage or lost history).
- Midnight rollover snapshots today into history exactly once, even across sleep/wake and daylight-saving changes.

## v1.2.0 â€” 2026-09-05 (security & reliability pass)

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
- Recurring tasks: completing one marks it done and spawns the next occurrence â€” history preserved.
- Notes: navigation params consumed once (no more StrictMode double-create duplicates).
  Markdown export includes title/tags/updated frontmatter.
- Editor: previous tab session restored (file tabs re-read from disk, small untitled buffers kept);
  untitled names use unique ids; theme follows the app setting reactively.
- Debounced notes/projects/tasks writes flush on tab-hide and app close (no lost last keystroke).
- Global shortcuts (Ctrl+B, Ctrl+1-9, F11â€¦) no longer fire while typing in inputs or Monaco.

### Added
- Command palette (Ctrl+K) quick actions: new note / task / project / download, open vault.
- Vault edit form masks secrets with show/hide; generator fills the open form when editing;
  password fields cleared on lock and modal close; autocomplete hints added.
- Sidebar theme button cycles dark â†’ light â†’ system (icon reflects resolved theme).
- Kanban columns scroll horizontally on narrow screens.
- Honest About screen (updates via Telegram channel, explicit no-auto-updater note);
  Settings privacy row is a real permanently-off indicator with switch semantics.
- Accessibility: visible focus rings, `role="switch"` toggles, `prefers-reduced-motion`
  support, compact mode covers inputs.

## v1.1.0 â€” 2026-09-03
- Fixed startup crash (electron-store v8), replaced trash with `shell.trashItem`,
  fixed invalid Tailwind classes, CSP-compliant thumbnails, app icon, missing translation keys,
  editor auto-save, task reminders, splash hang guard, Ctrl+9 docs.

## v1.0.0 â€” 2026-09-02
- Initial release: notes, projects, tasks Kanban, dual-pane file manager, Monaco editor,
  segmented download manager + yt-dlp media, ZIP/7z/TAR/GZIP/XZ center, sharp image studio,
  FFmpeg video/audio studio, AES-256-GCM vault, themes, AR/EN, command palette, shortcuts.
