import { contextBridge, ipcRenderer } from 'electron'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// Every privileged channel the renderer may invoke. Any other string is rejected
// here in the preload, so an XSS cannot reach channels that don't exist (or that
// a future refactor removes from main). window:* controls use api.window below.
const INVOKE_ALLOW = new Set([
  'app:version', 'app:changelog', 'app:paths', 'app:system', 'app:openExternal', 'app:openTelegram',
  'app:systemTheme', 'app:openUserData', 'app:setLoginItem', 'app:keepAwake',
  'clipboard:write', 'clipboard:read',
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

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  if (!INVOKE_ALLOW.has(channel)) throw new Error('Channel not allowed: ' + channel)
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T> | T
  if (r && typeof r === 'object' && 'ok' in (r as object)) {
    const rr = r as Result<T>
    if (rr.ok) return rr.data
    throw new Error(rr.error)
  }
  return r as T
}

// Whitelisted event channels renderer may subscribe to
const EVENTS = new Set(['downloads:update', 'downloads:ytdlp-status', 'job:progress', 'vault:locked', 'theme:system', 'window:state', 'net:update', 'res:update'])

function on(channel: string, cb: (payload: unknown) => void): () => void {
  if (!EVENTS.has(channel)) throw new Error('Channel not allowed: ' + channel)
  const listener = (_: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  invoke,
  on,
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
    show: () => ipcRenderer.invoke('window:show'),
    quit: () => ipcRenderer.invoke('app:quit'),
  },
  platform: process.platform,
  toFileUrl: (p: string) => 'dh-file://local/' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F'),
}

contextBridge.exposeInMainWorld('dh', api)

export type DHApi = typeof api
