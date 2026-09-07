# DragonHub Architecture (v1.2.0)

```
DragonHub/
├── electron/
│   ├── main/
│   │   ├── index.ts          # app lifecycle, BrowserWindow, tray, dh-file:// protocol,
│   │   │                     #   permission allow-list (notifications only), window controls
│   │   ├── ipc.ts            # typed IPC router; error envelope {ok, data|error}
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
│   │       └── settings.ts   # electron-store: validated settings + allow-listed
│   │                         #   data collections (notes/projects/tasks/downloads/…)
│   └── preload/index.ts      # contextBridge: invoke/on/toFileUrl (sandbox-safe)
├── src/
│   ├── shared/types.ts       # IPC + store contracts, defaults, CHANGELOG
│   └── renderer/
│       ├── App.tsx           # shell, splash, page transitions, task reminders
│       ├── components/       # Shell (titlebar/sidebar/palette/shortcuts), ui kit
│       ├── pages/            # 14 pages (dashboard…about)
│       ├── store/            # zustand: settings/notes/projects/tasks/downloads,
│       │                     #   debounced persist + flush-on-hide/close
│       ├── lib/              # api (IPC wrapper), utils, markdown (escaped HTML)
│       ├── i18n/             # ar (RTL-first) + en, persisted language
│       └── styles/           # Tailwind + CSS-var design system (surface/accent)
├── build/                    # icon.ico / icon.png (installer, tray, splash)
└── release/<ver>/            # electron-builder output (nsis + portable, win x64)
```

## Data flow
Renderer (sandboxed, no Node) → `window.dh.invoke(channel, …)` → preload →
`ipcMain.handle` in `ipc.ts` → service in `electron/main/services/*` →
result envelope back. Progress/events flow main→renderer via whitelisted
channels (`job:progress`, `downloads:update`, `vault:locked`, `window:state`).

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
