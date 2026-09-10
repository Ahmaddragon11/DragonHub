import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import dns from 'node:dns/promises'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, app } from 'electron'
import type { DownloadItem } from '../../../src/shared/types'
import { dataCollections, settingsStore } from './settings'

type Ctrl = { abort: AbortController; paused: boolean }
const controllers = new Map<string, Ctrl>()
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024 * 1024
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024
let items: DownloadItem[] = sanitizeLoaded(dataCollections.get<DownloadItem[]>('downloads', []))
// reset any transient states from previous session
items = items.map((i) => (i.status === 'downloading' || i.status === 'queued' ? { ...i, status: 'paused', speed: 0, eta: 0 } : i))
persist()

/** Drop poisoned persisted rows (e.g. via generic data:set): keep only well-shaped items. */
function sanitizeLoaded(raw: unknown): DownloadItem[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((i) => i && typeof i === 'object' && typeof (i as any).id === 'string' && typeof (i as any).url === 'string').slice(0, 1000) as DownloadItem[]
}

/** Case-aware containment (Windows/macOS are case-insensitive). */
function insideDir(child: string, parent: string): boolean {
  const c = path.resolve(child), p = path.resolve(parent)
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return c.toLowerCase() === p.toLowerCase() || c.toLowerCase().startsWith(p.toLowerCase() + path.sep)
  }
  return c === p || c.startsWith(p + path.sep)
}

/** realpath-aware containment for savePath checks: resolves symlinked
 *  prefixes (native realpath with textual fallback). Non-existent children
 *  resolve via their nearest real ancestor. */
function insideDirReal(child: string, parent: string): boolean {
  const real = (p: string): string => {
    try {
      const native = (fs.realpathSync as unknown as { native?: typeof fs.realpathSync }).native ?? fs.realpathSync
      return native(p)
    } catch {
      return path.resolve(p)
    }
  }
  try {
    let rp: string
    try {
      rp = real(parent)
    } catch {
      rp = path.resolve(parent)
    }
    let rc: string
    try {
      rc = real(child)
    } catch {
      try {
        rc = path.join(real(path.dirname(path.resolve(child))), path.basename(path.resolve(child)))
      } catch {
        rc = path.resolve(child)
      }
    }
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return rc.toLowerCase() === rp.toLowerCase() || rc.toLowerCase().startsWith(rp.toLowerCase() + path.sep)
    }
    return rc === rp || rc.startsWith(rp + path.sep)
  } catch {
    return insideDir(child, parent)
  }
}

/** Download targets always live under the configured download dir: renderer-supplied
 *  dirs are only honored when they match it (dirs are chosen via trusted dialogs). */
function resolveTargetDir(optsDir: string | undefined): string {
  const s = settingsStore.get()
  const base = s.downloadDir || path.join(app.getPath('downloads'), 'DragonHub')
  if (optsDir) {
    try {
      const cand = path.resolve(optsDir)
      if (cand === path.resolve(base)) return base
    } catch { /* fall through to base */ }
  }
  return base
}

function persist() {
  dataCollections.set('downloads', items)
}

function emit(win: BrowserWindow | null, item: DownloadItem) {
  win?.webContents.send('downloads:update', item)
}

function sanitizeFilename(name: string) {
  let n = String(name || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 200)
  // Never allow bare dots / reserved device names / trailing dots-spaces (traversal + Win quirks).
  if (/^\.+$/.test(n)) n = 'download'
  n = n.replace(/[. ]+$/, '') || 'download'
  if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(n)) n = `_${n}`
  return n || 'download'
}

function filenameFromResponse(url: string, res: Response): string {
  const cd = res.headers.get('content-disposition')
  if (cd) {
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd)
    if (m) {
      try { return sanitizeFilename(decodeURIComponent(m[1])) } catch { return sanitizeFilename(m[1]) }
    }
  }
  try {
    const u = new URL(url)
    const base = path.basename(u.pathname)
    if (base && base !== '/') {
      try { return sanitizeFilename(decodeURIComponent(base)) } catch { return sanitizeFilename(base) }
    }
  } catch { /* */ }
  return 'download_' + Date.now()
}

/** Normalize exotic IPv4 spellings (hex/octal/decimal dword) to dotted quad. */
function normalizeIPv4(host: string): string | null {
  const h = host.toLowerCase()
  if (/^\d+$/.test(h)) {
    // dword decimal: 2130706433 -> 127.0.0.1
    const n = Number(h)
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
  }
  const parts = h.split('.')
  if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|[0-9]+)$/i.test(p))) {
    const nums = parts.map((p) => (/^0x/i.test(p) ? parseInt(p, 16) : /^0[0-9]/.test(p) && p.length > 1 ? parseInt(p, 8) : parseInt(p, 10)))
    if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null
    if (parts.length === 4) {
      if (nums.some((n) => n > 255)) return null
      return nums.join('.')
    }
    // Shorthand inet_aton forms (a.b24 / a.b.c16): expand, then range-check.
    const last = nums[nums.length - 1]
    const head = nums.slice(0, -1)
    if (head.some((n) => n > 255)) return null
    if (parts.length === 2 && last > 0xffffff) return null
    if (parts.length === 3 && last > 0xffff) return null
    const tail = parts.length === 2
      ? [(last >>> 16) & 255, (last >>> 8) & 255, last & 255]
      : [(last >>> 8) & 255, last & 255]
    return [...head, ...tail].join('.')
  }
  return null
}

function isBlockedAddress(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1' || normalized === '::' || normalized === '0.0.0.0') return true
  // IPv4-mapped IPv6 embeds a v4 address: ::ffff:192.168.1.1
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(normalized)
  if (mapped) return isBlockedAddress(mapped[1])
  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number)
    if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254 ||
      parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168) return true
    // Carrier-grade NAT 100.64.0.0/10, IETF 192.0.0.0/24, benchmarking 198.18.0.0/15.
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true
    return false
  }
  if (net.isIPv6(normalized)) {
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.')
  }
  // Exotic spellings must not slip past the literal checks: normalize then re-check.
  const canon = normalizeIPv4(normalized)
  if (canon) return isBlockedAddress(canon)
  return /^0x7f/i.test(normalized)
}

function validateUrl(url: string) {
  const u = new URL(url)
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http/https URLs are allowed')
  if (isBlockedAddress(u.hostname)) throw new Error('Blocked address: downloads to local/private networks are not allowed')
  return u.toString()
}

async function validateRemoteUrl(url: string) {
  const clean = validateUrl(url)
  const host = new URL(clean).hostname
  if (!net.isIP(host)) {
    const addresses = await dns.lookup(host, { all: true, verbatim: true })
    if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
      throw new Error('Blocked address: downloads to local/private networks are not allowed')
    }
  }
  return clean
}

async function fetchSafe(url: string, init: RequestInit = {}, maxBytes = MAX_DOWNLOAD_BYTES, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  let current = await validateRemoteUrl(url)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    const response = await fetch(current, { ...init, signal, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length > maxBytes) throw new Error('Download exceeds the maximum allowed size')
      return response
    }
    const location = response.headers.get('location')
    if (!location || redirects === MAX_REDIRECTS) throw new Error('Too many or invalid redirects')
    current = await validateRemoteUrl(new URL(location, current).toString())
  }
  throw new Error('Too many redirects')
}

async function uniquePath(dir: string, name: string) {
  let p = path.join(dir, name)
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let i = 1
  while (fs.existsSync(p)) {
    if (i > 10000) return path.join(dir, `${base} (${randomUUID()})${ext}`)
    p = path.join(dir, `${base} (${i++})${ext}`)
  }
  return p
}

/** Atomically commit part -> dest without silent overwrite (O_EXCL semantics
 *  via COPYFILE_EXCL): a file planted at dest between uniquePath() and commit
 *  causes EEXIST instead of being crushed. Caller regenerates uniquePath. */
async function commitPartAtomic(part: string, dest: string): Promise<void> {
  await fsp.copyFile(part, dest, fs.constants.COPYFILE_EXCL)
  await fsp.rm(part, { force: true })
}

export function list() {
  return items
}

export async function add(win: BrowserWindow | null, url: string, opts?: { filename?: string; dir?: string; segments?: number }) {
  if (items.length >= 100) throw new Error('Download queue is full (max 100) — finish, cancel or remove existing downloads first')
  const cleanUrl = validateUrl(url)
  const s = settingsStore.get()
  const dir = resolveTargetDir(opts?.dir)
  await fsp.mkdir(dir, { recursive: true })
  const item: DownloadItem = {
    id: randomUUID(),
    url: cleanUrl,
    filename: opts?.filename ? sanitizeFilename(opts.filename) : '',
    savePath: '',
    size: 0,
    received: 0,
    speed: 0,
    eta: 0,
    status: 'queued',
    segments: Math.min(Math.max(opts?.segments ?? s.downloadSegments, 1), 32),
    supportsRange: false,
    createdAt: Date.now(),
    kind: 'direct',
  }
  items.unshift(item)
  persist()
  emit(win, item)
  pump(win)
  return item
}

function pump(win: BrowserWindow | null) {
  const s = settingsStore.get()
  const active = items.filter((i) => i.status === 'downloading').length
  const slots = Math.max(1, s.maxParallelDownloads) - active
  if (slots <= 0) return
  const queued = items.filter((i) => i.status === 'queued').slice(0, slots)
  for (const q of queued) void run(win, q)
}

async function run(win: BrowserWindow | null, item: DownloadItem) {
  const abort = new AbortController()
  controllers.set(item.id, { abort, paused: false })
  const update = (patch: Partial<DownloadItem>) => {
    Object.assign(item, patch)
    emit(win, item)
  }
  update({ status: 'downloading', error: undefined })
  const base = resolveTargetDir(undefined)
  // Never write part files outside the download dir (poisoned persisted rows).
  if (item.savePath && !insideDirReal(path.dirname(item.savePath), base)) item.savePath = ''
  const dir = path.dirname(item.savePath || path.join(base, 'x'))
  const partPath = () => item.savePath + '.dhpart'

  // Probe caps: tiny body + short timeout; content-range beyond 20GB rejected.
  const PROBE_MAX_BYTES = 256 * 1024
  const PROBE_TIMEOUT_MS = 15_000
  async function consumeProbeBody(res: Response): Promise<void> {
    const body = res.body
    if (!body) return
    const reader = body.getReader()
    let n = 0
    const deadline = Date.now() + PROBE_TIMEOUT_MS
    try {
      for (;;) {
        if (Date.now() > deadline) throw new Error('Probe timed out (15s)')
        const { done, value } = await reader.read()
        if (done) break
        n += value.byteLength
        if (n > PROBE_MAX_BYTES) throw new Error('Probe response too large (max 256KB)')
      }
    } finally {
      try { reader.releaseLock() } catch { /* ignore */ }
      try { await res.arrayBuffer().catch(() => undefined) } catch { /* drained */ }
    }
  }

  try {
    // HEAD / probe
    const probe = await fetchSafe(item.url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: abort.signal }, MAX_DOWNLOAD_BYTES, PROBE_TIMEOUT_MS)
    if (!probe.ok && probe.status !== 206) throw new Error(`HTTP ${probe.status}`)
    const supportsRange = probe.status === 206 && !!probe.headers.get('content-range')
    let size = 0
    const cr = probe.headers.get('content-range')
    if (cr) {
      const total = Number(cr.split('/')[1])
      if (!Number.isFinite(total) || total > MAX_DOWNLOAD_BYTES) throw new Error('Download exceeds the maximum allowed size (max 20GB)')
      size = total || 0
    } else size = Number(probe.headers.get('content-length')) || 0
    if (size > MAX_DOWNLOAD_BYTES) throw new Error('Download exceeds the maximum allowed size')
    // consume tiny body (capped at 256KB, 15s timeout)
    try { await consumeProbeBody(probe) } catch { /* */ }

    if (!item.filename) item.filename = filenameFromResponse(item.url, probe)
    if (!item.savePath) item.savePath = await uniquePath(dir, item.filename)
    update({ size, supportsRange })

    const start = Date.now()
    let lastT = start, lastR = item.received
    const tick = setInterval(() => {
      const now = Date.now()
      const dt = (now - lastT) / 1000
      const speed = dt > 0 ? (item.received - lastR) / dt : 0
      lastT = now; lastR = item.received
      const remain = item.size - item.received
      update({ speed, eta: speed > 0 && item.size ? remain / speed : 0 })
    }, 700)

    try {
      if (supportsRange && size > 1024 * 1024 && item.segments > 1) {
        await downloadSegmented(item, size, abort.signal, (n) => { item.received += n })
      } else {
        await downloadSingle(item, abort.signal, (n) => { item.received += n })
      }
    } finally {
      clearInterval(tick)
    }

    try {
      await commitPartAtomic(partPath(), item.savePath)
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') {
        // Lost the claim race (planted file): pick a fresh name once, then commit.
        item.savePath = await uniquePath(dir, item.filename)
        await commitPartAtomic(partPath(), item.savePath)
      } else throw e
    }
    update({ status: 'completed', completedAt: Date.now(), speed: 0, eta: 0, received: item.size || item.received })  } catch (e: any) {
    if (abort.signal.aborted) {
      const c = controllers.get(item.id)
      update({ status: c?.paused ? 'paused' : 'cancelled', speed: 0, eta: 0 })
      if (!c?.paused) { try { await fsp.rm(partPath(), { force: true }) } catch { /* */ } }
    } else {
      update({ status: 'error', error: e?.message || String(e), speed: 0, eta: 0 })
    }
  } finally {
    controllers.delete(item.id)
    persist()
    pump(win)
  }
}

async function downloadSingle(item: DownloadItem, signal: AbortSignal, onChunk: (n: number) => void) {
  const part = item.savePath + '.dhpart'
  const res = await fetchSafe(item.url, { signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  item.received = 0
  const ws = fs.createWriteStream(part)
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (item.received + value.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('Download exceeds the maximum allowed size')
      if (!ws.write(value)) await new Promise<void>((r) => ws.once('drain', () => r()))
      onChunk(value.byteLength)
    }
  } finally {
    await new Promise<void>((r) => ws.end(() => r()))
  }
}

async function downloadSegmented(item: DownloadItem, size: number, signal: AbortSignal, onChunk: (n: number) => void) {
  if (size > MAX_DOWNLOAD_BYTES) throw new Error('Download exceeds the maximum allowed size')
  const part = item.savePath + '.dhpart'
  const fh = await fsp.open(part, 'w')
  await fh.truncate(size)
  item.received = 0
  const segCount = item.segments
  const segSize = Math.ceil(size / segCount)
  const ranges = Array.from({ length: segCount }, (_, i) => [i * segSize, Math.min(size - 1, (i + 1) * segSize - 1)] as const).filter(([a, b]) => a <= b)

  try {
    await Promise.all(
      ranges.map(async ([from, to]) => {
        let attempt = 0
        let pos = from
        for (;;) {
          try {
            const res = await fetchSafe(item.url, { headers: { Range: `bytes=${pos}-${to}` }, signal })
            if (res.status !== 206 || !res.body) throw new Error(`Segment HTTP ${res.status}`)
            const reader = res.body.getReader()
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              if (pos + value.byteLength > to + 1) throw new Error('Server returned data outside the requested range')
              await fh.write(value, 0, value.byteLength, pos)
              pos += value.byteLength
              onChunk(value.byteLength)
            }
            return
          } catch (e) {
            if (signal.aborted || ++attempt > 5) throw e
            await new Promise((r) => setTimeout(r, 500 * attempt))
          }
        }
      }),
    )
  } finally {
    await fh.close()
  }
}

export function pause(id: string) {
  const c = controllers.get(id)
  if (c) { c.paused = true; c.abort.abort() }
}

export function resume(win: BrowserWindow | null, id: string) {
  const it = items.find((i) => i.id === id)
  if (!it || it.status === 'downloading') return
  // Media (yt-dlp) downloads cannot be resumed as direct HTTP ranges;
  // re-running them through the segmented engine would save a web page as a file.
  if (it.kind === 'media') throw new Error('Media downloads cannot be resumed — please add the URL again')
  // A persisted savePath outside the download dir is never trusted (re-target instead).
  const base = resolveTargetDir(undefined)
  if (it.savePath && !insideDirReal(path.dirname(it.savePath), base)) it.savePath = ''
  it.status = 'queued'; it.received = 0
  emit(win, it); persist(); pump(win)
}

export async function cancel(id: string) {
  const c = controllers.get(id)
  if (c) { c.paused = false; c.abort.abort() }
  else {
    const it = items.find((i) => i.id === id)
    if (it?.savePath) {
      // Only delete the .dhpart inside the download dir (poisoned rows must
      // not become delete primitives): realpath-aware containment.
      try {
        if (insideDirReal(path.dirname(it.savePath), resolveTargetDir(undefined))) {
          await fsp.rm(it.savePath + '.dhpart', { force: true })
        }
      } catch { /* */ }
    }
    if (it) it.status = 'cancelled'
  }
  persist()
}

export async function remove(id: string, deleteFile: boolean) {
  await cancel(id)
  const it = items.find((i) => i.id === id)
  if (it && deleteFile && it.savePath) {
    try {
      // Only ever delete real files inside the download dir: media rows store a
      // directory in savePath, and poisoned rows must not become delete primitives.
      const st = await fsp.lstat(it.savePath).catch(() => null)
      if (st && !st.isDirectory() && insideDirReal(path.dirname(it.savePath), resolveTargetDir(undefined))) {
        await fsp.rm(it.savePath, { force: true })
      }
    } catch { /* */ }
  }
  items = items.filter((i) => i.id !== id)
  persist()
}

export function clearFinished() {
  items = items.filter((i) => !['completed', 'cancelled', 'error'].includes(i.status))
  persist()
  return items
}

// ---------- Media downloader (yt-dlp) ----------
let ytdlpPath: string | null = null
async function ensureYtDlp(win: BrowserWindow | null): Promise<string> {
  const YTDlpWrap = (await import('yt-dlp-wrap')).default
  const binDir = path.join(app.getPath('userData'), 'bin')
  await fsp.mkdir(binDir, { recursive: true })
  const bin = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  const existing = await fsp.lstat(bin).catch(() => null)
  // Refuse pre-planted junk: only a real non-empty file is executed, else re-download.
  // NOTE: downloadFromGithub() performs NO checksum/signature verification —
  // the fetched binary is executed as-is. The 1MB minimum below is only a
  // junk/placeholder filter, NOT an authenticity check. On failure, refuse to
  // execute rather than running a truncated payload.
  const MIN_YTDLP_BYTES = 1024 * 1024
  if (!existing || !existing.isFile() || existing.size < MIN_YTDLP_BYTES) {
    if (existing) await fsp.rm(bin, { force: true }).catch(() => {})
    win?.webContents.send('downloads:ytdlp-status', { status: 'installing' })
    await YTDlpWrap.downloadFromGithub(bin)
    // Post-download gate: refuse to execute truncated/placeholder payloads.
    const fresh = await fsp.lstat(bin).catch(() => null)
    if (!fresh || !fresh.isFile() || fresh.size < MIN_YTDLP_BYTES) {
      await fsp.rm(bin, { force: true }).catch(() => {})
      throw new Error('yt-dlp download failed verification (size < 1MB) — refusing to execute')
    }
    win?.webContents.send('downloads:ytdlp-status', { status: 'ready' })
  }
  ytdlpPath = bin
  return bin
}

export async function mediaInfo(win: BrowserWindow | null, url: string) {
  validateUrl(url)
  const YTDlpWrap = (await import('yt-dlp-wrap')).default
  const bin = ytdlpPath || (await ensureYtDlp(win))
  const y = new YTDlpWrap(bin)
  const meta = await y.getVideoInfo(url)
  // Thumbnail: validated URL, 5MB cap, 15s timeout, SVG rejected (scriptable
  // image). Never return the raw remote URL to the renderer — null on failure
  // so the UI cannot be pointed at an attacker URL.
  const MAX_THUMB_FETCH_BYTES = 5 * 1024 * 1024
  const THUMB_TIMEOUT_MS = 15_000
  let thumbnailDataUrl: string | null = null
  if (meta.thumbnail) {
    try {
      const cleanThumb = validateUrl(String(meta.thumbnail))
      const res = await fetchSafe(cleanThumb, {}, MAX_THUMB_FETCH_BYTES, THUMB_TIMEOUT_MS)
      const ct = (res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim()
      if (!res.ok) throw new Error(`Thumbnail HTTP ${res.status}`)
      if (!ct.startsWith('image/') || ct === 'image/svg+xml') throw new Error('Thumbnail type blocked')
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_THUMB_FETCH_BYTES) throw new Error('Thumbnail is too large (max 5MB)')
      thumbnailDataUrl = `data:${ct || 'image/jpeg'};base64,${buf.toString('base64')}`
    } catch { thumbnailDataUrl = null }
  }
  return {
    title: meta.title,
    thumbnail: thumbnailDataUrl,
    duration: meta.duration,
    uploader: meta.uploader,
    formats: (meta.formats || []).slice(-30).map((f: any) => ({
      id: f.format_id, ext: f.ext, note: f.format_note, res: f.resolution, filesize: f.filesize || f.filesize_approx, vcodec: f.vcodec, acodec: f.acodec,
    })),
  }
}

export async function mediaDownload(win: BrowserWindow | null, url: string, opts: { format?: string; audioOnly?: boolean; dir?: string }) {
  validateUrl(url)
  const YTDlpWrap = (await import('yt-dlp-wrap')).default
  const bin = ytdlpPath || (await ensureYtDlp(win))
  const dir = resolveTargetDir(opts.dir)
  await fsp.mkdir(dir, { recursive: true })
  if (opts.format !== undefined) {
    // Format selector allowlist: named presets (best / bestaudio /
    // bestvideo+bestaudio) or a tight safe pattern (lowercase alnum + _ + - /
    // with length < 64). No leading dashes (flag injection), no selector
    // metachars (* ? : = , ( ) [ ] .) that widen yt-dlp filter power.
    if (typeof opts.format !== 'string' || opts.format.length === 0 || opts.format.length >= 64 || /^\s*-/.test(opts.format) ||
      !(opts.format === 'best' || opts.format === 'bestaudio' || opts.format === 'bestvideo+bestaudio' ||
        /^[a-z0-9_+\-/]+$/.test(opts.format))) {
      throw new Error('Invalid format selector (allowed: best, bestaudio, bestvideo+bestaudio, or [a-z0-9_+/-] <64 chars)')
    }
  }
  const item: DownloadItem = {
    id: randomUUID(), url, filename: 'media', savePath: dir, size: 0, received: 0, speed: 0, eta: 0,
    status: 'downloading', segments: 1, supportsRange: false, createdAt: Date.now(), kind: 'media',
  }
  items.unshift(item); persist(); emit(win, item)
  const y = new YTDlpWrap(bin)
  const args = [url, '-o', path.join(dir, '%(title).120s.%(ext)s'), '--no-playlist', '--newline', '-N', '8']
  if (opts.audioOnly) args.push('-x', '--audio-format', 'mp3')
  else if (opts.format) args.push('-f', opts.format)
  else args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4')
  try {
    const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).path
    args.push('--ffmpeg-location', ffmpegPath)
  } catch { /* */ }
  const ee = y.exec(args)
  const ctrl = { abort: new AbortController(), paused: false }
  controllers.set(item.id, ctrl)
  ctrl.abort.signal.addEventListener('abort', () => { try { ee.ytDlpProcess?.kill() } catch { /* */ } })
  ee.on('progress', (p: any) => {
    item.received = p.percent ?? 0; item.size = 100
    item.speed = parseSpeed(p.currentSpeed); item.eta = parseEta(p.eta)
    emit(win, item)
  })
  ee.on('ytDlpEvent', (type: string, data: string) => {
    if (type === 'download' && data.includes('Destination:')) {
      item.filename = path.basename(data.split('Destination:')[1].trim()); emit(win, item)
    }
  })
  ee.on('error', (e: any) => { item.status = ctrl.abort.signal.aborted ? 'cancelled' : 'error'; item.error = String(e?.message || e); controllers.delete(item.id); persist(); emit(win, item) })
  ee.on('close', () => {
    if (item.status === 'downloading') { item.status = 'completed'; item.received = 100; item.completedAt = Date.now() }
    controllers.delete(item.id); persist(); emit(win, item)
  })
  return item
}

function parseSpeed(s?: string) {
  if (!s) return 0
  const m = /([\d.]+)\s*([KMG]i?B)/i.exec(s)
  if (!m) return 0
  const mult: Record<string, number> = { KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, KB: 1e3, MB: 1e6, GB: 1e9 }
  return parseFloat(m[1]) * (mult[m[2].toUpperCase()] || 1)
}
function parseEta(s?: string) {
  if (!s) return 0
  const parts = s.split(':').map(Number)
  return parts.reduce((a, b) => a * 60 + b, 0)
}
