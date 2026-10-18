// Branded NSIS installer artwork for DragonHub.
// Outputs (24-bit BMP, required sizes by NSIS MUI):
//   build/installerHeader.bmp    (150x57  — top strip on every installer page)
//   build/installerSidebar.bmp   (164x314 — left panel on welcome/finish pages)
//   build/uninstallerSidebar.bmp (164x314 — left panel in the uninstaller)
// Design: deep app-theme gradient with diagonal brand beams (cyan/violet/pink),
// ambient corner glows, a micro-dot grid and a glow halo behind the dragon mark
// taken from the official artwork. No fonts needed (logo only, with alpha).
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
const OUT_UNINSTALLER = path.join(root, 'build', 'uninstallerSidebar.bmp')

// App theme gradient stops (top -> bottom) and brand hues used around the UI.
const TOP = [26, 32, 62] // #1a203e
const BOTTOM = [10, 12, 20] // #0a0c14
const CYAN = [34, 211, 238] // #22d3ee
const VIOLET = [167, 139, 250] // #a78bfa
const PINK = [244, 114, 182] // #f472b6

function gradientRow(y, h) {
  const t = h <= 1 ? 0 : y / (h - 1)
  return [0, 1, 2].map((c) => Math.round(TOP[c] + (BOTTOM[c] - TOP[c]) * t))
}

/** Symmetric gaussian bump used for the soft diagonal light beams. */
function gauss(v, center, spread) {
  const d = (v - center) / spread
  return Math.exp(-0.5 * d * d)
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

async function renderArt(width, height, logoHeightRatio, grid = false) {
  const diag = Math.sqrt(width * width + height * height)
  const logoH = Math.max(18, Math.round(height * logoHeightRatio))
  const logoCx = width / 2
  const logoCy = height / 2
  const haloR = logoH * 1.25

  // 1. Layered background: gradient + diagonal beams + corner glows + vignette.
  const bg = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const base = gradientRow(y, height)
    for (let x = 0; x < width; x++) {
      const beamT = (x * 0.86 + y * 0.5) / diag
      const beam1 = gauss(beamT, 0.3, 0.15) * 0.14
      const beam2 = gauss(beamT, 0.72, 0.2) * 0.12
      const glowCyan = Math.max(0, 1 - Math.hypot((x - width * 0.16) / (diag * 0.5), (y - height * 0.18) / (diag * 0.5)))
      const glowPink = Math.max(0, 1 - Math.hypot((x - width * 0.88) / (diag * 0.45), (y - height * 0.94) / (diag * 0.45)))
      const nx = (x - width / 2) / (width / 2)
      const ny = (y - height / 2) / (height / 2)
      const edge = Math.min(1, Math.sqrt(nx * nx + ny * ny) / Math.SQRT2)
      const vignette = 1 - 0.32 * Math.pow(edge, 1.6)
      const halo = Math.max(0, 1 - Math.hypot((x - logoCx) / haloR, (y - logoCy) / haloR)) ** 2 * 0.3
      const dot = grid && x % 6 === 2 && y % 6 === 2 ? 7 : 0
      const o = (y * width + x) * 3
      for (let c = 0; c < 3; c++) {
        const lit = base[c] + CYAN[c] * beam1 + PINK[c] * beam2 +
          CYAN[c] * glowCyan * 0.3 + PINK[c] * glowPink * 0.22 + VIOLET[c] * halo + dot
        bg[o + c] = Math.max(0, Math.min(255, Math.round(lit * vignette)))
      }
    }
  }

  // 2. Dragon mark (trimmed artwork, composited centered with alpha).
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

  // 3. Two-pixel brand accent line along the bottom edge (cyan -> violet -> pink).
  for (let y = height - 2; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = width <= 1 ? 0 : x / (width - 1)
      const a = t < 0.5 ? CYAN : VIOLET
      const b = t < 0.5 ? VIOLET : PINK
      const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5
      const o = (y * width + x) * 3
      for (let c = 0; c < 3; c++) bg[o + c] = Math.round(a[c] + (b[c] - a[c]) * k)
    }
  }

  return encodeBmp24(width, height, bg)
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`Missing source artwork: ${SRC}`)
  fs.writeFileSync(OUT_HEADER, await renderArt(150, 57, 0.62))
  const sidebar = await renderArt(164, 314, 0.3, true)
  fs.writeFileSync(OUT_SIDEBAR, sidebar)
  fs.writeFileSync(OUT_UNINSTALLER, sidebar)
  console.log(`wrote ${path.relative(root, OUT_HEADER)}`)
  console.log(`wrote ${path.relative(root, OUT_SIDEBAR)}`)
  console.log(`wrote ${path.relative(root, OUT_UNINSTALLER)}`)
}

main().catch((e) => {
  console.error('[generate-installer-art]', e?.message || e)
  process.exit(1)
})
