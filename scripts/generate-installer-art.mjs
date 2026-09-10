// Branded NSIS installer artwork for DragonHub.
// Outputs (24-bit BMP, required sizes by NSIS MUI):
//   build/installerHeader.bmp  (150x57  — top strip on every installer page)
//   build/installerSidebar.bmp (164x314 — left panel on welcome/finish pages)
// Design: dark vertical gradient in app-theme colors + centered dragon mark
// taken from the official artwork. No fonts needed (logo only).
// Usage: npm run icons:installer  (chained into `npm run icons`)
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const SRC = path.join(root, 'dragonhub-logo.webp')
const OUT_HEADER = path.join(root, 'build', 'installerHeader.bmp')
const OUT_SIDEBAR = path.join(root, 'build', 'installerSidebar.bmp')

// App theme gradient stops (top -> bottom).
const TOP = [24, 30, 54] // #181e36
const BOTTOM = [11, 13, 20] // #0b0d14
const ACCENT = [59, 130, 246] // #3b82f6 (thin accent line)

function gradientRow(y, h) {
  const t = h <= 1 ? 0 : y / (h - 1)
  return [0, 1, 2].map((c) => Math.round(TOP[c] + (BOTTOM[c] - TOP[c]) * t))
}

function encodeBmp24(width, height, rgbTopDown) {
  // rgbTopDown: Buffer of width*height*3 (R,G,B), rows top-down.
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelData = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 3 // BMP is bottom-up
    const dstRow = y * rowSize
    for (let x = 0; x < width; x++) {
      pixelData[dstRow + x * 3] = rgbTopDown[srcRow + x * 3 + 2] // B
      pixelData[dstRow + x * 3 + 1] = rgbTopDown[srcRow + x * 3 + 1] // G
      pixelData[dstRow + x * 3 + 2] = rgbTopDown[srcRow + x * 3] // R
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(54 + pixelData.length, 2)
  header.writeUInt32LE(54, 10) // pixel offset
  header.writeUInt32LE(40, 14) // DIB size
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26) // planes
  header.writeUInt16LE(24, 28) // bpp
  return Buffer.concat([header, pixelData])
}

async function renderArt(width, height, logoHeightRatio) {
  // 1. Gradient background.
  const bg = Buffer.alloc(width * height * 3)
  const glowCx = width / 2
  const glowCy = height * 0.42
  const glowR = Math.max(width, height) * 0.55
  for (let y = 0; y < height; y++) {
    const base = gradientRow(y, height)
    for (let x = 0; x < width; x++) {
      const dx = (x - glowCx) / glowR
      const dy = (y - glowCy) / glowR
      const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy))
      const o = (y * width + x) * 3
      for (let c = 0; c < 3; c++) {
        bg[o + c] = Math.min(255, Math.round(base[c] + (ACCENT[c] - base[c]) * glow * 0.28))
      }
    }
  }
  // 2. Dragon mark (trimmed artwork, composited centered with alpha).
  const logoH = Math.round(height * logoHeightRatio)
  const logo = await sharp(SRC).trim().resize({ height: logoH }).png().toBuffer()
  const { data, info } = await sharp(logo).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
  const ox = Math.round((width - info.width) / 2)
  const oy = Math.round((height - info.height) / 2)
  for (let y = 0; y < info.height; y++) {
    const ty = oy + y
    if (ty < 0 || ty >= height) continue
    for (let x = 0; x < info.width; x++) {
      const tx = ox + x
      if (tx < 0 || tx >= width) continue
      const si = (y * info.width + x) * 4
      const a = data[si + 3] / 255
      if (a <= 0) continue
      const di = (ty * width + tx) * 3
      for (let c = 0; c < 3; c++) bg[di + c] = Math.round(data[si + c] * a + bg[di + c] * (1 - a))
    }
  }
  // 3. Thin accent line at the bottom edge.
  for (let x = 0; x < width; x++) {
    const o = ((height - 1) * width + x) * 3
    bg[o] = ACCENT[0]; bg[o + 1] = ACCENT[1]; bg[o + 2] = ACCENT[2]
  }
  return encodeBmp24(width, height, bg)
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`Missing source artwork: ${SRC}`)
  fs.writeFileSync(OUT_HEADER, await renderArt(150, 57, 0.8))
  fs.writeFileSync(OUT_SIDEBAR, await renderArt(164, 314, 0.34))
  console.log(`wrote ${path.relative(root, OUT_HEADER)}`)
  console.log(`wrote ${path.relative(root, OUT_SIDEBAR)}`)
}

main().catch((e) => {
  console.error('[generate-installer-art]', e?.message || e)
  process.exit(1)
})
