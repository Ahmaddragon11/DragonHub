import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const changelogPath = path.join(root, 'CHANGELOG.md')
const pkgPath = path.join(root, 'package.json')

const changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : ''
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : { version: 'dev' }

const lines = changelog.split(/\r?\n/)
const latestHeaderIndex = lines.findIndex((line) => /^##\s+v/.test(line))
const latestSection = []
if (latestHeaderIndex >= 0) {
  for (let i = latestHeaderIndex; i < lines.length; i++) {
    const line = lines[i]
    if (i > latestHeaderIndex && /^##\s+v/.test(line)) break
    latestSection.push(line)
  }
}

const body = [
  '# DragonHub Release',
  '',
  `## Version ${pkg.version || 'dev'}`,
  '',
  '### Highlights',
  '- Native Windows desktop app with Electron',
  '- Notes, tasks, projects, files, media tools, vault, and network monitor',
  '- Clean Windows installer and portable build',
  '- Improved accessibility, better safety checks, and more reliable data handling',
  '',
  '### What is included',
  '- DragonHub-Setup-*-win-x64.exe',
  '- DragonHub-Portable-*-win-x64.exe',
  '',
  '### Changelog',
  '',
  latestSection.length ? latestSection.join('\n').trim() : 'No changelog entries found.',
  '',
  '---',
  '',
  '### Installation',
  '1. Download the setup installer or portable build.',
  '2. Run the installer on Windows 10/11 x64.',
  '3. Launch DragonHub and follow the welcome flow.',
  '',
  '### Notes',
  '- This release is built for Windows 10/11 x64.',
  '- Portable build is convenient for testing or moving between devices.',
  '-',
].join('\n')

process.stdout.write(body)
