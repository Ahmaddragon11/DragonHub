import { app } from 'electron'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const RELEASES_API = 'https://api.github.com/repos/Ahmaddragon11/DragonHub/releases?per_page=100'
const STABLE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/
const GITHUB_ASSET_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
const RELEASE_DOWNLOAD_PATH_PREFIX = '/Ahmaddragon11/DragonHub/releases/download/'
const CHECKSUMS_ASSET_NAME = 'SHA256SUMS.txt'
const MAX_CHECKSUMS_BYTES = 256 * 1024
const SHA256_HEX_LINE = /^([0-9a-f]{64})[ \t]+\*?(.+)$/
const MAX_NOTES_CHARS = 4000
const MAX_SPEED_BPS = 5_000_000_000
const MAX_ETA_SECONDS = 86_400
/** Keep at most this many downloaded installers on disk (oldest pruned first). */
const MAX_KEPT_INSTALLERS = 3
const RELEASE_LIST_TTL = 10 * 60_000
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

/** A published, installable DragonHub release (stable tags only). */
export interface ManagedRelease {
  version: string
  tag: string
  name: string
  publishedAt: string
  notes: string
  installerName: string | null
  installerSize: number | null
  /** More assets exist than just the setup executable (portable, SBOM…). */
  hasPortable: boolean
}

/** Progress payload streamed to the renderer while fetching an installer. */
export interface VersionProgressEvent {
  phase: 'downloading' | 'verifying'
  version: string
  receivedBytes?: number
  totalBytes?: number
  speed?: number
  eta?: number
}

interface ApiRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

interface ApiAsset { name?: unknown; size?: unknown; browser_download_url?: unknown }

type VersionTuple = [number, number, number]

let cache: { at: number; list: ManagedRelease[] } | null = null
let activeDownload: { controller: AbortController; version: string } | null = null
/** version → temp installer path for verified, downloaded installers. */
const downloaded = new Map<string, string>()

function parseVersion(version: string): VersionTuple | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return null
  const tuple: VersionTuple = [Number(match[1]), Number(match[2]), Number(match[3])]
  return tuple.every(Number.isSafeInteger) ? tuple : null
}

function compareVersions(a: VersionTuple, b: VersionTuple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

function notesSnippet(body: unknown): string {
  if (typeof body !== 'string') return ''
  const trimmed = body.trim()
  return trimmed.length > MAX_NOTES_CHARS ? `${trimmed.slice(0, MAX_NOTES_CHARS)}…` : trimmed
}

/** Fetch + curate the published release list: stable `vX.Y.Z` tags only, newest first. */
export async function listVersions(force = false): Promise<ManagedRelease[]> {
  if (!force && cache && Date.now() - cache.at < RELEASE_LIST_TTL) return cache.list
  const controller = new AbortController()
  const response = await fetch(RELEASES_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'DragonHub-Versions' },
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
  })
  if (!response.ok) throw new Error(`Could not load versions (GitHub returned ${response.status})`)
  const list: unknown = await response.json()
  if (!Array.isArray(list)) throw new Error('GitHub returned an invalid release list')

  const out: ManagedRelease[] = []
  const seen = new Set<string>()
  for (const entry of list as ApiRelease[]) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.draft === true || entry.prerelease === true) continue
    if (typeof entry.tag_name !== 'string') continue
    const tag = entry.tag_name.trim()
    const parsed = STABLE_TAG.exec(tag)
    if (!parsed) continue
    const version = `${Number(parsed[1])}.${Number(parsed[2])}.${Number(parsed[3])}`
    if (seen.has(version)) continue
    seen.add(version)

    const assets = Array.isArray(entry.assets) ? (entry.assets as ApiAsset[]) : []
    const setup = assets.find((a) => a?.name === `DragonHub-Setup-${version}-win-x64.exe`)
    out.push({
      version,
      tag,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `DragonHub ${version}`,
      publishedAt: typeof entry.published_at === 'string' ? entry.published_at : '',
      notes: notesSnippet(entry.body),
      installerName: typeof setup?.name === 'string' ? setup.name : null,
      installerSize: typeof setup?.size === 'number' && Number.isSafeInteger(setup.size) ? setup.size : null,
      hasPortable: assets.some((a) => typeof a?.name === 'string' && a.name.includes('Portable')),
    })
  }
  out.sort((a, b) => compareVersions(parseVersion(b.version)!, parseVersion(a.version)!))
  cache = { at: Date.now(), list: out }
  return out
}

function isTrustedReleaseDownloadUrl(url: URL): boolean {
  return url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.pathname.startsWith(RELEASE_DOWNLOAD_PATH_PREFIX)
}

async function fetchGitHubAsset(url: URL, signal: AbortSignal, timeoutMs: number, label: string): Promise<Response> {
  if (!isTrustedReleaseDownloadUrl(url)) throw new Error(`Refusing to fetch the ${label} from an untrusted URL`)
  const response = await fetch(url, {
    headers: { 'user-agent': 'DragonHub-Versions' },
    redirect: 'follow',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  if (!response.ok || !response.body) throw new Error(`Could not download the ${label} (HTTP ${response.status})`)
  if (!GITHUB_ASSET_HOSTS.has(new URL(response.url).hostname)) {
    throw new Error(`The ${label} download redirected to an untrusted host`)
  }
  return response
}

function sha256File(p: string): Promise<string> {
  return new Promise((res, rej) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(p)
    stream.on('data', (d) => hash.update(d))
    stream.on('error', rej)
    stream.on('end', () => res(hash.digest('hex')))
  })
}

async function readPublishedChecksums(url: URL, signal: AbortSignal): Promise<Map<string, string>> {
  const response = await fetchGitHubAsset(url, signal, 20_000, CHECKSUMS_ASSET_NAME)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(declaredLength) && declaredLength > MAX_CHECKSUMS_BYTES) {
    throw new Error('The published checksum file is unexpectedly large')
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    received += buf.length
    if (received > MAX_CHECKSUMS_BYTES) throw new Error('The published checksum file is unexpectedly large')
    chunks.push(buf)
  }
  signal.throwIfAborted()

  const checksums = new Map<string, string>()
  for (const rawLine of Buffer.concat(chunks).toString('utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const match = SHA256_HEX_LINE.exec(line)
    if (!match) throw new Error('The published checksum file is malformed and cannot be trusted')
    checksums.set(path.basename(match[2].trim()).toLowerCase(), match[1])
  }
  if (checksums.size === 0) throw new Error('The published checksum file is empty and cannot be trusted')
  return checksums
}

/** Prune the oldest kept installers so disk usage stays bounded. */
async function pruneInstallers(keepVersion: string): Promise<void> {
  const entries = [...downloaded.entries()].filter(([v]) => v !== keepVersion)
  while (downloaded.size > MAX_KEPT_INSTALLERS && entries.length > 0) {
    const [oldVersion, oldPath] = entries.shift()!
    downloaded.delete(oldVersion)
    await fs.promises.rm(oldPath, { force: true }).catch(() => {})
  }
}

/** Download and verify the setup executable for a published version. */
export async function downloadVersion(
  version: string,
  onProgress: (progress: VersionProgressEvent) => void,
): Promise<{ status: 'downloaded' | 'cancelled'; version: string }> {
  const parsed = parseVersion(version)
  if (!parsed) throw new Error('Invalid version number')
  const clean = `${parsed[0]}.${parsed[1]}.${parsed[2]}`

  const existing = downloaded.get(clean)
  if (existing && fs.existsSync(existing)) return { status: 'downloaded', version: clean }
  if (existing) downloaded.delete(clean)

  if (activeDownload) throw new Error('A version download is already in progress')
  const controller = new AbortController()
  activeDownload = { controller, version: clean }

  try {
    const releases = await listVersions()
    const release = releases.find((r) => r.version === clean)
    if (!release) throw new Error(`Version ${clean} was not found among the published releases`)
    if (!release.installerName) throw new Error(`Version ${clean} has no Windows setup installer`)

    // Re-resolve the asset URL straight from the API payload (cache keeps metadata only).
    const response = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'DragonHub-Versions' },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    })
    if (!response.ok) throw new Error(`Could not resolve the installer for ${clean}`)
    const list: unknown = await response.json()
    const entry = (Array.isArray(list) ? (list as ApiRelease[]) : []).find((r) => typeof r?.tag_name === 'string' && r.tag_name.replace(/^v/, '') === clean)
    const assets = Array.isArray(entry?.assets) ? (entry!.assets as ApiAsset[]) : []
    const asset = assets.find((a) => a?.name === release.installerName)
    if (typeof asset?.browser_download_url !== 'string') throw new Error(`The installer for ${clean} was not found`)
    const assetUrl = new URL(asset.browser_download_url)
    if (!isTrustedReleaseDownloadUrl(assetUrl)) throw new Error('GitHub returned an invalid installer URL')

    const assetResponse = await fetchGitHubAsset(assetUrl, controller.signal, 30 * 60_000, 'installer')
    const contentLength = Number(assetResponse.headers.get('content-length'))
    const totalBytes = Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : undefined
    const targetDir = path.join(app.getPath('temp'), 'DragonHub-versions')
    await fs.promises.mkdir(targetDir, { recursive: true })
    const installerPath = path.join(targetDir, `${release.installerName!.replace(/\.exe$/i, '')}-${randomUUID()}.exe`)

    try {
      let receivedBytes = 0
      let lastReportedAt = 0
      let lastSampleAt = Date.now()
      let lastSampleBytes = 0
      let smoothedSpeed = 0
      const report = (force = false) => {
        const now = Date.now()
        if (!force && now - lastReportedAt < 150) return
        const elapsed = (now - lastSampleAt) / 1000
        if (elapsed > 0) {
          const instant = (receivedBytes - lastSampleBytes) / elapsed
          smoothedSpeed = smoothedSpeed > 0 ? smoothedSpeed * 0.7 + instant * 0.3 : instant
          lastSampleAt = now
          lastSampleBytes = receivedBytes
        }
        lastReportedAt = now
        const speed = smoothedSpeed > 0 ? clamp(Math.round(smoothedSpeed), 0, MAX_SPEED_BPS) : undefined
        const eta = speed && totalBytes
          ? clamp(Math.round(Math.max(0, totalBytes - receivedBytes) / speed), 0, MAX_ETA_SECONDS)
          : undefined
        onProgress({ phase: 'downloading', version: clean, receivedBytes, totalBytes, speed, eta })
      }
      const progress = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          receivedBytes += chunk.length
          report()
          callback(null, chunk)
        },
      })
      onProgress({ phase: 'downloading', version: clean, receivedBytes: 0, totalBytes })
      await pipeline(
        Readable.fromWeb(assetResponse.body as import('node:stream/web').ReadableStream),
        progress,
        fs.createWriteStream(installerPath, { flags: 'wx' }),
        { signal: controller.signal },
      )
      report(true)
      controller.signal.throwIfAborted()

      const installerFile = await fs.promises.open(installerPath, 'r')
      try {
        const signature = Buffer.alloc(2)
        const { bytesRead } = await installerFile.read(signature, 0, signature.length, 0)
        if (bytesRead !== 2 || signature.toString('ascii') !== 'MZ') {
          throw new Error('The downloaded file is not a Windows installer')
        }
        controller.signal.throwIfAborted()
      } finally {
        await installerFile.close()
      }

      onProgress({ phase: 'verifying', version: clean, receivedBytes, totalBytes })
      const checksumUrl = new URL(CHECKSUMS_ASSET_NAME, assetUrl)
      if (!isTrustedReleaseDownloadUrl(checksumUrl)) throw new Error('GitHub returned an invalid checksum URL')
      const expected = (await readPublishedChecksums(checksumUrl, controller.signal)).get(release.installerName!.toLowerCase())
      controller.signal.throwIfAborted()
      if (!expected) throw new Error(`The published checksums do not cover ${release.installerName}`)

      const actual = await sha256File(installerPath)
      controller.signal.throwIfAborted()
      const expectedBytes = Buffer.from(expected, 'hex')
      const actualBytes = Buffer.from(actual, 'hex')
      if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
        throw new Error(`The downloaded installer for ${clean} failed its SHA-256 integrity check and was removed`)
      }

      downloaded.set(clean, installerPath)
      await pruneInstallers(clean)
    } catch (error) {
      await fs.promises.rm(installerPath, { force: true }).catch(() => {})
      throw error
    }
    return { status: 'downloaded', version: clean }
  } catch (error) {
    if (controller.signal.aborted) return { status: 'cancelled', version: clean }
    throw error
  } finally {
    if (activeDownload?.controller === controller) activeDownload = null
  }
}

export function cancelVersionDownload(): boolean {
  if (!activeDownload) return false
  activeDownload.controller.abort()
  return true
}

export function getDownloadedInstallerPath(version: string): string | null {
  const parsed = parseVersion(version)
  if (!parsed) return null
  const clean = `${parsed[0]}.${parsed[1]}.${parsed[2]}`
  const p = downloaded.get(clean)
  if (!p || !fs.existsSync(p)) {
    downloaded.delete(clean)
    return null
  }
  return p
}

/** The installer was handed to the OS: stop tracking it so quit-time cleanup
 *  does not delete the file out from under the running setup. */
export function forgetDownloadedInstaller(version: string): void {
  const parsed = parseVersion(version)
  if (!parsed) return
  downloaded.delete(`${parsed[0]}.${parsed[1]}.${parsed[2]}`)
}

/** Delete every downloaded-but-never-installed version installer (app quit). */
export function cleanupVersionInstallers(): void {
  for (const p of downloaded.values()) {
    try { fs.rmSync(p, { force: true }) } catch { /* best effort */ }
  }
  downloaded.clear()
}
