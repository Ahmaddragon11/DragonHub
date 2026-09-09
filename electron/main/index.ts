import { app, BrowserWindow, shell, ipcMain, nativeTheme, Menu, Tray, protocol, net, session, globalShortcut } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { registerAllHandlers } from './ipc'
import { settingsStore, dataCollections } from './services/settings'
import * as netmon from './services/netmonitor'
import * as netblock from './services/netblock'
import * as resmon from './services/resmonitor'
import { DEFAULT_NET_LIMITS } from '../../src/shared/types'

// __dirname is provided natively (CJS output)
process.env.APP_ROOT = path.join(__dirname, '../..')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')

let win: BrowserWindow | null = null
let cardWin: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let netBlocked = false

// ---------- floating monitor card (rescard) ----------
// Same renderer bundle, opened as `index.html?card=1` so no second Vite
// entry is needed. The card renders <ResCard/> instead of <App/> (see
// src/renderer/main.tsx). It shares the main preload whitelist for v1;
// a dedicated minimal preload is deferred hardening (see plan note).
function cardUrlSuffix(): string {
  return VITE_DEV_SERVER_URL ? `${VITE_DEV_SERVER_URL}?card=1` : ''
}

function createCardWindow(): BrowserWindow | null {
  if (cardWin && !cardWin.isDestroyed()) { cardWin.show(); cardWin.focus(); return cardWin }
  try {
    const cfg = resmon.getResCardConfig()
    const w = cfg.size === 'small' ? 288 : 348
    const h = cfg.size === 'small' ? 168 : 224
    cardWin = new BrowserWindow({
      width: w,
      height: h,
      minWidth: 260,
      minHeight: 150,
      maxWidth: 420,
      maxHeight: 300,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      icon: path.join(process.env.APP_ROOT!, 'build', 'icon.ico'),
      webPreferences: {
        preload: path.join(MAIN_DIST, 'preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: !app.isPackaged,
      },
    })
    if (cfg.x !== null && cfg.y !== null) {
      try { cardWin.setPosition(Math.round(cfg.x), Math.round(cfg.y)) } catch { /* off-screen positions ignored */ }
    }
    try { cardWin.setOpacity(Math.min(1, Math.max(0.4, cfg.opacity ?? 0.95))) } catch { /* opacity optional */ }
    cardWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    cardWin.setAlwaysOnTop(true, 'screen-saver')
    if (VITE_DEV_SERVER_URL) cardWin.loadURL(cardUrlSuffix())
    else cardWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { card: '1' } })
    cardWin.once('ready-to-show', () => cardWin?.show())
    cardWin.on('closed', () => { cardWin = null })
    // Persist manual moves (renderer also saves on drag end; this is a backup).
    try {
      let saveT: ReturnType<typeof setTimeout> | null = null
      cardWin.on('moved', () => {
        if (saveT) clearTimeout(saveT)
        saveT = setTimeout(() => {
          try {
            const [x, y] = cardWin?.getPosition() ?? [null, null]
            if (typeof x === 'number' && typeof y === 'number') resmon.setResCardConfig({ x, y })
          } catch { /* ignore */ }
        }, 800)
      })
    } catch { /* ignore */ }
    return cardWin
  } catch { return null }
}

const cardControls = {
  show: () => { createCardWindow() },
  hide: () => { try { cardWin?.close() } catch { cardWin = null } },
  toggle: () => {
    if (cardWin && !cardWin.isDestroyed() && cardWin.isVisible()) { try { cardWin.close() } catch { cardWin = null } return false }
    createCardWindow()
    return true
  },
  isOpen: () => !!cardWin && !cardWin.isDestroyed() && cardWin.isVisible(),
}

// Security: single instance — quit early and skip all further setup if not the first instance.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}
if (process.platform === 'win32') app.setAppUserModelId('com.ahmaddragon.dragonhub')

// Custom safe file protocol for previewing local images/videos in renderer
protocol.registerSchemesAsPrivileged([
  { scheme: 'dh-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
])

function applyHardwareAcceleration() {
  const s = settingsStore.get()
  if (!s.hardwareAcceleration) app.disableHardwareAcceleration()
}
applyHardwareAcceleration()

function createWindow() {
  const s = settingsStore.get()
  win = new BrowserWindow({
    title: 'DragonHub',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: s.theme === 'light' ? '#f5f6fa' : '#0b0d14',
    icon: path.join(process.env.APP_ROOT!, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(MAIN_DIST, 'preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      devTools: !app.isPackaged,
    },
  })

  win.once('ready-to-show', () => win?.show())

  // Security: block navigation & new windows, open external links via shell only if http(s)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  // Sub-frame navigations/redirects must never leave the app bundle either.
  // (will-frame-navigate is attached loosely: older @types/electron lack the overload.)
  ;(win.webContents as unknown as { on: (ev: string, cb: (e: Electron.Event, url: string) => void) => void }).on('will-frame-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  win.webContents.on('will-redirect', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.on('close', (e) => {
    // Floating card keeps living in the same process: hiding the main window
    // to tray (existing minimizeToTray pattern) leaves res:update flowing to it.
    if (!isQuitting && (settingsStore.get().minimizeToTray || cardControls.isOpen()) && tray) {
      e.preventDefault()
      win?.hide()
    }
  })

  win.on('maximize', () => win?.webContents.send('window:state', { maximized: true }))
  win.on('unmaximize', () => win?.webContents.send('window:state', { maximized: false }))
  win.on('enter-full-screen', () => win?.webContents.send('window:state', { fullscreen: true }))
  win.on('leave-full-screen', () => win?.webContents.send('window:state', { fullscreen: false }))
}

function createTray() {
  try {
    const iconPath = path.join(process.env.APP_ROOT!, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
    if (!fs.existsSync(iconPath)) return
    tray = new Tray(iconPath)
    tray.setToolTip('DragonHub — by AHMADDRAGON')
    const menu = Menu.buildFromTemplate([
      { label: 'Show DragonHub', click: () => { win?.show(); win?.focus() } },
      { label: 'Show/Hide monitor card', click: () => { cardControls.toggle() } },
      { type: 'separator' },
      { label: 'Telegram: @ahmaddragon', click: () => shell.openExternal('https://t.me/ahmaddragon') },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
    ])
    tray.setContextMenu(menu)
    tray.on('double-click', () => { win?.show(); win?.focus() })
  } catch { /* tray optional */ }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  // Never allow webviews / extra windows from any contents (defense in depth:
  // privileged IPC in ipc.ts only accepts the single app window as sender).
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
  // Safe local file protocol: only serves files, never directories, path-normalized.
  // Sensitive app-state files are never served (vault / settings / data store).
  const SENSITIVE_FILES = new Set(['vault.bin', 'dragonhub-data.json', 'dragonhub-settings.json'])
  protocol.handle('dh-file', (request) => {
    try {
      const u = new URL(request.url)
      if (u.hostname !== 'local') return new Response('Bad request', { status: 400 })
      let p = decodeURIComponent(u.pathname)
      if (process.platform === 'win32') {
        // dh-file://local/C:/path -> pathname "/C:/path"
        p = p.replace(/^\/+/, '')
      }
      const resolved = path.normalize(p)
      const userData = path.normalize(app.getPath('userData'))
      const inUserData = process.platform === 'win32'
        ? resolved.toLowerCase().startsWith(userData.toLowerCase() + path.sep)
        : resolved.startsWith(userData + path.sep)
      if (inUserData || SENSITIVE_FILES.has(path.basename(resolved).toLowerCase())) {
        return new Response('Forbidden', { status: 403 })
      }
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(resolved).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })

  // Security: deny all permission requests except desktop notifications
  // (used for task reminders). Camera, mic, geolocation, etc. stay blocked.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications'))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'notifications')
  // Explicit device-permission deny (HID/USB/Serial/Bluetooth): default-deny today,
  // pinned explicitly so a future Electron default change can't open it.
  try {
    (session.defaultSession as any).setDevicePermissionHandler(() => false)
  } catch { /* older Electron: default deny already applies */ }
  // Local file:// app: no remote headers to harden; pass through untouched.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders } })
  })

  Menu.setApplicationMenu(null)
  registerAllHandlers(() => win, cardControls, () => cardWin)
  try {
    resmon.setNetSpeedsProvider(() => {
      try {
        const s = netmon.getLiveState()
        return { downBps: s.downSpeedBps, upBps: s.upSpeedBps }
      } catch { return { downBps: 0, upBps: 0 } }
    })
  } catch { /* net speeds optional for res snapshot */ }
  try { resmon.setResWindowProviders(() => win, () => cardWin) } catch { /* ignore */ }
  netblock.cleanupStaleRules().catch(() => {})
  netmon.setBlockedFlagProvider(() => netBlocked)
  netmon.setNetHooks({
    onCapExceeded: () => {
      try {
        const lim = { ...DEFAULT_NET_LIMITS, ...(dataCollections.get('netLimits', {}) as Partial<typeof DEFAULT_NET_LIMITS>) }
        if (!lim.blockOnCap) return
        netblock.setBlocked(true).then((r) => {
          netBlocked = r.blocked
          netmon.setLastNeedsAdmin(r.needsAdmin)
          // Failed or refused: clear the latch so the UI stays honest and the
          // next tick retries instead of showing blocked with open firewall.
          if (!r.blocked) netmon.clearCapBlock()
        }).catch(() => { netmon.clearCapBlock() })
      } catch { /* fail-open */ }
    },
    onNewDay: (_date: string, wasCapBlocked: boolean) => {
      try {
        const lim = { ...DEFAULT_NET_LIMITS, ...(dataCollections.get('netLimits', {}) as Partial<typeof DEFAULT_NET_LIMITS>) }
        if (wasCapBlocked && lim.restoreAtMidnight) {
          netblock.setBlocked(false).then((r) => { netBlocked = r.blocked; netmon.setManualBlocked(false) }).catch(() => {})
        }
      } catch { /* fail-open */ }
      try { win?.webContents.send('net:update', netmon.getLiveState()) } catch { /* ignore */ }
    },
  })
  netmon.startNetMonitor(() => win)
  try { resmon.startResMonitor(() => win, () => cardWin) } catch { /* resources optional */ }
  createWindow()
  createTray()

  nativeTheme.on('updated', () => {
    win?.webContents.send('theme:system', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Floating card lives in the same process: keep the app alive while it is
  // open so monitoring continues after the main window is hidden/closed.
  try { if (cardWin && !cardWin.isDestroyed() && cardWin.isVisible()) return } catch { /* fall through to quit */ }
  if (process.platform !== 'darwin') { isQuitting = true; app.quit() }
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  try { netmon.stopNetMonitor() } catch { /* ignore */ }
  try { resmon.stopResMonitor() } catch { /* ignore */ }
  try {
    const lim = { ...DEFAULT_NET_LIMITS, ...(dataCollections.get('netLimits', {}) as Partial<typeof DEFAULT_NET_LIMITS>) }
    // Synchronous cleanup: the async variant cannot be awaited here (the
    // process may exit before `netsh delete` runs). Blocks only for the netsh
    // call itself (5s max, typically <300ms) and never throws.
    if (lim.restoreOnQuit) netblock.cleanupStaleRulesSync()
  } catch { /* fail-open: never delay quit */ }
})

// Window controls: same sender rule as privileged IPC (main + card windows).
function winOnly(fn: (e: Electron.IpcMainInvokeEvent) => unknown) {
  return (e: Electron.IpcMainInvokeEvent) => {
    const fromMain = (() => { try { return !!win && !win.isDestroyed() && e.sender === win.webContents } catch { return false } })()
    const fromCard = (() => { try { return !!cardWin && !cardWin.isDestroyed() && e.sender === cardWin.webContents } catch { return false } })()
    if ((win || cardWin) && !fromMain && !fromCard) throw new Error('Blocked: bad sender')
    return fn(e)
  }
}
ipcMain.handle('window:minimize', winOnly(() => win?.minimize()))
ipcMain.handle('window:maximize', winOnly(() => { win?.isMaximized() ? win.unmaximize() : win?.maximize() }))
ipcMain.handle('window:show', winOnly(() => { win?.show(); win?.focus() }))
ipcMain.handle('window:close', winOnly(() => win?.close()))
ipcMain.handle('window:isMaximized', winOnly(() => win?.isMaximized() ?? false))
ipcMain.handle('window:fullscreen', winOnly(() => win?.setFullScreen(!win.isFullScreen())))
ipcMain.handle('app:quit', winOnly(() => { isQuitting = true; app.quit() }))
ipcMain.handle('app:relaunch', winOnly(() => { isQuitting = true; app.relaunch(); app.exit(0) }))
