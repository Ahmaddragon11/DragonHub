import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const changelogPath = path.join(root, 'CHANGELOG.md')
const pkgPath = path.join(root, 'package.json')
const typesPath = path.join(root, 'src/shared/types.ts')

const changelog = fs.readFileSync(changelogPath, 'utf8')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const sharedTypes = fs.readFileSync(typesPath, 'utf8')
const version = pkg.version
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid package version: ${version}`)
if (!sharedTypes.includes(`export const APP_VERSION = '${version}'`)) {
  throw new Error(`APP_VERSION does not match package version ${version}`)
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`Release tag ${process.env.GITHUB_REF_NAME} does not match package version v${version}`)
}

const lines = changelog.split(/\r?\n/)
const latestHeaderIndex = lines.findIndex((line) => line.startsWith(`## v${version} `) || line === `## v${version}`)
if (latestHeaderIndex < 0) throw new Error(`CHANGELOG.md is missing an entry for v${version}`)
const latestSection = []
for (let i = latestHeaderIndex; i < lines.length; i++) {
  const line = lines[i]
  if (i > latestHeaderIndex && /^##\s+/.test(line)) break
  latestSection.push(line)
}

const body = [
  `# DragonHub ${version}`,
  '',
  'Windows 10/11 x64 desktop release.',
  '',
  '## Changes',
  ...latestSection.slice(1).filter((line) => !/^##\s+/.test(line)),
  '',
  '## Downloads',
  `- \`DragonHub-Setup-${version}-win-x64.exe\` — interactive installer.`,
  `- \`DragonHub-Portable-${version}-win-x64.exe\` — portable build.`,
  `- \`DragonHub-${version}-sbom.cdx.json\` — CycloneDX software bill of materials.`,
  '- `SHA256SUMS.txt` and `release-manifest.json` — integrity hashes and build metadata.',
  '',
  '---',
  '',
  'Verify the installer provenance with `gh attestation verify <installer.exe> --repo Ahmaddragon11/DragonHub`.',
].join('\n')

process.stdout.write(body)
