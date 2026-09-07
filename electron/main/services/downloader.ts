import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, app } from 'electron'
import type { DownloadItem } from '../../../src/shared/types'
import { dataCollections, settingsStore } from './settings'

type Ctrl = { abort: AbortController; paused: boolean }
const controllers = new Map<string, Ctrl>()
let items: DownloadItem[] = dataCollections.get<DownloadItem[]>('downloads', [])
// reset any transient states from previous session
items = items.map((i) => (i.status === 'downloading' || i.status === 'queued' ? { ...i, status: 'paused', speed: 0, eta: 0 } : i))
persist()

function persist() {
  dataCollections.set('downloads', items)
}

function emit(win: BrowserWindow | null, item: DownloadItem) {
  win?.webContents.send('downloads:update', item)
}

function sanitizeFilename(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 200) || 'download'
}

function filenameFromResponse(url: string, res: Response): string {
  const cd = res.headers.get('content-disposition')
  if (cd) {
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd)
    if (m) return sanitizeFilename(decodeURIComponent(m[1]))
  }
  try {
    const u = new URL(url)
    const base = path.basename(u.pathname)
    if (base && base !== '/') return sanitizeFilename(decodeURIComponent(base))
  } catch { /* */ }
  return 'download_' + Date.now()
}

function validateUrl(url: string) {
  const u = new URL(url)
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http/https URLs are allowed')
  // SSRF guard: refuse literal private/loopback/link-local targets. (DNS-rebinding
  // beyond literals is documented in SECURITY_NOTES.md; downloads never carry
  // credentials or internal headers.)
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const blocked = (h: string) =>
    h === 'localhost' || h.endsWith('.localhost') ||
    h === '::1' || h === '::ffff:127.0.0.1' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^0\.0\.0\.0$/.test(h) || /^::(:)?$/.test(h) ||
    /^0x7f/i.test(h) || /^[0-9]+$/.test(h.replace(/\./g, '')) && /^2130706433$/.test(h.replace(/\./g, ''))
  if (blocked(host)) throw new Error('Blocked address: downloads to local/private networks are not allowed')
  return u.toString()
}

async function uniquePath(dir: string, name: string) {
  let p = path.join(dir, name)
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let i = 1
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`)
  return p
}

export function list() {
  return items
}

export async function add(win: BrowserWindow | null, url: string, opts?: { filename?: string; dir?: string; segments?: number }) {
  const cleanUrl = validateUrl(url)
  const s = settingsStore.get()
  const dir = opts?.dir || s.downloadDir || path.join(app.getPath('downloads'), 'DragonHub')
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
  const dir = path.dirname(item.savePath || path.join(settingsStore.get().downloadDir, 'x'))
  const partPath = () => item.savePath + '.dhpart'

  try {
    // HEAD / probe
    const probe = await fetch(item.url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: abort.signal, redirect: 'follow' })
    if (!probe.ok && probe.status !== 206) throw new Error(`HTTP ${probe.status}`)
    const supportsRange = probe.status === 206 && !!probe.headers.get('content-range')
    let size = 0
    const cr = probe.headers.get('content-range')
    if (cr) size = Number(cr.split('/')[1]) || 0
    else size = Number(probe.headers.get('content-length')) || 0
    // consume tiny body
    try { await probe.arrayBuffer() } catch { /* */ }

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

    await fsp.rename(partPath(), item.savePath)
    update({ status: 'completed', completedAt: Date.now(), speed: 0, eta: 0, received: item.size || item.received })
  } catch (e: any) {
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
  const res = await fetch(item.url, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  item.received = 0
  const ws = fs.createWriteStream(part)
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!ws.write(value)) await new Promise<void>((r) => ws.once('drain', () => r()))
      onChunk(value.byteLength)
    }
  } finally {
    await new Promise<void>((r) => ws.end(() => r()))
  }
}

async function downloadSegmented(item: DownloadItem, size: number, signal: AbortSignal, onChunk: (n: number) => void) {
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
            const res = await fetch(item.url, { headers: { Range: `bytes=${pos}-${to}` }, signal, redirect: 'follow' })
            if (res.status !== 206 || !res.body) throw new Error(`Segment HTTP ${res.status}`)
            const reader = res.body.getReader()
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
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
  it.status = 'queued'; it.received = 0
  emit(win, it); persist(); pump(win)
}

export async function cancel(id: string) {
  const c = controllers.get(id)
  if (c) { c.paused = false; c.abort.abort() }
  else {
    const it = items.find((i) => i.id === id)
    if (it) { it.status = 'cancelled'; try { await fsp.rm(it.savePath + '.dhpart', { force: true }) } catch { /* */ } }
  }
  persist()
}

export async function remove(id: string, deleteFile: boolean) {
  await cancel(id)
  const it = items.find((i) => i.id === id)
  if (it && deleteFile && it.savePath) { try { await fsp.rm(it.savePath, { force: true }) } catch { /* */ } }
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
  if (!fs.existsSync(bin)) {
    win?.webContents.send('downloads:ytdlp-status', { status: 'installing' })
    await YTDlpWrap.downloadFromGithub(bin)
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
  let thumbnailDataUrl: string | undefined
  if (meta.thumbnail) {
    try {
      const res = await fetch(meta.thumbnail, { redirect: 'follow' })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        const ct = res.headers.get('content-type') || 'image/jpeg'
        thumbnailDataUrl = `data:${ct};base64,${buf.toString('base64')}`
      }
    } catch { /* thumbnail optional */ }
  }
  return {
    title: meta.title,
    thumbnail: thumbnailDataUrl || meta.thumbnail,
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
  const s = settingsStore.get()
  const dir = opts.dir || s.downloadDir
  await fsp.mkdir(dir, { recursive: true })
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
