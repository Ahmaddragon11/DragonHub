import { app, BrowserWindow, shell, ipcMain, nativeTheme, Menu, Tray, protocol, net, session, desktopCapturer, screen, powerMonitor } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { registerAllHandlers, externalUrlBlockReason } from './ipc'
import { settingsStore, dataCollections } from './services/settings'
import { cleanupPendingInstaller } from './services/updater'
import { cleanupVersionInstallers } from './services/versions'
import { stopAllChats } from './services/ai'
import { initGlobalShortcuts, refreshGlobalShortcuts, stopGlobalShortcuts } from './services/globalShortcuts'
import * as netmon from './services/netmonitor'
import * as netblock from './services/netblock'
import * as resmon from './services/resmonitor'
import { DEFAULT_NET_LIMITS, type CaptureAction, type CaptureOverlayCommit, type CaptureOverlayInit, type CaptureResult } from '../../src/shared/types'

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

// ---------- crash resilience ----------
// Electron's default for an uncaught main-process error is an "Error" dialog
// and an undefined app state afterwards. Log to the console + logs/crash.log
// and keep running instead — logging must never throw.
function crashLog(kind: string, detail: unknown): void {
  try { console.error(`[dragonhub] ${kind}:`, detail) } catch { /* ignore */ }
  try {
    const text = detail instanceof Error ? (detail.stack || detail.message) : String(detail)
    const dir = app.getPath('logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'crash.log'), `${new Date().toISOString()} ${kind}: ${text}\n`)
  } catch { /* logging must never throw */ }
}
process.on('uncaughtException', (err) => crashLog('uncaughtException', err))
process.on('unhandledRejection', (reason) => crashLog('unhandledRejection', reason))

// Hardened renderer crash recovery: reload the shell after a renderer crash /
// OOM (never a normal exit), throttled so a crash loop cannot spin forever.
let lastRecoveryReloadAt = 0
function attachCrashRecovery(w: BrowserWindow) {
  w.webContents.on('render-process-gone', (_e, details) => {
    crashLog('renderer-gone', `${details.reason} exit=${details.exitCode}`)
    if (isQuitting) return
    // A dead renderer can never consume the events of an in-flight AI stream.
    try { stopAllChats() } catch { /* ignore */ }
    if (details.reason === 'clean-exit') return
    const now = Date.now()
    if (now - lastRecoveryReloadAt < 30_000) return
    lastRecoveryReloadAt = now
    setTimeout(() => {
      try { if (!w.isDestroyed()) w.webContents.reload() } catch { /* ignore */ }
    }, 800)
  })
  w.on('unresponsive', () => crashLog('unresponsive', 'window stopped responding'))
}
app.on('child-process-gone', (_e, details) => crashLog('child-process-gone', `${details.type} ${details.reason} exit=${details.exitCode}`))

// ---------- floating monitor card (rescard) ----------
// Same renderer bundle, opened as `index.html?card=1` so no second Vite
// entry is needed. The card renders <ResCard/> instead of <App/> (see
// src/renderer/main.tsx). Hardened: preload detects ?card=1 (location.search)
// and exposes a minimal API (res:* + window:minimize/maximize/close/show only);
// card window also carries the same navigation guards as the main window.
function cardUrlSuffix(): string {
  return VITE_DEV_SERVER_URL ? `${VITE_DEV_SERVER_URL}?card=1` : ''
}

// Runtime icon for BrowserWindow/Tray. In dev it lives in <repo>/build,
// in the packaged app electron-builder unpacks it (extraResources) next to
// the asar at <resources>/build/.
function iconFileName(): string {
  return process.platform === 'win32' ? 'icon.ico' : 'icon.png'
}

function runtimeIconPath(): string {
  try {
    if (app.isPackaged) return path.join(process.resourcesPath, 'build', iconFileName())
  } catch { /* fall through to dev path */ }
  return path.join(process.env.APP_ROOT!, 'build', iconFileName())
}

// Demand-driven monitors: the card is the only long-lived consumer that is not
// a rendered page. Every open/close path routes through here, so both services
// reschedule their cheap-idle cadence right away.
function setCardSeenActivity(open: boolean): void {
  // Card-open holds the res monitor at 'basic' (no page needed) and keeps the
  // net tick at normal cadence; closing lets both relax to their idle modes.
  try { resmon.setCardActivity(open) } catch { /* optional */ }
  try { netmon.setNetActivity(open) } catch { /* optional */ }
}

// Window visibility feeds the same demand model: hide/minimize (tray or
// taskbar) drops the res monitor to 'off' and suppresses net broadcasts;
// show/restore bring both back. The card keeps its own demand tracked above.
function setMainSeenHidden(hidden: boolean): void {
  try { resmon.setWindowHidden(hidden) } catch { /* optional */ }
  try { netmon.setWindowHidden(hidden) } catch { /* optional */ }
}

function createCardWindow(): BrowserWindow | null {
  if (cardWin && !cardWin.isDestroyed()) { cardWin.show(); cardWin.focus(); setCardSeenActivity(true); return cardWin }
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
      icon: runtimeIconPath(),
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
    attachCrashRecovery(cardWin)
    // Security: same navigation guards as the main window — no new windows,
    // no navigation away from the app bundle (main + sub-frames + redirects).
    cardWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    cardWin.webContents.on('will-navigate', (e, url) => {
      if (url !== cardWin?.webContents.getURL()) e.preventDefault()
    })
    ;(cardWin.webContents as unknown as { on: (ev: string, cb: (e: Electron.Event, url: string) => void) => void }).on('will-frame-navigate', (e, url) => {
      if (url !== cardWin?.webContents.getURL()) e.preventDefault()
    })
    cardWin.webContents.on('will-redirect', (e, url) => {
      if (url !== cardWin?.webContents.getURL()) e.preventDefault()
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
    cardWin.on('closed', () => { cardWin = null; setCardSeenActivity(false) })
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
    setCardSeenActivity(true)
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
    icon: runtimeIconPath(),
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
  attachCrashRecovery(win)

  // Security: block navigation & new windows, open external links via shell only if http(s)
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Same localhost/metadata blocklist as the app:openExternal channel.
    if (/^https?:\/\//i.test(url) && externalUrlBlockReason(url) === null) {
      void shell.openExternal(url).catch(() => {})
    }
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
  // Demand-driven monitors: hiding/minimizing to tray or taskbar drops the res
  // monitor to 'off' (unless the floating card is open) and suppresses net
  // broadcasts; show/restore bring both back. Context-menu "Minimize" does not
  // emit 'hide', so 'minimize' mirrors it explicitly.
  win.on('hide', () => { try { setMainSeenHidden(true) } catch { /* optional */ } })
  win.on('minimize', () => { try { setMainSeenHidden(true) } catch { /* optional */ } })
  win.on('show', () => { try { setMainSeenHidden(false) } catch { /* optional */ } })
  win.on('restore', () => { try { setMainSeenHidden(false) } catch { /* optional */ } })
}

// ---------- global shortcuts (system-wide hotkeys) ----------
// Logic lives in services/globalShortcuts.ts (refreshable when the setting
// changes). Initialised with the window provider once the window exists.

function createTray() {
  try {
    const iconPath = runtimeIconPath()
    if (!fs.existsSync(iconPath)) return
    tray = new Tray(iconPath)
    tray.setToolTip('DragonHub — by AHMADDRAGON')
    // Reveal the window, then ask the renderer to run a quick action. Reusing
    // the existing navigation-params IPC keeps behavior identical to in-app.
    const focusAnd = (channel: string, ...args: unknown[]) => { win?.show(); win?.focus(); win?.webContents.send(channel, ...args) }
    const menu = Menu.buildFromTemplate([
      { label: 'Show DragonHub', click: () => { win?.show(); win?.focus() } },
      { type: 'separator' },
      { label: 'New note', click: () => focusAnd('dh:trayAction', 'new-note') },
      { label: 'Quick task', click: () => focusAnd('dh:trayAction', 'new-task') },
      { label: 'Focus timer', click: () => focusAnd('dh:trayAction', 'focus') },
      { type: 'separator' },
      { label: 'Settings', click: () => focusAnd('dh:trayAction', 'settings') },
      { label: 'Show/Hide monitor card', click: () => { cardControls.toggle() } },
      { type: 'separator' },
      { label: 'Telegram: @ahmaddragon', click: () => { void shell.openExternal('https://t.me/ahmaddragon').catch(() => {}) } },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
    ])
    tray.setContextMenu(menu)
    tray.on('double-click', () => { win?.show(); win?.focus() })
  } catch { /* tray optional */ }
}

// ---------- Real screen capture (region overlay + display/window stills) ----------
// A genuine snipping-tool flow: hide the app, freeze every display to a
// full-resolution screenshot, show one frameless always-on-top overlay per
// display, let the user draw/adjust a region, then crop the frozen image in
// main. The overlay never receives huge data URLs in its URL — the frozen
// screenshot is handed over via `capture:overlay:init` after it mounts.
interface RegionOverlay {
  win: BrowserWindow
  display: Electron.Display
  image: Electron.NativeImage
  imageSize: { width: number; height: number }
  imageDataUrl: string
}

type RegionOutcome = { dataUrl: string; action?: CaptureAction }

let overlayEntries = new Map<number, RegionOverlay>() // webContents.id -> entry
let regionOverlays: BrowserWindow[] = []
let regionResolve: ((value: RegionOutcome | null) => void) | null = null
let regionSettled = false
let regionTimeout: ReturnType<typeof setTimeout> | null = null
let captureActive = false
let restoreMain = { visible: false, minimized: false, card: false }

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function settleRegion(value: RegionOutcome | null) {
  if (regionSettled) return
  regionSettled = true
  const resolve = regionResolve
  regionResolve = null
  if (resolve) resolve(value)
}

/** Destroys every overlay and always brings the app back (unless quitting). */
function cleanupRegion() {
  if (regionTimeout) { clearTimeout(regionTimeout); regionTimeout = null }
  overlayEntries = new Map()
  for (const o of regionOverlays) {
    try { if (!o.isDestroyed()) o.destroy() } catch { /* ignore */ }
  }
  regionOverlays = []
  if (!isQuitting) {
    try {
      if (restoreMain.visible && win && !win.isDestroyed()) {
        win.show()
        if (restoreMain.minimized) win.minimize()
        else win.focus()
      }
    } catch { /* ignore */ }
    try { if (restoreMain.card && cardWin && !cardWin.isDestroyed()) cardWin.show() } catch { /* ignore */ }
  }
  restoreMain = { visible: false, minimized: false, card: false }
  captureActive = false
  regionSettled = false
  regionResolve = null
}

// Same navigation guards as the main/card windows: no new windows, no leaving
// the app bundle (top-level + sub-frames + redirects).
function guardContents(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e, url) => { if (url !== w.webContents.getURL()) e.preventDefault() })
  ;(w.webContents as unknown as { on: (ev: string, cb: (e: Electron.Event, url: string) => void) => void }).on('will-frame-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) e.preventDefault()
  })
  w.webContents.on('will-redirect', (e, url) => { if (url !== w.webContents.getURL()) e.preventDefault() })
}

function overlayInitPayload(entry: RegionOverlay): CaptureOverlayInit {
  return {
    image: entry.imageDataUrl,
    displayId: String(entry.display.id),
    bounds: { x: entry.display.bounds.x, y: entry.display.bounds.y, width: entry.display.bounds.width, height: entry.display.bounds.height },
    scaleFactor: entry.display.scaleFactor,
    imageSize: { width: entry.imageSize.width, height: entry.imageSize.height },
    lang: settingsStore.get().language,
  }
}

async function buildRegionOverlays(): Promise<void> {
  const displays = screen.getAllDisplays()
  if (!displays.length) { settleRegion(null); return }
  const physical = displays.map((d) => ({ w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) }))
  const thumbnailSize = {
    width: Math.min(8192, Math.max(1, Math.max(...physical.map((p) => p.w)))),
    height: Math.min(8192, Math.max(1, Math.max(...physical.map((p) => p.h)))),
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const byDisplay = new Map<string, Electron.DesktopCapturerSource>()
  for (const s of sources) if (s.display_id) byDisplay.set(String(s.display_id), s)

  displays.forEach((d, i) => {
    const src = byDisplay.get(String(d.id)) ?? (sources.length === displays.length ? sources[i] : undefined)
    if (!src || src.thumbnail.isEmpty()) return
    const entry: RegionOverlay = {
      win: null as unknown as BrowserWindow,
      display: d,
      image: src.thumbnail,
      imageSize: src.thumbnail.getSize(),
      imageDataUrl: src.thumbnail.toDataURL(),
    }
    const ow = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      acceptFirstMouse: true,
      icon: runtimeIconPath(),
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
    entry.win = ow
    guardContents(ow)
    ow.setAlwaysOnTop(true, 'screen-saver')
    ow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    const wcId = ow.webContents.id
    overlayEntries.set(wcId, entry)
    regionOverlays.push(ow)
    ow.on('closed', () => { overlayEntries.delete(wcId) })
    // A crashed overlay must not strand the app hidden.
    ow.webContents.on('render-process-gone', () => settleRegion(null))
    const load = VITE_DEV_SERVER_URL
      ? ow.loadURL(`${VITE_DEV_SERVER_URL}?overlay=1`)
      : ow.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { overlay: '1' } })
    void load.then(() => {
      if (ow.isDestroyed()) return
      ow.show()
      ow.focus()
    }).catch(() => { /* destroyed while loading */ })
  })
}

async function startRegionCapture(): Promise<CaptureResult | null> {
  if (captureActive) throw new Error('A capture is already in progress')
  if (!win || win.isDestroyed()) throw new Error('No window to capture from')
  captureActive = true
  regionSettled = false
  restoreMain = {
    visible: win.isVisible(),
    minimized: win.isMinimized(),
    card: !!cardWin && !cardWin.isDestroyed() && cardWin.isVisible(),
  }
  const result = new Promise<RegionOutcome | null>((resolve) => { regionResolve = resolve })
  // Hard safety net: a closed/crashed overlay can never keep the app hidden.
  regionTimeout = setTimeout(() => settleRegion(null), 120_000)
  try {
    try { win.hide() } catch { /* ignore */ }
    try { if (restoreMain.card) cardWin?.hide() } catch { /* ignore */ }
    await delay(250)
    await buildRegionOverlays()
    if (!regionOverlays.length) settleRegion(null)
    const outcome = await result
    return outcome ? { dataUrl: outcome.dataUrl, source: 'region', action: outcome.action } : null
  } finally {
    cleanupRegion()
  }
}

function cropCommit(entry: RegionOverlay, payload: CaptureOverlayCommit | undefined): string | null {
  // Annotated captures arrive pre-composited by the overlay canvas.
  if (payload && typeof payload.dataUrl === 'string') {
    if (payload.dataUrl.length > 120 * 1024 * 1024) return null
    return /^data:image\/png;base64,/.test(payload.dataUrl) ? payload.dataUrl : null
  }
  const rect = payload?.rect
  if (!rect) return null
  const { image, imageSize, display } = entry
  const bw = display.bounds.width || 1
  const bh = display.bounds.height || 1
  const scaleX = imageSize.width / bw
  const scaleY = imageSize.height / bh
  let x = Math.round(rect.x * scaleX)
  let y = Math.round(rect.y * scaleY)
  let w = Math.round(rect.w * scaleX)
  let h = Math.round(rect.h * scaleY)
  x = Math.max(0, Math.min(x, imageSize.width - 1))
  y = Math.max(0, Math.min(y, imageSize.height - 1))
  w = Math.max(1, Math.min(w, imageSize.width - x))
  h = Math.max(1, Math.min(h, imageSize.height - y))
  const cropped = image.crop({ x, y, width: w, height: h })
  return cropped.isEmpty() ? null : cropped.toDataURL()
}

async function captureDisplay(displayId?: number): Promise<CaptureResult | null> {
  if (captureActive) throw new Error('A capture is already in progress')
  captureActive = true
  const target = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
  const wasVisible = !!win && !win.isDestroyed() && win.isVisible()
  const wasMinimized = !!win && !win.isDestroyed() && win.isMinimized()
  const cardVisible = !!cardWin && !cardWin.isDestroyed() && cardWin.isVisible()
  try {
    try { win?.hide() } catch { /* ignore */ }
    try { if (cardVisible) cardWin?.hide() } catch { /* ignore */ }
    await delay(200)
    const width = Math.min(8192, Math.max(1, Math.round(target.size.width * target.scaleFactor)))
    const height = Math.min(8192, Math.max(1, Math.round(target.size.height * target.scaleFactor)))
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
    const src = sources.find((s) => s.display_id === String(target.id)) ?? sources[0]
    if (!src || src.thumbnail.isEmpty()) return null
    return { dataUrl: src.thumbnail.toDataURL(), source: 'display' }
  } finally {
    captureActive = false
    if (!isQuitting) {
      try { if (wasVisible && win && !win.isDestroyed()) { win.show(); if (wasMinimized) win.minimize(); else win.focus() } } catch { /* ignore */ }
      try { if (cardVisible && cardWin && !cardWin.isDestroyed()) cardWin.show() } catch { /* ignore */ }
    }
  }
}

async function captureWindow(sourceId: string, sourceName?: string): Promise<CaptureResult | null> {
  if (captureActive) throw new Error('A capture is already in progress')
  captureActive = true
  try {
    const displays = screen.getAllDisplays()
    const scale = displays.reduce((m, d) => Math.max(m, d.scaleFactor), 1)
    const maxW = displays.reduce((m, d) => Math.max(m, d.size.width), 0)
    const maxH = displays.reduce((m, d) => Math.max(m, d.size.height), 0)
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: Math.min(6000, Math.max(1, Math.round(maxW * scale))), height: Math.min(6000, Math.max(1, Math.round(maxH * scale))) },
    })
    const src = sources.find((s) => s.id === sourceId) ?? (sourceName ? sources.find((s) => s.name === sourceName) : undefined)
    if (!src || src.thumbnail.isEmpty()) return null
    return { dataUrl: src.thumbnail.toDataURL(), source: 'window' }
  } finally {
    captureActive = false
  }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  // Never allow webviews / extra windows from any contents (defense in depth:
  // privileged IPC in ipc.ts only accepts the single app window as sender).
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
  // Safe local file protocol: jailed to real files only (no directories, no
  // dotfiles/.ssh, no userData root/tree, no symlinks escaping checks).
  // Sensitive app-state files are never served (vault / settings / data store).
  const SENSITIVE_FILES = new Set(['vault.bin', 'dragonhub-data.json', 'dragonhub-settings.json'])
  // Async handler: realpath/stat are awaited off the main thread — a Files or
  // Images page previewing hundreds of files used to run one sync stat per
  // request on the main process, stalling IPC and freezing the window.
  protocol.handle('dh-file', async (request) => {
    try {
      const u = new URL(request.url)
      // Reject any hostname other than empty/'local' (DNS-rebinding style bypass).
      if (u.hostname !== '' && u.hostname !== 'local') return new Response('Bad request', { status: 400 })
      // Decode per-segment (matching the per-segment encodeURIComponent on the
      // preload side) and reject any segment that hides a path separator.
      let p: string
      try {
        const segs = u.pathname.split('/').map((s) => decodeURIComponent(s))
        if (segs.some((s) => s.includes('/') || s.includes('\\'))) return new Response('Bad request', { status: 400 })
        p = segs.join('/')
      } catch {
        return new Response('Bad request', { status: 400 })
      }
      if (p.includes('\0')) return new Response('Bad request', { status: 400 })
      if (process.platform === 'win32') {
        // dh-file://local/C:/path -> pathname "/C:/path"
        p = p.replace(/^\/+/, '')
      }
      const normalized = path.normalize(p)
      // Resolve symlinks so all checks below apply to the real target.
      let real: string
      try {
        real = await fs.promises.realpath(normalized)
      } catch {
        return new Response('Not found', { status: 404 })
      }
      let st: fs.Stats
      try {
        st = await fs.promises.stat(real)
      } catch {
        return new Response('Not found', { status: 404 })
      }
      if (st.isDirectory()) return new Response('Not found', { status: 404 })
      const userData = path.normalize(app.getPath('userData'))
      const eq = process.platform === 'win32'
        ? real.toLowerCase() === userData.toLowerCase()
        : real === userData
      const inside = process.platform === 'win32'
        ? real.toLowerCase().startsWith(userData.toLowerCase() + path.sep)
        : real.startsWith(userData + path.sep)
      // Reject userData root itself and everything under it.
      if (eq || inside) return new Response('Forbidden', { status: 403 })
      // Reject dotfiles / .ssh / hidden trees (any dot-segment).
      try {
        const segs = real.split(path.sep)
        if (segs.some((s) => s.length > 1 && s.startsWith('.'))) return new Response('Forbidden', { status: 403 })
      } catch { return new Response('Bad request', { status: 400 }) }
      if (SENSITIVE_FILES.has(path.basename(real).toLowerCase())) {
        return new Response('Forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(real).toString())
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
  createWindow()
  createTray()
  // Power state bridge: the renderer gates seconds-precision UI (dashboard
  // clock, etc.) while on battery. Initial state is pushed once shortly after
  // the window exists, then on AC/battery transitions.
  try {
    const sendPowerState = (onBattery: boolean) => { try { win?.webContents.send('app:powerState', { onBattery }) } catch { /* ignore */ } }
    powerMonitor.on('on-ac', () => sendPowerState(false))
    powerMonitor.on('on-battery', () => sendPowerState(true))
    setTimeout(() => sendPowerState(powerMonitor.isOnBatteryPower()), 1500)
  } catch { /* powerMonitor not available on this platform */ }
  // Register system-wide hotkeys after the window exists; ignored if the user
  // disabled them or a key is already taken by another app.
  initGlobalShortcuts(() => win)
  refreshGlobalShortcuts()
  // Perf: monitors spawn child processes (netstat/PowerShell/netsh) and hit the
  // disk — start them after the window is created so first paint isn't delayed,
  // especially on HDD. Quota enforcement uses in-memory state, unaffected.
  setImmediate(() => {
    try { netblock.cleanupStaleRules().catch(() => {}) } catch { /* ignore */ }
    try { netmon.startNetMonitor(() => win) } catch { /* network optional */ }
    try { resmon.startResMonitor(() => win, () => cardWin) } catch { /* resources optional */ }
  })

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
  stopGlobalShortcuts()
  try { netmon.stopNetMonitor() } catch { /* ignore */ }
  try { resmon.stopResMonitor() } catch { /* ignore */ }
  // Drop a downloaded-but-uninstalled update installer from temp.
  try { cleanupPendingInstaller() } catch { /* ignore */ }
  // Drop downloaded-but-uninstalled version-manager installers from temp.
  try { cleanupVersionInstallers() } catch { /* ignore */ }
  // Abort every in-flight AI stream so no fetch outlives the window.
  try { stopAllChats() } catch { /* ignore */ }
  try {
    const lim = { ...DEFAULT_NET_LIMITS, ...(dataCollections.get('netLimits', {}) as Partial<typeof DEFAULT_NET_LIMITS>) }
    // Synchronous cleanup: the async variant cannot be awaited here (the
    // process may exit before `netsh delete` runs). Blocks only for the netsh
    // call itself (5s max, typically <300ms) and never throws.
    if (lim.restoreOnQuit) netblock.cleanupStaleRulesSync()
  } catch { /* fail-open: never delay quit */ }
})

// Window controls: same sender rule as privileged IPC (main + card windows).
// Default-deny + sub-frame deny + per-channel rate limit.
const winRateHits = new Map<string, number[]>()
function checkWinRate(channel: string) {
  const n = 120
  const ms = 10000
  const now = Date.now()
  const arr = (winRateHits.get(channel) ?? []).filter((t) => now - t < ms)
  if (arr.length >= n) throw new Error('Rate limited, try again shortly')
  arr.push(now)
  winRateHits.set(channel, arr)
}
function winOnly(channel: string, fn: (e: Electron.IpcMainInvokeEvent) => unknown) {
  return (e: Electron.IpcMainInvokeEvent) => {
    try {
      if (e.senderFrame !== e.sender.mainFrame) throw new Error('Blocked: bad sender')
    } catch (err: unknown) {
      // e.sender destroyed mid-check — deny.
      if (err instanceof Error && err.message === 'Blocked: bad sender') throw err
      throw new Error('Blocked: bad sender')
    }
    const fromMain = (() => { try { return !!win && !win.isDestroyed() && e.sender === win.webContents } catch { return false } })()
    const fromCard = (() => { try { return !!cardWin && !cardWin.isDestroyed() && e.sender === cardWin.webContents } catch { return false } })()
    if (!fromMain && !fromCard) throw new Error('Blocked: bad sender')
    checkWinRate(channel)
    return fn(e)
  }
}
ipcMain.handle('window:minimize', winOnly('window:minimize', () => win?.minimize()))
ipcMain.handle('window:maximize', winOnly('window:maximize', () => {
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
}))
ipcMain.handle('window:show', winOnly('window:show', () => { win?.show(); win?.focus() }))
ipcMain.handle('window:close', winOnly('window:close', (e) => {
  const fromCard = (() => { try { return !!cardWin && !cardWin.isDestroyed() && e.sender === cardWin.webContents } catch { return false } })()
  if (fromCard) cardWin?.close()
  else win?.close()
}))
ipcMain.handle('window:isMaximized', winOnly('window:isMaximized', () => win?.isMaximized() ?? false))
ipcMain.handle('window:fullscreen', winOnly('window:fullscreen', () => win?.setFullScreen(!win.isFullScreen())))
ipcMain.handle('app:quit', winOnly('app:quit', () => { isQuitting = true; app.quit() }))

// Capture channels: region/display/window are only accepted from the main
// renderer; overlay channels only from a live overlay window. Each is
// rate-limited, and `e.senderFrame === e.sender.mainFrame` blocks sub-frames.
function captureOnly<T>(channel: string, fn: () => T | Promise<T>) {
  return (e: Electron.IpcMainInvokeEvent): T | Promise<T> => {
    let ok = false
    try {
      ok = e.senderFrame === e.sender.mainFrame && !!win && !win.isDestroyed() && e.sender === win.webContents
    } catch { ok = false }
    if (!ok) throw new Error('Blocked: bad sender')
    checkWinRate(channel)
    return fn()
  }
}
function overlayEntryFor(e: Electron.IpcMainInvokeEvent): RegionOverlay | null {
  try {
    if (e.senderFrame !== e.sender.mainFrame) return null
    return overlayEntries.get(e.sender.id) ?? null
  } catch { return null }
}

ipcMain.handle('screen:captureRegion', captureOnly('screen:captureRegion', () => startRegionCapture()))
ipcMain.handle('screen:captureDisplay', (e, displayId?: number) => {
  const fn = captureOnly<CaptureResult | null>('screen:captureDisplay', () => captureDisplay(typeof displayId === 'number' ? displayId : undefined))
  return fn(e)
})
ipcMain.handle('screen:captureWindow', (e, sourceId?: string, sourceName?: string) => {
  const fn = captureOnly<CaptureResult | null>('screen:captureWindow', () => {
    if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 512) throw new Error('Invalid source id')
    return captureWindow(sourceId, typeof sourceName === 'string' ? sourceName.slice(0, 512) : undefined)
  })
  return fn(e)
})

ipcMain.handle('capture:overlay:ready', (e) => {
  const entry = overlayEntryFor(e)
  if (!entry || entry.win.isDestroyed()) throw new Error('Blocked: bad overlay')
  checkWinRate('capture:overlay:ready')
  entry.win.webContents.send('capture:overlay:init', overlayInitPayload(entry))
  return true
})
ipcMain.handle('capture:overlay:commit', (e, payload?: CaptureOverlayCommit) => {
  const entry = overlayEntryFor(e)
  if (!entry) throw new Error('Blocked: bad overlay')
  checkWinRate('capture:overlay:commit')
  const dataUrl = cropCommit(entry, payload)
  settleRegion(dataUrl ? { dataUrl, action: payload?.action } : null)
  return true
})
ipcMain.handle('capture:overlay:cancel', (e) => {
  const entry = overlayEntryFor(e)
  if (!entry) throw new Error('Blocked: bad overlay')
  checkWinRate('capture:overlay:cancel')
  settleRegion(null)
  return true
})
