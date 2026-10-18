import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const RELEASES_API = 'https://api.github.com/repos/Ahmaddragon11/DragonHub/releases?per_page=100'
// Only plain `vX.Y.Z` tags are real releases. Rolling/preview tags such as
// `continuous` or `build-N` must never be offered as an update.
const STABLE_TAG = /^v?\d+\.\d+\.\d+$/
const GITHUB_ASSET_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
const RELEASE_DOWNLOAD_PATH_PREFIX = '/Ahmaddragon11/DragonHub/releases/download/'
const CHECKSUMS_ASSET_NAME = 'SHA256SUMS.txt'
const MAX_CHECKSUMS_BYTES = 256 * 1024
const SHA256_HEX_LINE = /^([0-9a-f]{64})[ \t]+\*?(.+)$/
// Progress reporting bounds keep a bogus sample (clock jump / tiny chunk) from
// ever surfacing an absurd speed or "remaining time" in the UI.
const MAX_SPEED_BPS = 5_000_000_000
const MAX_ETA_SECONDS = 86_400
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

/** Progress payload streamed to the renderer during an update check/download. */
export interface UpdateProgressEvent {
  phase: 'checking' | 'downloading'
  receivedBytes?: number
  totalBytes?: number
  /** Smoothed transfer rate in bytes/second (present while streaming). */
  speed?: number
  /** Estimated seconds remaining when both the total size and a rate are known. */
  eta?: number
}

interface ReleaseAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface LatestRelease {
  tag_name?: unknown
  assets?: unknown
}

interface ReleaseListItem {
  tag_name?: unknown
  assets?: unknown
  draft?: unknown
  prerelease?: unknown
}

type VersionTuple = [number, number, number]

type UpdateCheckResult =
  | { status: 'unsupported' | 'up-to-date' | 'cancelled' }
  | { status: 'available'; version: string }

let pendingInstaller: { path: string; version: string } | null = null
let activeDownload: AbortController | null = null

function parseVersion(version: string): VersionTuple | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return [major, minor, patch]
}

/** 1 if a > b, -1 if a < b, 0 if equal. */
function compareVersions(a: VersionTuple, b: VersionTuple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (!next || !installed) throw new Error('The release version is invalid')
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== installed[i]) return next[i] > installed[i]
  }
  return false
}

/** Pick the newest published, non-prerelease release whose tag is a plain
 *  `vX.Y.Z`. Relying on `/releases/latest` is unsafe here: a rolling
 *  `continuous` release that is not flagged as a prerelease would win and its
 *  non-semver tag would make the update check fail. */
async function getLatestRelease(signal: AbortSignal): Promise<LatestRelease> {
  const response = await fetch(RELEASES_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'DragonHub-Updater' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  })
  if (!response.ok) throw new Error(`Could not check for updates (GitHub returned ${response.status})`)
  const list: unknown = await response.json()
  if (!Array.isArray(list)) throw new Error('GitHub returned an invalid release list')

  let best: { rank: VersionTuple; release: LatestRelease } | null = null
  for (const entry of list as ReleaseListItem[]) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.draft === true || entry.prerelease === true) continue
    if (typeof entry.tag_name !== 'string' || !STABLE_TAG.test(entry.tag_name.trim())) continue
    const rank = parseVersion(entry.tag_name.trim())
    if (!rank) continue
    if (!best || compareVersions(rank, best.rank) > 0) best = { rank, release: entry }
  }
  if (!best) throw new Error('No published release was found')
  return best.release
}

function isTrustedReleaseDownloadUrl(url: URL): boolean {
  return url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.pathname.startsWith(RELEASE_DOWNLOAD_PATH_PREFIX)
}

async function fetchGitHubAsset(url: URL, signal: AbortSignal, timeoutMs: number, label: string): Promise<Response> {
  if (!isTrustedReleaseDownloadUrl(url)) throw new Error(`Refusing to fetch the ${label} from an untrusted URL`)
  const response = await fetch(url, {
    headers: { 'user-agent': 'DragonHub-Updater' },
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
    const h = createHash('sha256')
    const s = fs.createReadStream(p)
    s.on('data', (d) => h.update(d))
    s.on('error', rej)
    s.on('end', () => res(h.digest('hex')))
  })
}

// Format written by scripts/release-manifest.mjs: `<64 lowercase hex><space><space><basename>`, LF separated,
// covering DragonHub-Setup-<version>-win-x64.exe, DragonHub-Portable-<version>-win-x64.exe, the SBOM and RELEASE-NOTES.md.
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

async function verifyInstallerIntegrity(
  installerPath: string,
  assetName: string,
  assetUrl: URL,
  signal: AbortSignal,
): Promise<void> {
  const checksumUrl = new URL(CHECKSUMS_ASSET_NAME, assetUrl)
  if (!isTrustedReleaseDownloadUrl(checksumUrl)) throw new Error('GitHub returned an invalid checksum URL')
  const expected = (await readPublishedChecksums(checksumUrl, signal)).get(path.basename(assetName).toLowerCase())
  signal.throwIfAborted()
  if (!expected) throw new Error(`The published checksums do not cover ${assetName}`)

  const actual = await sha256File(installerPath)
  signal.throwIfAborted()
  const expectedBytes = Buffer.from(expected, 'hex')
  const actualBytes = Buffer.from(actual, 'hex')
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    throw new Error(`The downloaded installer ${assetName} failed its SHA-256 integrity check and will not be installed`)
  }
}

export async function downloadLatestUpdate(
  onProgress: (progress: UpdateProgressEvent) => void,
): Promise<UpdateCheckResult> {
  if (!app.isPackaged || process.platform !== 'win32') return { status: 'unsupported' }

  if (activeDownload) throw new Error('An update check is already in progress')
  const controller = new AbortController()
  activeDownload = controller
  onProgress({ phase: 'checking' })

  try {
    const release = await getLatestRelease(controller.signal)
    if (typeof release.tag_name !== 'string') throw new Error('GitHub release has no version tag')
    const version = release.tag_name.replace(/^v/, '')
    if (!isNewerVersion(version, app.getVersion())) return { status: 'up-to-date' }

    const expectedName = `DragonHub-Setup-${version}-win-x64.exe`
    if (!Array.isArray(release.assets)) throw new Error('GitHub release has no installer assets')
    const asset = (release.assets as ReleaseAsset[]).find((item) => item?.name === expectedName)
    if (typeof asset?.browser_download_url !== 'string') {
      throw new Error('The Windows setup installer was not found in the latest release')
    }

    const assetUrl = new URL(asset.browser_download_url)
    if (!isTrustedReleaseDownloadUrl(assetUrl)) {
      throw new Error('GitHub returned an invalid installer URL')
    }

    if (pendingInstaller?.version === version && fs.existsSync(pendingInstaller.path)) {
      return { status: 'available', version }
    }
    if (pendingInstaller) {
      await fs.promises.rm(pendingInstaller.path, { force: true })
      pendingInstaller = null
    }

    const response = await fetchGitHubAsset(assetUrl, controller.signal, 30 * 60_000, 'update')

    const contentLength = Number(response.headers.get('content-length'))
    const totalBytes = Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : undefined
    const installerPath = path.join(app.getPath('temp'), `DragonHub-Setup-${version}-${randomUUID()}.exe`)
    try {
      let receivedBytes = 0
      let lastReportedAt = 0
      let lastSampleAt = Date.now()
      let lastSampleBytes = 0
      let smoothedSpeed = 0
      // Coalesce to ~7 fps and derive a smoothed rate + ETA from real timestamps,
      // so the renderer gets them for free without any extra IPC channel.
      const report = (force = false) => {
        const now = Date.now()
        if (!force && now - lastReportedAt < 150) return
        const elapsed = (now - lastSampleAt) / 1000
        if (elapsed > 0) {
          const instant = (receivedBytes - lastSampleBytes) / elapsed
          // Exponential moving average keeps the readout stable between samples.
          smoothedSpeed = smoothedSpeed > 0 ? smoothedSpeed * 0.7 + instant * 0.3 : instant
          lastSampleAt = now
          lastSampleBytes = receivedBytes
        }
        lastReportedAt = now
        const speed = smoothedSpeed > 0 ? clamp(Math.round(smoothedSpeed), 0, MAX_SPEED_BPS) : undefined
        const eta = speed && totalBytes
          ? clamp(Math.round(Math.max(0, totalBytes - receivedBytes) / speed), 0, MAX_ETA_SECONDS)
          : undefined
        onProgress({ phase: 'downloading', receivedBytes, totalBytes, speed, eta })
      }
      const progress = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          receivedBytes += chunk.length
          report()
          callback(null, chunk)
        },
      })
      onProgress({ phase: 'downloading', receivedBytes: 0, totalBytes })
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
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

      await verifyInstallerIntegrity(installerPath, expectedName, assetUrl, controller.signal)
      pendingInstaller = { path: installerPath, version }
    } catch (error) {
      await fs.promises.rm(installerPath, { force: true })
      throw error
    }

    return { status: 'available', version }
  } catch (error) {
    if (controller.signal.aborted) return { status: 'cancelled' }
    throw error
  } finally {
    if (activeDownload === controller) activeDownload = null
  }
}

export function cancelUpdateDownload(): boolean {
  if (!activeDownload) return false
  activeDownload.abort()
  return true
}

export function getDownloadedInstaller(): { path: string; version: string } | null {
  if (!pendingInstaller || !fs.existsSync(pendingInstaller.path)) {
    pendingInstaller = null
    return null
  }
  return pendingInstaller
}

/** The installer was handed to the OS: keep the file, forget the pending ref so
 *  before-quit cleanup does not delete it out from under the running setup. */
export function releaseDownloadedInstaller(): void {
  pendingInstaller = null
}

/**
 * Hand the installer to Windows setup with every page suppressed. NSIS reuses
 * the previous install folder (`InstallDirRegKey`, per-user) so nothing is
 * asked, and `--force-run` reopens DragonHub once the silent install finishes.
 * Falls back to the normal interactive launch if the silent spawn cannot
 * start, so approving an update is never a dead end.
 */
export async function launchInstallerSilently(installerPath: string): Promise<void> {
  try {
    const child = spawn(installerPath, ['--updated', '/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', () => resolve())
    })
    child.unref()
    return
  } catch { /* fall through to the interactive installer */ }
  const openError = await shell.openPath(installerPath)
  if (openError) throw new Error(`Could not launch the installer: ${openError}`)
}

/** Delete a downloaded-but-never-installed update installer (app quit cleanup). */
export function cleanupPendingInstaller(): void {
  if (!pendingInstaller) return
  try { fs.rmSync(pendingInstaller.path, { force: true }) } catch { /* best effort */ }
  pendingInstaller = null
}
