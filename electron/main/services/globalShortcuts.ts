import { globalShortcut, type BrowserWindow } from 'electron'
import { settingsStore } from './settings'

/**
 * System-wide hotkeys. Registered only when the user enables them in Settings.
 * They let DragonHub be shown/focused and the command palette opened from
 * anywhere on the desktop. A key already taken by another app is silently
 * skipped (never throws). `refresh()` is idempotent — call it after the
 * setting changes and on startup.
 */
const KEYS = { toggleWindow: 'CommandOrControl+Shift+D', openPalette: 'CommandOrControl+Shift+Space' } as const

let getWin: (() => BrowserWindow | null) | null = null

export function initGlobalShortcuts(winProvider: () => BrowserWindow | null) {
  getWin = winProvider
}

function unregister() {
  try { globalShortcut.unregister(KEYS.toggleWindow) } catch { /* ignore */ }
  try { globalShortcut.unregister(KEYS.openPalette) } catch { /* ignore */ }
}

export function refreshGlobalShortcuts() {
  unregister()
  if (!settingsStore.get().globalShortcutsEnabled || !getWin) return
  // Show/hide toggle: visible → hide to tray; hidden/minimised → show + focus.
  try {
    globalShortcut.register(KEYS.toggleWindow, () => {
      const win = getWin?.()
      if (!win || win.isDestroyed()) return
      if (win.isVisible() && !win.isMinimized()) win.hide()
      else { win.show(); win.focus() }
    })
  } catch { /* key taken by another app — skip */ }
  // Show + open command palette (ask the renderer to reveal it).
  try {
    globalShortcut.register(KEYS.openPalette, () => {
      const win = getWin?.()
      if (!win || win.isDestroyed()) return
      win.show(); win.focus()
      win.webContents.send('dh:openPalette')
    })
  } catch { /* key taken by another app — skip */ }
}

export function stopGlobalShortcuts() {
  unregister()
}
