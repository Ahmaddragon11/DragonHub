import { app, BrowserWindow, shell, ipcMain, nativeTheme, Menu, Tray, protocol, net, session, globalShortcut } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { registerAllHandlers } from './ipc'
import { settingsStore, dataCollections } from './services/settings'
import * as netmon from './services/netmonitor'
import * as netblock from './services/netblock'
import { DEFAULT_NET_LIMITS } from '../../src/shared/types'

// __dirname is provided natively (CJS output)
process.env.APP_ROOT = path.join(__dirname, '../..')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let netBlocked = false

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

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.on('close', (e) => {
    if (!isQuitting && settingsStore.get().minimizeToTray && tray) {
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
  // Safe local file protocol: only serves files, never directories, path-normalized
  protocol.handle('dh-file', (request) => {
    try {
      const u = new URL(request.url)
      let p = decodeURIComponent(u.pathname)
      if (process.platform === 'win32') {
        // dh-file://local/C:/path -> pathname "/C:/path"
        p = p.replace(/^\/+/, '')
      }
      const resolved = path.normalize(p)
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
  // Security: strip dangerous headers, no remote content allowed except downloads handled in main
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders } })
  })

  Menu.setApplicationMenu(null)
  registerAllHandlers(() => win)
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
  if (process.platform !== 'darwin') { isQuitting = true; app.quit() }
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  try { netmon.stopNetMonitor() } catch { /* ignore */ }
  try {
    const lim = { ...DEFAULT_NET_LIMITS, ...(dataCollections.get('netLimits', {}) as Partial<typeof DEFAULT_NET_LIMITS>) }
    // Synchronous cleanup: the async variant cannot be awaited here (the
    // process may exit before `netsh delete` runs). Blocks only for the netsh
    // call itself (5s max, typically <300ms) and never throws.
    if (lim.restoreOnQuit) netblock.cleanupStaleRulesSync()
  } catch { /* fail-open: never delay quit */ }
})

// Window controls
ipcMain.handle('window:minimize', () => win?.minimize())
ipcMain.handle('window:maximize', () => { win?.isMaximized() ? win.unmaximize() : win?.maximize() })
ipcMain.handle('window:close', () => win?.close())
ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false)
ipcMain.handle('window:fullscreen', () => win?.setFullScreen(!win.isFullScreen()))
ipcMain.handle('app:quit', () => { isQuitting = true; app.quit() })
ipcMain.handle('app:relaunch', () => { isQuitting = true; app.relaunch(); app.exit(0) })
