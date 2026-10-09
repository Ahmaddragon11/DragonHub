import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const RELEASE_API = 'https://api.github.com/repos/Ahmaddragon11/DragonHub/releases/latest'
const GITHUB_ASSET_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

interface ReleaseAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface LatestRelease {
  tag_name?: unknown
  assets?: unknown
}

type UpdateCheckResult =
  | { status: 'unsupported' | 'up-to-date' | 'cancelled' }
  | { status: 'available'; version: string }

let pendingInstaller: { path: string; version: string } | null = null
let activeDownload: AbortController | null = null

function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return [major, minor, patch]
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

async function getLatestRelease(signal: AbortSignal): Promise<LatestRelease> {
  const response = await fetch(RELEASE_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'DragonHub-Updater' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  })
  if (!response.ok) throw new Error(`Could not check for updates (GitHub returned ${response.status})`)
  const release: unknown = await response.json()
  if (!release || typeof release !== 'object') throw new Error('GitHub returned an invalid release')
  return release as LatestRelease
}

export async function downloadLatestUpdate(
  onProgress: (progress: { phase: 'checking' | 'downloading'; receivedBytes?: number; totalBytes?: number }) => void,
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
    if (assetUrl.protocol !== 'https:' || assetUrl.hostname !== 'github.com' ||
        !assetUrl.pathname.startsWith('/Ahmaddragon11/DragonHub/releases/download/')) {
      throw new Error('GitHub returned an invalid installer URL')
    }

    if (pendingInstaller?.version === version && fs.existsSync(pendingInstaller.path)) {
      return { status: 'available', version }
    }
    if (pendingInstaller) {
      await fs.promises.rm(pendingInstaller.path, { force: true })
      pendingInstaller = null
    }

    const response = await fetch(assetUrl, {
      headers: { 'user-agent': 'DragonHub-Updater' },
      redirect: 'follow',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)]),
    })
    if (!response.ok || !response.body) throw new Error(`Could not download the update (HTTP ${response.status})`)
    if (!GITHUB_ASSET_HOSTS.has(new URL(response.url).hostname)) {
      throw new Error('The installer download redirected to an untrusted host')
    }

    const contentLength = Number(response.headers.get('content-length'))
    const totalBytes = Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : undefined
    const installerPath = path.join(app.getPath('temp'), `DragonHub-Setup-${version}-${randomUUID()}.exe`)
    try {
      let receivedBytes = 0
      let lastReportedAt = 0
      const progress = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          receivedBytes += chunk.length
          const now = Date.now()
          if (now - lastReportedAt >= 150) {
            onProgress({ phase: 'downloading', receivedBytes, totalBytes })
            lastReportedAt = now
          }
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
      onProgress({ phase: 'downloading', receivedBytes, totalBytes })
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
