import Store from 'electron-store'
import { app } from 'electron'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../src/shared/types'

const store = new Store<{ settings: AppSettings }>({
  name: 'dragonhub-settings',
  defaults: { settings: { ...DEFAULT_SETTINGS } },
  clearInvalidConfig: true,
})

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const THEMES = new Set(['dark', 'light', 'system'])
const LANGS = new Set(['ar', 'en'])
const ACCENTS = new Set(['violet', 'blue', 'emerald', 'rose', 'amber', 'cyan', 'orange'])
const ANIMS = new Set(['full', 'reduced', 'off'])

/** Validate + clamp a settings patch so corrupt/foreign values can never persist. */
function sanitizePatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  const d = DEFAULT_SETTINGS
  if (patch.theme !== undefined && THEMES.has(patch.theme)) out.theme = patch.theme
  if (patch.language !== undefined && LANGS.has(patch.language)) out.language = patch.language
  if (patch.accent !== undefined && ACCENTS.has(patch.accent)) out.accent = patch.accent
  if (patch.animations !== undefined && ANIMS.has(patch.animations)) out.animations = patch.animations
  if (patch.animationSpeed !== undefined) out.animationSpeed = clamp(patch.animationSpeed, 0.5, 2, d.animationSpeed)
  if (patch.fontScale !== undefined) out.fontScale = clamp(patch.fontScale, 0.8, 1.4, d.fontScale)
  if (patch.compactMode !== undefined) out.compactMode = !!patch.compactMode
  if (patch.glassEffect !== undefined) out.glassEffect = !!patch.glassEffect
  if (patch.sidebarCollapsed !== undefined) out.sidebarCollapsed = !!patch.sidebarCollapsed
  if (patch.startPage !== undefined && typeof patch.startPage === 'string') out.startPage = patch.startPage.slice(0, 32)
  if (patch.downloadDir !== undefined && typeof patch.downloadDir === 'string') out.downloadDir = patch.downloadDir.slice(0, 1024)
  if (patch.maxParallelDownloads !== undefined) out.maxParallelDownloads = Math.round(clamp(patch.maxParallelDownloads, 1, 10, d.maxParallelDownloads))
  if (patch.downloadSegments !== undefined) out.downloadSegments = Math.round(clamp(patch.downloadSegments, 1, 32, d.downloadSegments))
  if (patch.autoSaveIntervalSec !== undefined) out.autoSaveIntervalSec = Math.round(clamp(patch.autoSaveIntervalSec, 0, 600, d.autoSaveIntervalSec))
  if (patch.vaultAutoLockMin !== undefined) out.vaultAutoLockMin = Math.round(clamp(patch.vaultAutoLockMin, 0, 1440, d.vaultAutoLockMin))
  if (patch.vaultClearClipboardSec !== undefined) out.vaultClearClipboardSec = Math.round(clamp(patch.vaultClearClipboardSec, 5, 600, d.vaultClearClipboardSec))
  if (patch.confirmDelete !== undefined) out.confirmDelete = !!patch.confirmDelete
  if (patch.useRecycleBin !== undefined) out.useRecycleBin = !!patch.useRecycleBin
  if (patch.showHiddenFiles !== undefined) out.showHiddenFiles = !!patch.showHiddenFiles
  if (patch.editorFontSize !== undefined) out.editorFontSize = Math.round(clamp(patch.editorFontSize, 10, 28, d.editorFontSize))
  if (patch.editorWordWrap !== undefined) out.editorWordWrap = !!patch.editorWordWrap
  if (patch.editorMinimap !== undefined) out.editorMinimap = !!patch.editorMinimap
  if (patch.editorTabSize !== undefined && [2, 4, 8].includes(Number(patch.editorTabSize))) out.editorTabSize = Number(patch.editorTabSize) as 2 | 4 | 8
  if (patch.hardwareAcceleration !== undefined) out.hardwareAcceleration = !!patch.hardwareAcceleration
  if (patch.minimizeToTray !== undefined) out.minimizeToTray = !!patch.minimizeToTray
  if (patch.launchAtStartup !== undefined) out.launchAtStartup = !!patch.launchAtStartup
  if (patch.checkUpdates !== undefined) out.checkUpdates = !!patch.checkUpdates
  // telemetry is hard-off by design: never accepted from any caller.
  return out
}

export const settingsStore = {
  get(): AppSettings {
    const raw = (store.get('settings') ?? {}) as Partial<AppSettings>
    // Re-validate stored values too: protects against hand-edited/corrupt config files.
    const s = { ...DEFAULT_SETTINGS, ...sanitizePatch(raw) }
    if (!s.downloadDir) s.downloadDir = path.join(app.getPath('downloads'), 'DragonHub')
    s.telemetry = false
    return s
  },
  set(patch: Partial<AppSettings>): AppSettings {
    const next = { ...settingsStore.get(), ...sanitizePatch(patch), telemetry: false as const }
    store.set('settings', next)
    return next
  },
  reset(): AppSettings {
    store.set('settings', { ...DEFAULT_SETTINGS })
    return settingsStore.get()
  },
}

// Generic JSON collection store (notes, projects, tasks, downloads history)
// Only these renderer-known keys may be read/written; everything else is rejected
// so a compromised renderer cannot corrupt internal state (e.g. downloads queue).
const ALLOWED_DATA_KEYS = new Set(['notes', 'projects', 'tasks', 'downloads', 'fileFavorites', 'recentLocations', 'activity', 'netState', 'netPlan', 'netLimits'])
const MAX_DATA_BYTES = 50 * 1024 * 1024
const dataStore = new Store<Record<string, unknown>>({ name: 'dragonhub-data' })
export const dataCollections = {
  get<T>(key: string, fallback: T): T {
    if (!ALLOWED_DATA_KEYS.has(key)) return fallback
    return (dataStore.get(key) as T) ?? fallback
  },
  set<T>(key: string, value: T) {
    if (!ALLOWED_DATA_KEYS.has(key)) throw new Error(`Blocked data key: ${key}`)
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Blocked data key')
    const bytes = JSON.stringify(value)?.length ?? 0
    if (bytes > MAX_DATA_BYTES) throw new Error('Data too large (max 50MB)')
    dataStore.set(key, value as never)
  },
  exportAll() {
    return dataStore.store
  },
  importAll(obj: Record<string, unknown>) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid backup file')
    const entries = Object.entries(obj)
    if (entries.length > 64) throw new Error('Invalid backup file')
    for (const [k, v] of entries) {
      if (!ALLOWED_DATA_KEYS.has(k)) continue // skip unknown keys instead of corrupting state
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
      dataStore.set(k, v as never)
    }
  },
  path: dataStore.path,
}
