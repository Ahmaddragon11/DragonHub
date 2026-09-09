import path from 'node:path'
import fsp from 'node:fs/promises'
import { BrowserWindow } from 'electron'
import type { ImageOp, VideoOp, MediaInfo, JobProgress } from '../../../src/shared/types'
import { safePath } from './files'

const unpack = (p: string) => (p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p)

async function ffmpeg() {
  const ff = (await import('fluent-ffmpeg')).default
  const ffPath = unpack((await import('@ffmpeg-installer/ffmpeg')).path)
  const fpPath = unpack((await import('@ffprobe-installer/ffprobe')).path)
  ff.setFfmpegPath(ffPath)
  ff.setFfprobePath(fpPath)
  return ff
}

function progress(win: BrowserWindow | null, p: JobProgress) {
  win?.webContents.send('job:progress', p)
}

// ---- Input validation: every numeric/enum op field comes from renderer IPC and
// must be clamped to sane ranges so a crafted call cannot OOM the app or break
// out of ffmpeg filters. ----
const clampNum = (v: unknown, min: number, max: number, fallback?: number): number | undefined => {
  if (v === undefined || v === null) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const VIDEO_CODECS = new Set(['libx264', 'libx265', 'libvpx-vp9', 'copy'])
const AUDIO_CODECS = new Set(['aac', 'libmp3lame', 'libopus', 'copy', 'none'])
const PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
const OUT_FORMATS = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov', 'gif', 'mp3', 'aac', 'wav', 'flac', 'ogg'])
const IMG_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'])
const RESIZE_FITS = new Set(['cover', 'contain', 'fill', 'inside', 'outside'])

function sanitizeImageOp(op: ImageOp): ImageOp {
  const out = { ...op }
  if (out.resize) {
    const w = clampNum(out.resize.width, 1, 16384)
    const h = clampNum(out.resize.height, 1, 16384)
    if (w === undefined && h === undefined) delete out.resize
    else out.resize = { width: w, height: h, fit: RESIZE_FITS.has(out.resize.fit as string) ? out.resize.fit : 'inside' }
  }
  if (out.crop) {
    const left = clampNum(out.crop.left, 0, 16384, 0)!
    const top = clampNum(out.crop.top, 0, 16384, 0)!
    const width = clampNum(out.crop.width, 1, 16384)
    const height = clampNum(out.crop.height, 1, 16384)
    if (width === undefined || height === undefined) delete out.crop
    else out.crop = { left, top, width, height }
  }
  if (out.rotate !== undefined) out.rotate = ((Math.round(Number(out.rotate)) % 360) + 360) % 360 || 0
  if (out.blur !== undefined) out.blur = clampNum(out.blur, 0.1, 100, 1)!
  if (out.quality !== undefined) out.quality = clampNum(out.quality, 1, 100, 85)!
  if (out.brightness !== undefined) out.brightness = clampNum(out.brightness, 0, 10)
  if (out.saturation !== undefined) out.saturation = clampNum(out.saturation, 0, 10)
  if (out.hue !== undefined) out.hue = clampNum(out.hue, -180, 180, 0)!
  if (out.format !== undefined && !IMG_FORMATS.has(out.format)) throw new Error(`Unsupported image format: ${out.format}`)
  if (out.watermarkText !== undefined) out.watermarkText = String(out.watermarkText).slice(0, 200)
  return out
}

function sanitizeVideoOp(op: VideoOp): VideoOp {
  const out = { ...op }
  if (out.resize) {
    const w = clampNum(out.resize.width, 16, 7680)
    const h = clampNum(out.resize.height, 16, 7680)
    if (w === undefined && h === undefined) delete out.resize
    else out.resize = { width: w === undefined ? undefined : Math.round(w / 2) * 2, height: h === undefined ? undefined : Math.round(h / 2) * 2 }
  }
  if (out.trim) {
    const start = clampNum(out.trim.start, 0, 86400 * 7, 0)!
    const end = clampNum(out.trim.end, 0.1, 86400 * 7)
    if (end === undefined || end <= start) throw new Error('Invalid trim range')
    out.trim = { start, end }
  }
  if (out.format !== undefined && !OUT_FORMATS.has(out.format)) throw new Error(`Unsupported output format: ${out.format}`)
  if (out.videoCodec !== undefined && !VIDEO_CODECS.has(out.videoCodec)) throw new Error(`Unsupported video codec: ${out.videoCodec}`)
  if (out.audioCodec !== undefined && !AUDIO_CODECS.has(out.audioCodec)) throw new Error(`Unsupported audio codec: ${out.audioCodec}`)
  if (out.preset !== undefined && !PRESETS.has(out.preset)) throw new Error(`Unsupported preset: ${out.preset}`)
  if (out.crf !== undefined) out.crf = clampNum(out.crf, 0, 51, 23)!
  if (out.fps !== undefined) out.fps = clampNum(out.fps, 1, 120, 30)!
  if (out.speed !== undefined) out.speed = clampNum(out.speed, 0.25, 4, 1)!
  if (out.volume !== undefined) out.volume = clampNum(out.volume, 0, 5, 1)!
  if (out.bitrateK !== undefined) out.bitrateK = clampNum(out.bitrateK, 8, 200000)
  if (out.thumbnailAt !== undefined) out.thumbnailAt = clampNum(out.thumbnailAt, 0, 86400 * 7, 1)!
  if (out.rotate !== undefined && ![0, 90, 180, 270].includes(out.rotate)) throw new Error('Invalid rotation')
  return out
}

// Pixel-bomb guard: refuse absurd inputs before sharp/ffmpeg allocate.
// Images decode fully into RAM (strict cap); video streams (generous cap for movies).
const MAX_IMAGE_INPUT_BYTES = 200 * 1024 * 1024
const MAX_VIDEO_INPUT_BYTES = 20 * 1024 * 1024 * 1024
async function assertSaneInput(p: string, max = MAX_IMAGE_INPUT_BYTES) {
  const st = await fsp.stat(p).catch(() => null)
  if (!st) throw new Error('Input file not found')
  if (st.size > max) throw new Error('Input file too large')
}

// ---------------- IMAGES (sharp) ----------------
export async function imageInfo(p: string) {
  const sharp = (await import('sharp')).default
  const sp = safePath(p)
  await assertSaneInput(sp)
  const meta = await sharp(sp, { limitInputPixels: 268_435_456 }).metadata()
  const st = await fsp.stat(sp)
  return {
    width: meta.width, height: meta.height, format: meta.format, space: meta.space, channels: meta.channels,
    hasAlpha: meta.hasAlpha, density: meta.density, size: st.size, orientation: meta.orientation,
    exif: !!meta.exif, icc: !!meta.icc,
  }
}

export async function imageProcess(win: BrowserWindow | null, jobId: string, rawOp: ImageOp): Promise<string> {
  const op = sanitizeImageOp(rawOp)
  const sharp = (await import('sharp')).default
  const input = safePath(op.input)
  const output = safePath(op.output)
  await assertSaneInput(input)
  progress(win, { id: jobId, percent: 10, done: false })
  let img = sharp(input, { failOn: 'error', limitInputPixels: 268_435_456 })
  if (!op.removeMetadata) img = img.withMetadata()
  if (op.rotate) img = img.rotate(op.rotate)
  if (op.flip) img = img.flip()
  if (op.flop) img = img.flop()
  if (op.crop) img = img.extract(op.crop)
  if (op.resize && (op.resize.width || op.resize.height)) img = img.resize({ width: op.resize.width || undefined, height: op.resize.height || undefined, fit: op.resize.fit || 'inside', withoutEnlargement: false })
  if (op.grayscale) img = img.grayscale()
  if (op.blur && op.blur > 0) img = img.blur(op.blur)
  if (op.sharpen) img = img.sharpen()
  if (op.brightness !== undefined || op.saturation !== undefined || op.hue !== undefined) {
    img = img.modulate({ brightness: op.brightness ?? 1, saturation: op.saturation ?? 1, hue: op.hue ?? 0 })
  }
  if (op.watermarkText) {
    const meta = await sharp(input).metadata()
    const w = meta.width || 800
    const fontSize = Math.max(16, Math.round(w / 25))
    const svg = `<svg width="${w}" height="${fontSize * 2}"><text x="${w - 20}" y="${fontSize * 1.3}" font-family="Arial" font-size="${fontSize}" font-weight="bold" fill="rgba(255,255,255,0.7)" stroke="rgba(0,0,0,0.5)" stroke-width="1" text-anchor="end">${escapeXml(op.watermarkText)}</text></svg>`
    img = img.composite([{ input: Buffer.from(svg), gravity: 'southeast' }])
  }
  progress(win, { id: jobId, percent: 50, done: false })
  const q = op.quality ?? 85
  switch (op.format) {
    case 'jpeg': img = img.jpeg({ quality: q, mozjpeg: true }); break
    case 'png': img = img.png({ compressionLevel: 9, quality: q }); break
    case 'webp': img = img.webp({ quality: q }); break
    case 'avif': img = img.avif({ quality: q }); break
    case 'gif': img = img.gif(); break
    case 'tiff': img = img.tiff({ quality: q }); break
  }
  await img.toFile(output)
  progress(win, { id: jobId, percent: 100, done: true, output })
  return output
}

export async function imageThumbnail(p: string, size = 256): Promise<string> {
  const sharp = (await import('sharp')).default
  const sp = safePath(p)
  await assertSaneInput(sp)
  const s = Math.min(1024, Math.max(32, Math.round(Number(size) || 256)))
  const buf = await sharp(sp, { failOn: 'error', limitInputPixels: 268_435_456 }).resize(s, s, { fit: 'inside' }).webp({ quality: 70 }).toBuffer()
  return 'data:image/webp;base64,' + buf.toString('base64')
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string))
}

// ---------------- VIDEO / AUDIO (ffmpeg) ----------------
export async function mediaInfo(p: string): Promise<MediaInfo> {
  const ff = await ffmpeg()
  const sp = safePath(p)
  return new Promise((res, rej) => {
    ff.ffprobe(sp, (err, data) => {
      if (err) return rej(err)
      const v = data.streams.find((s) => s.codec_type === 'video')
      const a = data.streams.find((s) => s.codec_type === 'audio')
      const fps = v?.r_frame_rate ? (() => { const [n, d] = v.r_frame_rate!.split('/').map(Number); return d ? n / d : n })() : undefined
      res({
        format: data.format.format_name || '', duration: Number(data.format.duration) || 0, size: Number(data.format.size) || 0,
        bitrate: Number(data.format.bit_rate) || 0, width: v?.width, height: v?.height, fps, videoCodec: v?.codec_name,
        audioCodec: a?.codec_name, audioChannels: a?.channels, sampleRate: a?.sample_rate ? Number(a.sample_rate) : undefined,
      })
    })
  })
}

const running = new Map<string, any>()
export function cancelJob(id: string) {
  const cmd = running.get(id)
  if (cmd) { try { cmd.kill('SIGKILL') } catch { /* */ } running.delete(id) }
}

export async function videoProcess(win: BrowserWindow | null, jobId: string, rawOp: VideoOp): Promise<string> {
  const op = sanitizeVideoOp(rawOp)
  const ff = await ffmpeg()
  const input = safePath(op.input)
  const output = safePath(op.output)
  await assertSaneInput(input, MAX_VIDEO_INPUT_BYTES)
  const info = await mediaInfo(input).catch(() => null)
  const totalDur = op.trim ? op.trim.end - op.trim.start : info?.duration || 0

  return new Promise((res, rej) => {
    let cmd = ff(input)
    if (op.trim) cmd = cmd.setStartTime(op.trim.start).setDuration(Math.max(0.1, op.trim.end - op.trim.start))

    const vf: string[] = []
    const af: string[] = []
    if (op.resize && (op.resize.width || op.resize.height)) vf.push(`scale=${op.resize.width || -2}:${op.resize.height || -2}`)
    if (op.rotate === 90) vf.push('transpose=1')
    if (op.rotate === 180) vf.push('transpose=1,transpose=1')
    if (op.rotate === 270) vf.push('transpose=2')
    if (op.fps) cmd = cmd.fps(op.fps)
    if (op.speed && op.speed !== 1) { vf.push(`setpts=${(1 / op.speed).toFixed(4)}*PTS`); af.push(`atempo=${Math.min(2, Math.max(0.5, op.speed))}`) }
    if (op.volume !== undefined && op.volume !== 1) af.push(`volume=${op.volume}`)

    const audioOnly = op.extractAudio || ['mp3', 'aac', 'wav', 'flac', 'ogg'].includes(op.format || '')
    if (op.thumbnailAt !== undefined) {
      cmd = ff(input).seekInput(op.thumbnailAt).frames(1)
      if (vf.length) cmd = cmd.videoFilters(vf)
    } else if (audioOnly) {
      cmd = cmd.noVideo()
      const codecMap: Record<string, string> = { mp3: 'libmp3lame', aac: 'aac', wav: 'pcm_s16le', flac: 'flac', ogg: 'libvorbis' }
      cmd = cmd.audioCodec(codecMap[op.format || 'mp3'] || 'libmp3lame')
      if (op.bitrateK) cmd = cmd.audioBitrate(op.bitrateK)
      if (af.length) cmd = cmd.audioFilters(af)
    } else if (op.format === 'gif') {
      vf.push('fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse')
      cmd = cmd.noAudio().complexFilter(vf.join(','))
    } else {
      if (vf.length) cmd = cmd.videoFilters(vf)
      if (op.mute) cmd = cmd.noAudio()
      else {
        if (op.audioCodec === 'none') cmd = cmd.noAudio()
        else if (op.audioCodec) cmd = cmd.audioCodec(op.audioCodec)
        if (af.length && op.audioCodec !== 'copy') cmd = cmd.audioFilters(af)
      }
      if (op.videoCodec) cmd = cmd.videoCodec(op.videoCodec)
      if (op.videoCodec !== 'copy') {
        if (op.crf !== undefined) cmd = cmd.outputOptions([`-crf ${op.crf}`])
        if (op.preset) cmd = cmd.outputOptions([`-preset ${op.preset}`])
        if (op.bitrateK) cmd = cmd.videoBitrate(op.bitrateK)
      }
      if (op.format === 'mp4' || op.format === 'mov') cmd = cmd.outputOptions(['-movflags +faststart'])
      if (op.format === 'webm' && !op.videoCodec) cmd = cmd.videoCodec('libvpx-vp9').audioCodec('libopus')
    }

    running.set(jobId, cmd)
    cmd
      .on('progress', (p) => {
        let pct = p.percent || 0
        if (!pct && p.timemark && totalDur) {
          const t = p.timemark.split(':').map(Number)
          const secs = t[0] * 3600 + t[1] * 60 + t[2]
          pct = (secs / totalDur) * 100
        }
        progress(win, { id: jobId, percent: Math.min(99, Math.max(0, pct)), done: false, message: `${p.currentFps || 0} fps` })
      })
      .on('end', () => { running.delete(jobId); progress(win, { id: jobId, percent: 100, done: true, output }); res(output) })
      .on('error', (e) => { running.delete(jobId); progress(win, { id: jobId, percent: 0, done: true, error: e.message }); rej(e) })
      .save(output)
  })
}

export async function videoThumbnail(p: string, at = 1): Promise<string> {
  const os = await import('node:os')
  const crypto = await import('node:crypto')
  const safeAt = Math.min(7 * 86400, Math.max(0, Number(at) || 0))
  const tmp = path.join(os.tmpdir(), `dh_thumb_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`)
  try {
    await videoProcess(null, `thumb-${process.pid}-${Date.now()}`, { input: p, output: tmp, thumbnailAt: safeAt, resize: { width: 480 } })
    const buf = await fsp.readFile(tmp)
    return 'data:image/jpeg;base64,' + buf.toString('base64')
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {})
  }
}
