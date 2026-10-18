import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureDisplay, CaptureOverlayCommit, CaptureOverlayInit, CaptureResult, ScreenSource } from '../../src/shared/types'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// Every privileged channel the renderer may invoke. Any other string is rejected
// here in the preload, so an XSS cannot reach channels that don't exist (or that
// a future refactor removes from main). window:* controls use api.window below
// (all routed through invoke() so the allowlist always applies).
const INVOKE_ALLOW = new Set([
  'app:version', 'app:changelog', 'app:paths', 'app:system', 'app:openExternal', 'app:openTelegram',
  'app:checkForUpdates', 'app:cancelUpdateDownload', 'app:installUpdate',
  'versions:list', 'versions:download', 'versions:cancel', 'versions:status', 'versions:install',
  'app:systemTheme', 'app:openUserData', 'app:setLoginItem', 'app:keepAwake', 'app:quit',
  'app:lastSeenVersion', 'app:markVersionSeen',
  'screen:sources', 'screen:windows', 'screen:displays', 'screen:captureRegion', 'screen:captureDisplay', 'screen:captureWindow',
  'window:minimize', 'window:maximize', 'window:close', 'window:fullscreen', 'window:isMaximized', 'window:show',
  'clipboard:write', 'clipboard:read', 'clipboard:writeImage',
  'settings:get', 'settings:set', 'settings:reset',
  'data:get', 'data:set', 'data:exportAll', 'data:importAll',
  'dialog:openFile', 'dialog:openFolder', 'dialog:save', 'dialog:confirm',
  'fs:list', 'fs:stat', 'fs:readText', 'fs:writeText', 'fs:readBase64', 'fs:mkdir', 'fs:createFile',
  'fs:rename', 'fs:copy', 'fs:move', 'fs:remove', 'fs:drives', 'fs:special', 'fs:search',
  'fs:folderSize', 'fs:open', 'fs:showInFolder', 'fs:hash', 'fs:exists', 'fs:pathInfo', 'fs:join',
  'dl:list', 'dl:add', 'dl:pause', 'dl:resume', 'dl:cancel', 'dl:remove', 'dl:clearFinished',
  'dl:mediaInfo', 'dl:mediaDownload',
  'vault:meta', 'vault:isUnlocked', 'vault:init', 'vault:unlock', 'vault:lock', 'vault:touch',
  'vault:list', 'vault:upsert', 'vault:remove', 'vault:changePassword', 'vault:generate',
  'vault:strength', 'vault:export', 'vault:import', 'vault:reset', 'vault:restore',
  'zip:compress', 'zip:compressJob', 'zip:extract', 'zip:list', 'zip:test',
  'img:info', 'img:process', 'img:thumb',
  'video:info', 'video:process', 'video:thumb', 'video:cancel',
  'net:live', 'net:history', 'net:getConfig', 'net:setPlan', 'net:setLimits', 'net:setBlocked', 'net:isBlocked',
  'net:connInfo', 'net:connections', 'net:appBlocked', 'net:appBlockedCheck', 'net:speedTest',
  'res:snapshot', 'res:processes', 'res:history', 'res:config:get', 'res:config:set', 'res:killProcess',
  'res:card:get', 'res:card:set', 'res:card:show', 'res:card:hide', 'res:card:toggle', 'res:card:isOpen',
  'res:setActivity', 'net:setActivity',
  'notes:addAttachment', 'notes:exportNote',
  'ai:getConfig', 'ai:setConfig', 'ai:upsertProvider', 'ai:deleteProvider', 'ai:setKey', 'ai:test', 'ai:listModels', 'ai:chat', 'ai:abort',
])

// Restricted card preload: the floating card (index.html?card=1) only needs
// live resource channels + minimal window controls. Everything else is denied
// here, so a compromised card renderer cannot reach fs/vault/net/dialog APIs
// even though it shares the same preload bundle (same file, ?card=1 flag).
const CARD_INVOKE_ALLOW = new Set([
  'res:snapshot', 'res:processes', 'res:history', 'res:config:get', 'res:config:set', 'res:killProcess',
  'res:card:get', 'res:card:set', 'res:card:show', 'res:card:hide', 'res:card:toggle', 'res:card:isOpen',
  'window:minimize', 'window:maximize', 'window:close', 'window:show',
  // app:quit is accepted from the card because main's winOnly() guard allows
  // the card webContents (electron/main/index.ts) — the guard is unchanged.
  'app:quit',
])

// Overlay preload: the region-capture overlay (index.html?overlay=1) may only
// talk to the three capture:<overlay> channels + receive its init event. A
// compromised overlay renderer therefore cannot reach fs/vault/net/dialog.
const OVERLAY_INVOKE_ALLOW = new Set([
  'capture:overlay:ready', 'capture:overlay:commit', 'capture:overlay:cancel',
])

const isCard = (() => {
  try { return typeof location !== 'undefined' && location.search.includes('card=1') } catch { return false }
})()
const isOverlay = (() => {
  try { return typeof location !== 'undefined' && location.search.includes('overlay=1') } catch { return false }
})()

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const allow = isOverlay ? OVERLAY_INVOKE_ALLOW : isCard ? CARD_INVOKE_ALLOW : INVOKE_ALLOW
  if (!allow.has(channel)) throw new Error('Channel not allowed: ' + channel)
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T> | T
  if (r && typeof r === 'object' && 'ok' in (r as object)) {
    const rr = r as Result<T>
    if (rr.ok) return rr.data
    throw new Error(rr.error)
  }
  return r as T
}

// Whitelisted event channels renderer may subscribe to
const EVENTS = new Set(['downloads:update', 'downloads:ytdlp-status', 'job:progress', 'vault:locked', 'theme:system', 'window:state', 'net:update', 'res:update', 'updates:progress', 'versions:progress', 'dh:openPalette', 'dh:trayAction', 'capture:overlay:init', 'app:powerState', 'ai:delta', 'ai:done', 'ai:error', 'ai:tool', 'ai:navigate', 'ai:dataChanged'])
// Card renderer only needs live resource updates.
const CARD_EVENTS = new Set(['res:update'])
// Overlay renderer only receives its init payload.
const OVERLAY_EVENTS = new Set(['capture:overlay:init'])

function on(channel: string, cb: (payload: unknown) => void): () => void {
  const allow = isOverlay ? OVERLAY_EVENTS : isCard ? CARD_EVENTS : EVENTS
  if (!allow.has(channel)) throw new Error('Channel not allowed: ' + channel)
  const listener = (_: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Window controls that exist on BOTH surfaces. Single source of truth so a
// control can never drift out of the card API (the removed `as typeof
// mainWindowApi` cast silently hid that drift: the card had no `quit`, so the
// card's Quit button threw `quit is not a function`).
const sharedWindowApi = {
  minimize: () => invoke('window:minimize'),
  maximize: () => invoke('window:maximize'),
  close: () => invoke('window:close'),
  show: () => invoke('window:show'),
  quit: () => invoke('app:quit'),
}

/** Full window surface both surfaces must satisfy. */
type WindowApi = typeof sharedWindowApi & {
  fullscreen: () => Promise<unknown>
  isMaximized: () => Promise<boolean>
}

const mainWindowApi: WindowApi = {
  ...sharedWindowApi,
  fullscreen: () => invoke('window:fullscreen'),
  isMaximized: () => invoke<boolean>('window:isMaximized'),
}

// Card exposes the shared controls; the two main-only controls are declared
// (so the type checks) but refuse in-process — CARD_INVOKE_ALLOW rejects those
// channels anyway, this just fails closed with a clear error instead of leaving
// a property undefined.
const cardWindowApi: WindowApi = {
  ...sharedWindowApi,
  fullscreen: () => Promise.reject(new Error('window:fullscreen is unavailable in the card window')),
  isMaximized: () => Promise.resolve(false),
}

// No cast: both surfaces are declared as WindowApi, so the renderer type is
// the real surface and a member missing from either side is a compile error.
const windowApi: WindowApi = isCard ? cardWindowApi : mainWindowApi

// Real screen-capture surface. The main renderer uses the capture/listing
// members; the overlay renderer uses ready/commit/cancel/onInit. Channel
// allow-lists above enforce the split even though the object is shared.
const captureApi = {
  /** Launch the full-desktop region overlay. Resolves with the crop, or null when cancelled. */
  region: () => invoke<CaptureResult | null>('screen:captureRegion'),
  /** Capture one display wholly (defaults to the primary display). */
  display: (displayId?: number) => invoke<CaptureResult | null>('screen:captureDisplay', displayId),
  /** Capture a window by its desktopCapturer source id (name used as fallback). */
  window: (sourceId: string, sourceName?: string) => invoke<CaptureResult | null>('screen:captureWindow', sourceId, sourceName),
  /** List open windows with thumbnails. */
  windows: () => invoke<ScreenSource[]>('screen:windows'),
  /** List displays for the full-screen picker. */
  displays: () => invoke<CaptureDisplay[]>('screen:displays'),
  /** Overlay: subscribe to the frozen-screenshot init payload. */
  onInit: (cb: (init: CaptureOverlayInit) => void) => on('capture:overlay:init', cb as (p: unknown) => void),
  /** Overlay: signal that the UI mounted; main replies with `capture:overlay:init`. */
  ready: () => invoke('capture:overlay:ready'),
  /** Overlay: confirm the capture. */
  commit: (payload: CaptureOverlayCommit) => invoke('capture:overlay:commit', payload),
  /** Overlay: cancel the capture. */
  cancel: () => invoke('capture:overlay:cancel'),
}

const api = {
  invoke,
  on,
  window: windowApi,
  capture: captureApi,
  platform: process.platform,
  toFileUrl: (p: string) => 'dh-file://local/' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/'),
}

contextBridge.exposeInMainWorld('dh', api)

export type DHApi = typeof api
