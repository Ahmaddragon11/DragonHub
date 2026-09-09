# DragonHub Architecture (v1.4.0)

```
DragonHub/
├── electron/
│   ├── main/
│   │   ├── index.ts          # app lifecycle, BrowserWindow (+rescard card window),
│   │   │                     #   tray (+Show/Hide card), dh-file:// protocol,
│   │   │                     #   permission allow-list (notifications only), window controls
│   │   ├── ipc.ts            # typed IPC router; error envelope {ok, data|error};
│   │   │                     #   single-sender = main + card windows, per-channel rate limits
│   │   └── services/
│   │       ├── files.ts      # safePath, list/stat/read/write, copy/move/remove (trash),
│   │       │                 #   drives (PowerShell), search + folderSize (symlink-safe)
│   │       ├── downloader.ts # segmented HTTP downloads (Range), queue + concurrency,
│   │       │                 #   yt-dlp media via yt-dlp-wrap, SSRF-checked URLs
│   │       ├── archive.ts    # 7-Zip via node-7z: compress/extract/list/test,
│   │       │                 #   ZipSlip pre-scan + bomb caps, verified delete-after
│   │       ├── media.ts      # sharp image ops, fluent-ffmpeg video/audio,
│   │       │                 #   sanitized ops, cancellable jobs, safe temp files
│   │       ├── vault.ts      # PBKDF2-SHA512 600k + AES-256-GCM, in-memory key,
│   │       │                 #   auto-lock, atomic crash-safe writes + backups
│   │       ├── netmonitor.ts # passive byte counters + conn info (netsh wlan),
│   │       │                 #   connections radar (netstat -ano), speed test (~10MB)
│   │       ├── netblock.ts   # global kill-switch + per-app .exe rules (netsh only,
│   │       │                 #   needsAdmin + fail-open, server-derived rule names)
│   │       ├── resmonitor.ts # CPU (os.cpus diff) / temp / RAM+pagefile / disks /
│   │       │                 #   GPU (nvidia-smi + name fallback) / Get-Process top-N,
│   │       │                 #   2s tick → res:update (main + card), safe killProcess
│   │       └── settings.ts   # electron-store: validated settings + allow-listed
│   │                         #   data collections (…/netState/netPlan/netLimits/
│   │                         #   netAppBlocks/resConfig/resCardConfig/…)
│   └── preload/index.ts      # contextBridge: invoke/on/toFileUrl (sandbox-safe)
├── src/
│   ├── shared/types.ts       # IPC + store contracts, defaults, CHANGELOG
│   └── renderer/
│       ├── App.tsx           # shell, splash, page transitions, task reminders
│       ├── main.tsx          # ?card=1 renders ResCard instead of App (same bundle)
│       ├── components/       # Shell (titlebar/sidebar/palette/shortcuts), ui kit
│       ├── pages/            # 16 pages (dashboard…about + resources + rescard)
│       ├── store/            # zustand: settings/notes/projects/tasks/downloads,
│       │                     #   debounced persist + flush-on-hide/close
│       ├── lib/              # api (IPC wrapper), utils, markdown (escaped HTML),
│       │                     #   netplan (allowance/usage/depletion pure helpers)
│       ├── i18n/             # ar (RTL-first) + en, persisted language
│       └── styles/           # Tailwind + CSS-var design system (surface/accent)
├── build/                    # icon.ico / icon.png (installer, tray, splash)
└── release/<ver>/            # electron-builder output (nsis + portable, win x64)
```

## Data flow
Renderer (sandboxed, no Node) → `window.dh.invoke(channel, …)` → preload →
`ipcMain.handle` in `ipc.ts` → service in `electron/main/services/*` →
result envelope back. Progress/events flow main→renderer via whitelisted
channels (`job:progress`, `downloads:update`, `vault:locked`, `window:state`,
`net:update`, `res:update` — the last two also reach the floating card window).

## State & persistence
- Zustand store is the single source of truth in the renderer. Notes/projects/tasks
  persist debounced (250ms) to `electron-store` via `data:set`, flushed on
  `pagehide`/`beforeunload`/hidden-tab so the last edit is never lost.
- Settings are validated/clamped on every write AND re-validated on read (protects
  against hand-edited or corrupt config files).
- Vault plaintext exists only in main-process memory while unlocked; renderer holds
  item data only while the vault view is unlocked, cleared on lock.

## Conventions for future work
- New privileged operations go in a main service + one `h('…')` IPC route; never
  expose raw paths/shell to the renderer.
- Numeric/enum input from IPC must be clamped/allow-listed at the service boundary
  (see `sanitizeImageOp`/`sanitizeVideoOp`, `sanitizePatch`, `validateCompressInputs`).
- Destructive actions: confirm dialog + Recycle Bin by default, verify outputs
  before deleting sources.
