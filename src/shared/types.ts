// Shared type contracts between main process and renderer

export const APP_VERSION = '1.3.0'
export const DEVELOPER = 'AHMADDRAGON'
export const TELEGRAM_URL = 'https://t.me/ahmaddragon'

export type Theme = 'dark' | 'light' | 'system'
export type Language = 'ar' | 'en'
export type AccentColor = 'violet' | 'blue' | 'emerald' | 'rose' | 'amber' | 'cyan' | 'orange'

export interface AppSettings {
  theme: Theme
  language: Language
  accent: AccentColor
  animations: 'full' | 'reduced' | 'off'
  animationSpeed: number // 0.5 - 2
  fontScale: number // 0.85 - 1.3
  compactMode: boolean
  glassEffect: boolean
  sidebarCollapsed: boolean
  startPage: string
  downloadDir: string
  maxParallelDownloads: number
  downloadSegments: number
  autoSaveIntervalSec: number
  vaultAutoLockMin: number
  vaultClearClipboardSec: number
  confirmDelete: boolean
  useRecycleBin: boolean
  showHiddenFiles: boolean
  editorFontSize: number
  editorWordWrap: boolean
  editorMinimap: boolean
  editorTabSize: number
  hardwareAcceleration: boolean
  minimizeToTray: boolean
  launchAtStartup: boolean
  checkUpdates: boolean
  telemetry: false
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'ar',
  accent: 'violet',
  animations: 'full',
  animationSpeed: 1,
  fontScale: 1,
  compactMode: false,
  glassEffect: true,
  sidebarCollapsed: false,
  startPage: 'dashboard',
  downloadDir: '',
  maxParallelDownloads: 3,
  downloadSegments: 8,
  autoSaveIntervalSec: 5,
  vaultAutoLockMin: 5,
  vaultClearClipboardSec: 20,
  confirmDelete: true,
  useRecycleBin: true,
  showHiddenFiles: false,
  editorFontSize: 14,
  editorWordWrap: true,
  editorMinimap: true,
  editorTabSize: 2,
  hardwareAcceleration: true,
  minimizeToTray: true,
  launchAtStartup: false,
  checkUpdates: true,
  telemetry: false,
}

// ---------- Notes ----------
export interface Note {
  id: string
  title: string
  content: string // markdown
  tags: string[]
  color: string
  pinned: boolean
  archived: boolean
  favorite: boolean
  createdAt: number
  updatedAt: number
}

// ---------- Projects / Ideas ----------
export type ProjectStatus = 'idea' | 'planning' | 'active' | 'paused' | 'done' | 'archived'
export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  priority: 1 | 2 | 3 | 4 | 5
  tags: string[]
  color: string
  links: { label: string; url: string }[]
  milestones: { id: string; title: string; done: boolean; dueDate?: number }[]
  notes: string
  progress: number
  createdAt: number
  updatedAt: number
  dueDate?: number
}

// ---------- Tasks ----------
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  tags: string[]
  projectId?: string
  dueDate?: number
  reminderAt?: number
  subtasks: { id: string; title: string; done: boolean }[]
  recurring?: 'daily' | 'weekly' | 'monthly'
  createdAt: number
  updatedAt: number
  completedAt?: number
  order: number
}

// ---------- Files ----------
export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  isHidden: boolean
  size: number
  modified: number
  created: number
  ext: string
}

export interface DriveInfo {
  path: string
  label: string
  total?: number
  free?: number
}

// ---------- Downloads ----------
export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
export interface DownloadItem {
  id: string
  url: string
  filename: string
  savePath: string
  size: number
  received: number
  speed: number // bytes/s
  eta: number // seconds
  status: DownloadStatus
  error?: string
  segments: number
  supportsRange: boolean
  createdAt: number
  completedAt?: number
  kind: 'direct' | 'media'
}

// ---------- Vault ----------
export type VaultItemType = 'password' | 'token' | 'api_key' | 'note' | 'card' | 'ssh'
export interface VaultItem {
  id: string
  type: VaultItemType
  title: string
  username?: string
  secret: string
  url?: string
  notes?: string
  tags: string[]
  fields: { label: string; value: string; hidden: boolean }[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

export interface VaultMeta {
  initialized: boolean
  kdf: 'pbkdf2'
  iterations: number
  saltB64: string
  verifierB64: string
  ivB64: string
  updatedAt: number
}

// ---------- Compression ----------
export type ArchiveFormat = 'zip' | '7z' | 'tar' | 'gzip' | 'bzip2' | 'xz'
export interface CompressOptions {
  format: ArchiveFormat
  level: 0 | 1 | 3 | 5 | 7 | 9
  password?: string
  solid?: boolean
  splitSizeMB?: number
  deleteAfter?: boolean
}
export interface ArchiveEntry {
  name: string
  size: number
  packed: number
  modified?: string
  isDirectory: boolean
}

// ---------- Media ----------
export interface MediaInfo {
  format: string
  duration: number
  size: number
  bitrate: number
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  audioChannels?: number
  sampleRate?: number
}

export interface ImageOp {
  input: string
  output: string
  resize?: { width?: number; height?: number; fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' }
  rotate?: number
  flip?: boolean
  flop?: boolean
  grayscale?: boolean
  blur?: number
  sharpen?: boolean
  brightness?: number
  saturation?: number
  hue?: number
  format?: 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff'
  quality?: number
  crop?: { left: number; top: number; width: number; height: number }
  watermarkText?: string
  removeMetadata?: boolean
}

export interface VideoOp {
  input: string
  output: string
  trim?: { start: number; end: number }
  resize?: { width?: number; height?: number }
  format?: 'mp4' | 'mkv' | 'webm' | 'avi' | 'mov' | 'gif' | 'mp3' | 'aac' | 'wav' | 'flac' | 'ogg'
  videoCodec?: 'libx264' | 'libx265' | 'libvpx-vp9' | 'copy'
  audioCodec?: 'aac' | 'libmp3lame' | 'libopus' | 'copy' | 'none'
  crf?: number
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow'
  fps?: number
  speed?: number
  volume?: number
  rotate?: 0 | 90 | 180 | 270
  mute?: boolean
  extractAudio?: boolean
  thumbnailAt?: number
  bitrateK?: number
}

export interface JobProgress {
  id: string
  percent: number
  message?: string
  done: boolean
  error?: string
  output?: string
}

// ---------- Versioning ----------
export interface VersionInfo {
  version: string
  build: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  releaseDate: string
  channel: 'stable' | 'beta'
}

export interface ChangelogEntry {
  version: string
  date: string
  changes: { type: 'added' | 'changed' | 'fixed' | 'security'; text: string }[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.0',
    date: '2026-09-05',
    changes: [
      { type: 'added', text: 'Network usage monitor page with live down/up speeds, today totals and block status' },
      { type: 'added', text: 'Passive system-wide byte counters (OS interface totals only, no packet inspection)' },
      { type: 'added', text: 'Data plans with daily / weekly / monthly / custom cycles and auto-computed daily allowance' },
      { type: 'added', text: 'Daily cap with automatic internet block when the cap is exceeded' },
      { type: 'added', text: 'Midnight auto-restore of cap-blocked connections plus restore-on-quit option' },
      { type: 'added', text: 'Weekly usage table (14-day view, newest first; up to 90 days retained)' },
      { type: 'security', text: 'Firewall kill-switch never elevates by itself; without admin rights it reports needsAdmin, fails open, repairs partial rules, and cleans stale rules on startup' },
      { type: 'fixed', text: 'Day rollover resets today counters without losing recorded history' },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-09-05',
    changes: [
      { type: 'security', text: 'Archive extraction now pre-scans entries: blocks path traversal, absolute paths, and zip bombs (200k entries / 50 GiB caps); extracts auto-rename instead of silently overwriting' },
      { type: 'security', text: 'Vault change-password is crash-safe (data written before meta, with .bak backups) and wipes the old key; backup import validates size, schema and minimum KDF iterations' },
      { type: 'security', text: 'Download URL validation blocks loopback/private-network literals (SSRF guard); media/archive numeric inputs are clamped and codec/format/preset values allow-listed' },
      { type: 'security', text: 'Settings patches are validated and clamped; renderer data collections restricted to known keys with size caps and proto-pollution guards' },
      { type: 'security', text: 'File search/folder-size no longer follow symlinks (cycle safe); copy/move reject same-path; atomic writes use unique temp files; drives use PowerShell (wmic is deprecated on Windows 11)' },
      { type: 'security', text: 'Desktop notifications are now the only allowed permission (task reminders work); single-instance guard skips setup in the second process' },
      { type: 'fixed', text: 'File manager no longer opens huge text files in the editor (falls back to system app over 20MB); unknown binaries never routed to the editor' },
      { type: 'fixed', text: 'File manager favorites now save the actually-shown folder instead of the pane root' },
      { type: 'fixed', text: 'Recurring tasks now complete the current occurrence and spawn the next one — history is preserved' },
      { type: 'fixed', text: 'Notes no longer create duplicates from navigation params (StrictMode-safe); Markdown export includes title/tags frontmatter' },
      { type: 'fixed', text: 'Editor restores the previous tab session (paths re-read from disk, small untitled buffers kept); untitled names can no longer collide; theme follows the app setting' },
      { type: 'fixed', text: 'Notes/tasks/edits persist on tab hide and app close (debounced writes are flushed instead of lost)' },
      { type: 'fixed', text: 'Global shortcuts no longer fire while typing in inputs or the code editor' },
      { type: 'added', text: 'Command palette quick actions: new note / task / project / download, open vault' },
      { type: 'added', text: 'Vault edit form masks secrets with show/hide, generator fills the open form, password fields cleared on lock/close' },
      { type: 'added', text: 'Sidebar theme button cycles dark → light → system; kanban scrolls horizontally on narrow screens' },
      { type: 'added', text: 'Honest About screen: updates point to the Telegram channel with a no-auto-updater note; Settings privacy toggle is a real (permanently off) indicator' },
      { type: 'added', text: 'Accessibility: visible focus rings, switch roles on toggles, prefers-reduced-motion support, compact mode covers inputs' },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-09-03',
    changes: [
      { type: 'fixed', text: 'Fixed startup crash: electron-store downgraded to v8 (CJS-compatible with Electron main process)' },
      { type: 'fixed', text: 'Replaced trash package with built-in shell.trashItem (native Recycle Bin support, no dependency)' },
      { type: 'fixed', text: 'Explicitly declared monaco-editor dependency for editor build reliability' },
      { type: 'fixed', text: 'Fixed invalid Tailwind classes (surface-2/3, surface-0, fg) breaking UI styling' },
      { type: 'fixed', text: 'Media thumbnails now served as data URLs (CSP-compliant, no remote image blocking)' },
      { type: 'added', text: 'App icon (build/icon.ico) included — ready for installer build' },
      { type: 'added', text: 'Missing auto-save interval translation keys (EN/AR)' },
      { type: 'added', text: 'Editor auto-save for opened files (uses auto-save interval setting)' },
      { type: 'added', text: 'Task reminders with desktop notifications + toast alerts' },
      { type: 'fixed', text: 'Media downloads can no longer be resumed as direct files (blocked with clear error)' },
      { type: 'fixed', text: 'Removed unused adm-zip dependency and dead check-for-updates toggle' },
      { type: 'fixed', text: 'App no longer hangs on splash if data loading fails (safe defaults + error toast)' },
      { type: 'fixed', text: 'Corrected Ctrl+9 shortcut documentation (Images, not Vault)' },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-02',
    changes: [
      { type: 'added', text: 'Initial release of DragonHub' },
      { type: 'added', text: 'Notes with markdown, tags, pin, archive and search' },
      { type: 'added', text: 'Projects & ideas board with milestones and progress' },
      { type: 'added', text: 'Tasks with Kanban, priorities, subtasks and due dates' },
      { type: 'added', text: 'Full file manager with dual pane, previews and operations' },
      { type: 'added', text: 'Monaco-based code/text editor with 50+ languages' },
      { type: 'added', text: 'Multi-segment download manager + media downloader (yt-dlp)' },
      { type: 'added', text: 'Compression center: ZIP / 7z / TAR / GZIP / XZ with encryption' },
      { type: 'added', text: 'Image studio powered by sharp (resize, convert, filters, watermark)' },
      { type: 'added', text: 'Video & audio studio powered by FFmpeg (trim, convert, compress, extract)' },
      { type: 'added', text: 'Encrypted vault (AES-256-GCM, PBKDF2 600k) for passwords, tokens & API keys' },
      { type: 'added', text: 'Dark / Light themes, 7 accent colors, Arabic (RTL) & English' },
      { type: 'added', text: 'Command palette and 100+ keyboard shortcuts reference' },
      { type: 'security', text: 'Context isolation, sandboxed renderer, strict CSP, path validation' },
    ],
  },
]

// ---------- Network usage monitor ----------
export type NetCycle = 'daily' | 'weekly' | 'monthly' | 'custom'

export interface NetPlan {
  id: string
  name: string
  quotaMB: number
  cycle: NetCycle
  cycleDays: number
  startDate: string
  active: boolean
}

export interface NetLimits {
  dailyCapMB: number | null
  blockOnCap: boolean
  restoreAtMidnight: boolean
  restoreOnQuit: boolean
  monitoringEnabled: boolean
}

export interface NetDay {
  date: string
  downMB: number
  upMB: number
}

export interface NetLive {
  downSpeedBps: number
  upSpeedBps: number
  todayDownMB: number
  todayUpMB: number
  blocked: boolean
  needsAdmin: boolean
  date: string
}

export interface NetConfig {
  plan: NetPlan | null
  limits: NetLimits
}

export const DEFAULT_NET_LIMITS: NetLimits = {
  dailyCapMB: null,
  blockOnCap: false,
  restoreAtMidnight: true,
  restoreOnQuit: true,
  monitoringEnabled: true,
}
