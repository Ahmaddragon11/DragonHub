import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid package version: ${version}`)
const directory = path.join(root, 'release', version)
const installerNames = [
  `DragonHub-Setup-${version}-win-x64.exe`,
  `DragonHub-Portable-${version}-win-x64.exe`,
]
const sbomName = `DragonHub-${version}-sbom.cdx.json`
const notesName = 'RELEASE-NOTES.md'

async function hashFile(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

const sbom = JSON.parse(await fs.readFile(path.join(directory, sbomName), 'utf8'))
if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components)) {
  throw new Error('Generated SBOM is not a valid CycloneDX document')
}

const assets = []
for (const name of [...installerNames, sbomName, notesName]) {
  const filePath = path.join(directory, name)
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size === 0) throw new Error(`Release asset is missing or empty: ${name}`)
  if (name.endsWith('.exe')) {
    const handle = await fs.open(filePath, 'r')
    try {
      const signature = Buffer.alloc(2)
      const { bytesRead } = await handle.read(signature, 0, 2, 0)
      if (bytesRead !== 2 || signature.toString('ascii') !== 'MZ') {
        throw new Error(`Invalid Windows executable: ${name}`)
      }
    } finally {
      await handle.close()
    }
  }
  assets.push({ name, size: stat.size, sha256: await hashFile(filePath) })
}

const manifest = {
  application: pkg.productName,
  version,
  platform: 'win32',
  architecture: 'x64',
  commit: process.env.GITHUB_SHA || 'local',
  workflowRun: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  generatedAt: new Date().toISOString(),
  assets,
}

await fs.writeFile(
  path.join(directory, 'SHA256SUMS.txt'),
  `${assets.map((asset) => `${asset.sha256}  ${asset.name}`).join('\n')}\n`,
)
await fs.writeFile(path.join(directory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Validated ${installerNames.length} Windows installers and generated release checksums.`)
