import { contextBridge, ipcRenderer } from 'electron'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// Every privileged channel the renderer may invoke. Any other string is rejected
// here in the preload, so an XSS cannot reach channels that don't exist (or that
// a future refactor removes from main). window:* controls use api.window below
// (all routed through invoke() so the allowlist always applies).
const INVOKE_ALLOW = new Set([
  'app:version', 'app:changelog', 'app:paths', 'app:system', 'app:openExternal', 'app:openTelegram',
  'app:checkForUpdates', 'app:cancelUpdateDownload', 'app:installUpdate',
  'app:systemTheme', 'app:openUserData', 'app:setLoginItem', 'app:keepAwake', 'app:quit',
  'app:lastSeenVersion', 'app:markVersionSeen',
  'screen:sources',
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
  'vault:strength', 'vault:export', 'vault:import',
  'zip:compress', 'zip:compressJob', 'zip:extract', 'zip:list', 'zip:test',
  'img:info', 'img:process', 'img:thumb',
  'video:info', 'video:process', 'video:thumb', 'video:cancel',
  'net:live', 'net:history', 'net:getConfig', 'net:setPlan', 'net:setLimits', 'net:setBlocked', 'net:isBlocked',
  'net:connInfo', 'net:connections', 'net:appBlocked', 'net:appBlockedCheck', 'net:speedTest',
  'res:snapshot', 'res:processes', 'res:history', 'res:config:get', 'res:config:set', 'res:killProcess',
  'res:card:get', 'res:card:set', 'res:card:show', 'res:card:hide', 'res:card:toggle', 'res:card:isOpen',
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

const isCard = (() => {
  try { return typeof location !== 'undefined' && location.search.includes('card=1') } catch { return false }
})()

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const allow = isCard ? CARD_INVOKE_ALLOW : INVOKE_ALLOW
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
const EVENTS = new Set(['downloads:update', 'downloads:ytdlp-status', 'job:progress', 'vault:locked', 'theme:system', 'window:state', 'net:update', 'res:update', 'updates:progress', 'dh:openPalette', 'dh:trayAction'])
// Card renderer only needs live resource updates.
const CARD_EVENTS = new Set(['res:update'])

function on(channel: string, cb: (payload: unknown) => void): () => void {
  if (!(isCard ? CARD_EVENTS : EVENTS).has(channel)) throw new Error('Channel not allowed: ' + channel)
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

const api = {
  invoke,
  on,
  window: windowApi,
  platform: process.platform,
  toFileUrl: (p: string) => 'dh-file://local/' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F'),
}

contextBridge.exposeInMainWorld('dh', api)

export type DHApi = typeof api
