import { ipcMain, dialog, shell, clipboard, app, nativeTheme, BrowserWindow, powerSaveBlocker } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import * as files from './services/files'
import * as dl from './services/downloader'
import * as vault from './services/vault'
import * as archive from './services/archive'
import * as media from './services/media'
import * as netmon from './services/netmonitor'
import * as netblock from './services/netblock'
import * as resmon from './services/resmonitor'
import { settingsStore, dataCollections } from './services/settings'
import type { AppSettings, CompressOptions, ImageOp, VideoOp, VaultItem, VersionInfo, NetPlan, NetLimits, NetConfig, NetCycle, ResConfig, ResCardConfig } from '../../src/shared/types'
import { CHANGELOG, TELEGRAM_URL, DEFAULT_NET_LIMITS } from '../../src/shared/types'

type GetWin = () => BrowserWindow | null

/** Main window getter, set once in registerAllHandlers so h() can validate senders. */
let senderWin: GetWin | null = null
/** Floating-card window getter (same process, also allowed as IPC sender). */
let senderCardWin: GetWin | null = null

function isAllowedSender(e: Electron.IpcMainInvokeEvent): boolean {
  const w = senderWin?.()
  const c = senderCardWin?.()
  // Default-deny before windows exist (fail-closed): no sender is trusted yet.
  if (!w && !c) return false
  try {
    if (e.senderFrame !== e.sender.mainFrame) return false
    if (w && !w.isDestroyed() && e.sender === w.webContents) return true
    if (c && !c.isDestroyed() && e.sender === c.webContents) return true
  } catch { /* destroyed windows — deny */ }
  return false
}

/** Tiny per-channel rate limiter (brute-force + flood protection). */
const rateHits = new Map<string, number[]>()
const RATE_LIMITS: Record<string, { n: number; ms: number }> = {
  'vault:unlock': { n: 20, ms: 60000 },
  'vault:init': { n: 10, ms: 60000 },
  'vault:changePassword': { n: 10, ms: 60000 },
  'res:killProcess': { n: 10, ms: 60000 },
  'net:appBlocked': { n: 20, ms: 60000 },
  'net:speedTest': { n: 5, ms: 60000 },
  'app:openExternal': { n: 30, ms: 60000 },
  'app:openTelegram': { n: 30, ms: 60000 },
  'app:openUserData': { n: 20, ms: 60000 },
  'app:setLoginItem': { n: 20, ms: 60000 },
  'app:keepAwake': { n: 20, ms: 60000 },
  'app:version': { n: 120, ms: 10000 },
  'window:minimize': { n: 120, ms: 10000 },
  'window:maximize': { n: 120, ms: 10000 },
  'window:close': { n: 120, ms: 10000 },
  'window:show': { n: 120, ms: 10000 },
  'window:fullscreen': { n: 120, ms: 10000 },
  'window:isMaximized': { n: 120, ms: 10000 },
  'app:quit': { n: 20, ms: 60000 },
}
const DEFAULT_RATE = { n: 120, ms: 10000 }
function checkRate(channel: string) {
  const lim = RATE_LIMITS[channel] ?? DEFAULT_RATE
  const now = Date.now()
  const arr = (rateHits.get(channel) ?? []).filter((t) => now - t < lim.ms)
  if (arr.length >= lim.n) throw new Error('Rate limited, try again shortly')
  arr.push(now)
  rateHits.set(channel, arr)
}

/** Wrap a handler so errors are serialized safely to the renderer. */
function h<T extends unknown[], R>(channel: string, fn: (...args: T) => R | Promise<R>) {
  ipcMain.handle(channel, async (e, ...args: unknown[]) => {
    try {
      // Only the app windows (main + floating card, same process) may call
      // privileged channels — a future webview never inherits them.
      if (!isAllowedSender(e)) throw new Error('Blocked: bad sender')
      checkRate(channel)
      return { ok: true, data: await fn(...(args as T)) }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
}

function readNetConfig(): NetConfig {
  const plan = dataCollections.get<NetPlan | null>('netPlan', null)
  const stored = dataCollections.get<Partial<NetLimits>>('netLimits', {})
  return { plan, limits: { ...DEFAULT_NET_LIMITS, ...(stored ?? {}) } }
}

export interface CardControls {
  show: () => void
  hide: () => void
  toggle: () => boolean
  isOpen: () => boolean
}

export function registerAllHandlers(getWin: GetWin, card?: CardControls, getCardWin?: GetWin) {
  senderWin = getWin
  if (getCardWin) senderCardWin = getCardWin
  const cardCtl: CardControls = card ?? { show: () => {}, hide: () => {}, toggle: () => false, isOpen: () => false }
  // ---------- App / system ----------
  h('app:version', (): VersionInfo => ({
    version: app.getVersion(), build: '2026.09.09', electron: process.versions.electron, chrome: process.versions.chrome,
    node: process.versions.node, platform: process.platform, arch: process.arch, releaseDate: '2026-09-09', channel: 'stable',
  }))
  h('app:changelog', () => CHANGELOG)
  h('app:paths', () => ({ userData: app.getPath('userData'), temp: app.getPath('temp'), logs: app.getPath('logs'), ...files.specialFolders() }))
  h('app:system', () => ({
    hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model, totalMem: os.totalmem(), freeMem: os.freemem(), uptime: os.uptime(), user: os.userInfo().username,
  }))
  h('app:openExternal', (url: string) => {
    if (typeof url !== 'string' || url.length > 2048) throw new Error('Blocked URL')
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) throw new Error('Blocked URL scheme')
    // Block localhost / loopback / link-local / cloud-metadata targets (SSRF /
    // DNS-rebinding): at minimum http://localhost and http://127.*.
    if (/^https?:\/\//i.test(url)) {
      let host = ''
      try {
        host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
      } catch {
        throw new Error('Blocked URL')
      }
      const blocked =
        host === 'localhost' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        /^127\./.test(host) ||
        /^169\.254\./.test(host) ||
        host === 'metadata.google.internal' ||
        host === 'metadata.google' ||
        host.endsWith('.metadata.google.internal') ||
        host === 'instance-data' ||
        host === '169.254.169.254'
      if (blocked) {
        try { console.warn('[security] blocked openExternal to local/metadata host:', host) } catch { /* ignore */ }
        throw new Error('Blocked URL host')
      }
    }
    return shell.openExternal(url)
  })
  h('app:openTelegram', () => shell.openExternal(TELEGRAM_URL))
  h('app:systemTheme', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  h('app:openUserData', () => shell.openPath(app.getPath('userData')))
  h('app:setLoginItem', (enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid argument: enabled must be boolean')
    return app.setLoginItemSettings({ openAtLogin: Boolean(!!enabled) })
  })
  let psb: number | null = null
  h('app:keepAwake', (on: boolean) => {
    if (on && psb === null) psb = powerSaveBlocker.start('prevent-app-suspension')
    if (!on && psb !== null) { powerSaveBlocker.stop(psb); psb = null }
    return psb !== null
  })

  // ---------- Clipboard (with auto-clear for secrets) ----------
  h('clipboard:write', (text: string, clearAfterSec?: number) => {
    if (typeof text !== 'string') throw new Error('Invalid clipboard text')
    if (text.length > 1024 * 1024) throw new Error('Clipboard text too large (max 1MB)')
    clipboard.writeText(text)
    if (clearAfterSec && clearAfterSec > 0) {
      setTimeout(() => { if (clipboard.readText() === text) clipboard.clear() }, clearAfterSec * 1000)
    }
  })
  h('clipboard:read', () => clipboard.readText())

  // ---------- Settings ----------
  h('settings:get', () => settingsStore.get())
  h('settings:set', (patch: Partial<AppSettings>) => settingsStore.set(patch))
  h('settings:reset', () => settingsStore.reset())

  // ---------- Data collections ----------
  h('data:get', (key: string, fallback: unknown) => dataCollections.get(key, fallback))
  h('data:set', (key: string, value: unknown) => dataCollections.set(key, value))
  h('data:exportAll', async () => {
    const r = await dialog.showSaveDialog(getWin()!, { defaultPath: `DragonHub-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    await files.writeText(r.filePath, JSON.stringify({ app: 'DragonHub', version: app.getVersion(), exportedAt: Date.now(), settings: settingsStore.get(), data: dataCollections.exportAll() }, null, 2))
    return r.filePath
  })
  h('data:importAll', async () => {
    const r = await dialog.showOpenDialog(getWin()!, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const parsed = JSON.parse(await files.readText(r.filePaths[0]))
    if (parsed.app !== 'DragonHub') throw new Error('Invalid backup file')
    if (parsed.data) dataCollections.importAll(parsed.data)
    if (parsed.settings) settingsStore.set(parsed.settings)
    return true
  })

  // ---------- Dialogs ----------
  h('dialog:openFile', (opts?: { multi?: boolean; filters?: { name: string; extensions: string[] }[]; title?: string }) =>
    dialog.showOpenDialog(getWin()!, { title: opts?.title, properties: opts?.multi ? ['openFile', 'multiSelections'] : ['openFile'], filters: opts?.filters }).then((r) => (r.canceled ? [] : r.filePaths)))
  h('dialog:openFolder', (opts?: { title?: string }) =>
    dialog.showOpenDialog(getWin()!, { title: opts?.title, properties: ['openDirectory', 'createDirectory'] }).then((r) => (r.canceled ? null : r.filePaths[0])))
  h('dialog:save', (opts?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[]; title?: string }) =>
    dialog.showSaveDialog(getWin()!, { title: opts?.title, defaultPath: opts?.defaultPath, filters: opts?.filters }).then((r) => (r.canceled ? null : r.filePath)))
  h('dialog:confirm', (msg: string, detail?: string) => {
    if (typeof msg !== 'string' || msg.length > 500) throw new Error('Invalid confirm message (max 500 chars)')
    if (detail !== undefined && (typeof detail !== 'string' || detail.length > 500)) throw new Error('Invalid confirm detail (max 500 chars)')
    return dialog.showMessageBox(getWin()!, { type: 'question', buttons: ['OK', 'Cancel'], defaultId: 1, cancelId: 1, message: msg, detail }).then((r) => r.response === 0)
  })

  // ---------- Files ----------
  h('fs:list', (dir: string, showHidden: boolean) => files.listDir(dir, showHidden))
  h('fs:stat', (p: string) => files.stat(p))
  h('fs:readText', (p: string) => files.readText(p))
  h('fs:writeText', (p: string, c: string, enc?: 'utf8' | 'base64') => files.writeText(p, c, enc))
  h('fs:readBase64', (p: string) => files.readBase64(p))
  h('fs:mkdir', (p: string) => files.mkdir(p))
  h('fs:createFile', (p: string) => files.createFile(p))
  h('fs:rename', (a: string, b: string) => files.rename(a, b))
  h('fs:copy', (a: string, b: string) => files.copy(a, b))
  h('fs:move', (a: string, b: string) => files.move(a, b))
  h('fs:remove', (p: string, useTrash: boolean) => files.remove(p, useTrash))
  h('fs:drives', () => files.getDrives())
  h('fs:special', () => files.specialFolders())
  h('fs:search', (root: string, q: string) => files.search(root, q))
  h('fs:folderSize', (p: string) => files.folderSize(p))
  h('fs:open', (p: string) => files.openExternal(p))
  h('fs:showInFolder', (p: string) => files.showInFolder(p))
  h('fs:hash', (p: string, algo: 'md5' | 'sha1' | 'sha256' | 'sha512') => files.hashFile(p, algo))
  h('fs:exists', (p: string) => { try { return fs.existsSync(files.safePath(p)) } catch { return false } })
  h('fs:pathInfo', (p: string) => {
    if (typeof p !== 'string' || p.length > 4096 || p.includes('\0')) throw new Error('Invalid path')
    return { dir: path.dirname(p), base: path.basename(p), ext: path.extname(p), name: path.parse(p).name, sep: path.sep }
  })
  h('fs:join', (...parts: string[]) => {
    if (parts.length > 10 || parts.some((x) => typeof x !== 'string' || x.length > 1024 || x.includes('\0'))) throw new Error('Invalid path parts')
    return path.join(...parts)
  })

  // ---------- Downloads ----------
  h('dl:list', () => dl.list())
  h('dl:add', (url: string, opts?: { filename?: string; dir?: string; segments?: number }) => dl.add(getWin(), url, opts))
  h('dl:pause', (id: string) => dl.pause(id))
  h('dl:resume', (id: string) => dl.resume(getWin(), id))
  h('dl:cancel', (id: string) => dl.cancel(id))
  h('dl:remove', (id: string, deleteFile: boolean) => dl.remove(id, deleteFile))
  h('dl:clearFinished', () => dl.clearFinished())
  h('dl:mediaInfo', (url: string) => dl.mediaInfo(getWin(), url))
  h('dl:mediaDownload', (url: string, opts: { format?: string; audioOnly?: boolean; dir?: string }) => dl.mediaDownload(getWin(), url, opts))

  // ---------- Vault ----------
  vault.setOnLock(() => getWin()?.webContents.send('vault:locked'))
  h('vault:meta', () => vault.getMeta())
  h('vault:isUnlocked', () => vault.isUnlocked())
  h('vault:init', (pw: string) => {
    if (typeof pw !== 'string' || pw.length < 1 || pw.length > 256) throw new Error('Invalid password length (1..256)')
    return vault.init(pw, settingsStore.get().vaultAutoLockMin)
  })
  h('vault:unlock', (pw: string) => {
    if (typeof pw !== 'string' || pw.length < 1 || pw.length > 256) throw new Error('Invalid password length (1..256)')
    return vault.unlock(pw, settingsStore.get().vaultAutoLockMin)
  })
  h('vault:lock', () => vault.lock())
  h('vault:touch', () => vault.touch(settingsStore.get().vaultAutoLockMin))
  h('vault:list', () => vault.list())
  h('vault:upsert', (item: VaultItem) => vault.upsert(item))
  h('vault:remove', (id: string) => vault.remove(id))
  h('vault:changePassword', (a: string, b: string) => vault.changePassword(a, b, settingsStore.get().vaultAutoLockMin))
  h('vault:generate', (opts: Parameters<typeof vault.generatePassword>[0]) => vault.generatePassword(opts))
  h('vault:strength', (pw: string) => vault.strength(pw))
  h('vault:export', async () => {
    const r = await dialog.showSaveDialog(getWin()!, { defaultPath: 'DragonHub-vault-backup.dhvault', filters: [{ name: 'DragonHub Vault', extensions: ['dhvault'] }] })
    if (r.canceled || !r.filePath) return null
    await vault.exportEncrypted(r.filePath)
    return r.filePath
  })
  h('vault:import', async () => {
    const r = await dialog.showOpenDialog(getWin()!, { properties: ['openFile'], filters: [{ name: 'DragonHub Vault', extensions: ['dhvault'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    await vault.importEncrypted(r.filePaths[0])
    return true
  })

  // ---------- Archive ----------
  h('zip:compress', (inputs: string[], output: string, opts: CompressOptions) => archive.compress(getWin(), randomUUID(), inputs, output, opts))
  h('zip:compressJob', (jobId: string, inputs: string[], output: string, opts: CompressOptions) => archive.compress(getWin(), jobId, inputs, output, opts))
  h('zip:extract', (jobId: string, a: string, dest: string, pw?: string) => archive.extract(getWin(), jobId, a, dest, pw))
  h('zip:list', (a: string, pw?: string) => archive.listArchive(a, pw))
  h('zip:test', (a: string, pw?: string) => archive.testArchive(a, pw))

  // ---------- Media ----------
  h('img:info', (p: string) => media.imageInfo(p))
  h('img:process', (jobId: string, op: ImageOp) => media.imageProcess(getWin(), jobId, op))
  h('img:thumb', (p: string, size?: number) => media.imageThumbnail(p, size))
  h('video:info', (p: string) => media.mediaInfo(p))
  h('video:process', (jobId: string, op: VideoOp) => media.videoProcess(getWin(), jobId, op))
  h('video:thumb', (p: string, at?: number) => media.videoThumbnail(p, at))
  h('video:cancel', (jobId: string) => media.cancelJob(jobId))

  // ---------- Network usage monitor ----------
  h('net:live', () => netmon.getLiveState())
  h('net:history', (days?: number) => netmon.getHistory(Math.min(Math.max(Number(days) || 30, 1), 90)))
  h('net:getConfig', () => readNetConfig())
  h('net:setPlan', (plan: NetPlan | null) => {
    if (plan === null) {
      dataCollections.set('netPlan', null)
      return readNetConfig()
    }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Invalid plan')
    const p = plan as Partial<NetPlan>
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (!name) throw new Error('Plan name is required')
    if (name.length > 80) throw new Error('Plan name too long (max 80)')
    const quotaMB = Number(p.quotaMB)
    if (!Number.isFinite(quotaMB) || quotaMB < 1 || quotaMB > 1048576) throw new Error('quotaMB must be 1..1048576')
    const cycles: NetCycle[] = ['daily', 'weekly', 'monthly', 'custom']
    if (!p.cycle || !cycles.includes(p.cycle)) throw new Error('Invalid cycle')
    // cycleDays is only meaningful for custom cycles; fixed cycles use
    // well-known spans (daily 1, weekly 7, monthly calendar month).
    const spans: Record<NetCycle, number> = { daily: 1, weekly: 7, monthly: 30, custom: 0 }
    let cycleDays = spans[p.cycle]
    if (p.cycle === 'custom') {
      const n = Number(p.cycleDays)
      if (!Number.isFinite(n) || Math.round(n) < 1 || Math.round(n) > 366) throw new Error('cycleDays must be 1..366')
      cycleDays = Math.round(n)
    }
    const normalized: NetPlan = {
      id: typeof p.id === 'string' && p.id ? p.id.slice(0, 128) : randomUUID(),
      name,
      quotaMB: Math.round(quotaMB),
      cycle: p.cycle,
      cycleDays: Math.round(cycleDays),
      startDate: typeof p.startDate === 'string' ? p.startDate.slice(0, 32) : new Date().toISOString().slice(0, 10),
      active: p.active === undefined ? true : !!p.active,
    }
    dataCollections.set('netPlan', normalized)
    return readNetConfig()
  })
  h('net:setLimits', (l: Partial<NetLimits>) => {
    const cur = readNetConfig().limits
    const patch = ((l ?? {}) as Partial<NetLimits>) ?? {}
    const next: NetLimits = { ...cur }
    if (patch && typeof patch === 'object') {
      const raw = patch as Record<string, unknown>
      if ('dailyCapMB' in raw) {
        const v = raw.dailyCapMB
        if (v === null || v === undefined || v === '') {
          next.dailyCapMB = null
        } else {
          const n = Number(v)
          if (!Number.isFinite(n)) throw new Error('dailyCapMB must be null or 1..1048576')
          // 0 (or negative) means "no cap", not a 1MB instant-block.
          next.dailyCapMB = n <= 0 ? null : Math.min(1048576, Math.round(n))
        }
      }
      if ('blockOnCap' in raw) next.blockOnCap = !!raw.blockOnCap
      if ('restoreAtMidnight' in raw) next.restoreAtMidnight = !!raw.restoreAtMidnight
      if ('restoreOnQuit' in raw) next.restoreOnQuit = !!raw.restoreOnQuit
      if ('monitoringEnabled' in raw) next.monitoringEnabled = !!raw.monitoringEnabled
    }
    dataCollections.set('netLimits', next)
    return readNetConfig()
  })
  h('net:setBlocked', async (on: boolean) => {
    const r = await netblock.setBlocked(!!on)
    netmon.setManualBlocked(r.blocked)
    netmon.setLastNeedsAdmin(r.needsAdmin)
    // Manual unblock clears a stale cap latch too; if the cap is still
    // exceeded and auto-block is on, the monitor will re-latch next tick.
    if (!r.blocked) netmon.clearCapBlock()
    return r
  })
  h('net:isBlocked', async () => ({ blocked: await netblock.isBlocked() }))
  h('net:connInfo', () => netmon.getConnectionInfo())
  h('net:connections', () => netmon.getActiveConnections())
  h('net:appBlocked', async (exePath: string, on: boolean) => {
    const r = await netblock.setAppBlocked(exePath, !!on)
    try {
      const list = dataCollections.get<Record<string, boolean>>('netAppBlocks', {})
      dataCollections.set('netAppBlocks', { ...(list ?? {}), [r.exePath]: r.blocked })
    } catch { /* bookkeeping only */ }
    return r
  })
  h('net:appBlockedCheck', async (exePath: string) => {
    const blocked = await netblock.isAppBlocked(exePath)
    return { blocked, exists: netblock.appExeExists(exePath) }
  })
  h('net:speedTest', () => netmon.speedTest(10_000_000))

  // ---------- Resources monitor (CPU / RAM / disks / GPU / processes) ----------
  h('res:snapshot', () => resmon.getResSnapshot())
  h('res:processes', (topN?: number) => resmon.getResProcesses(topN))
  h('res:history', () => resmon.getResHistory())
  h('res:config:get', () => resmon.getResConfig())
  h('res:config:set', (patch: Partial<ResConfig>) => resmon.setResConfig(patch ?? {}))
  h('res:killProcess', (pid: number) => {
    if (!Number.isInteger(pid) || (pid as number) <= 0) throw new Error('Invalid pid')
    return resmon.killProcess(pid)
  })
  h('res:card:get', () => resmon.getResCardConfig())
  h('res:card:set', (patch: Partial<ResCardConfig>) => resmon.setResCardConfig(patch ?? {}))
  h('res:card:show', () => { cardCtl.show(); return cardCtl.isOpen() })
  h('res:card:hide', () => { cardCtl.hide(); return cardCtl.isOpen() })
  h('res:card:toggle', () => cardCtl.toggle())
  h('res:card:isOpen', () => cardCtl.isOpen())
}
