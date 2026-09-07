import { contextBridge, ipcRenderer } from 'electron'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T> | T
  if (r && typeof r === 'object' && 'ok' in (r as object)) {
    const rr = r as Result<T>
    if (rr.ok) return rr.data
    throw new Error(rr.error)
  }
  return r as T
}

// Whitelisted event channels renderer may subscribe to
const EVENTS = new Set(['downloads:update', 'downloads:ytdlp-status', 'job:progress', 'vault:locked', 'theme:system', 'window:state', 'net:update'])

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
  },
  platform: process.platform,
  toFileUrl: (p: string) => 'dh-file://local/' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F'),
}

contextBridge.exposeInMainWorld('dh', api)

export type DHApi = typeof api
