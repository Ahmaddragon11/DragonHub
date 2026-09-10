// Generates official DragonHub app icons from the source artwork.
// Source:  <repo>/dragonhub-logo.webp  (official dragon "D" artwork, 1920x1920)
// Outputs: build/icon.png   (512x512 PNG — Linux tray / fallback)
//          public/icon.png  (512x512 PNG — renderer favicon + in-app logo, copied to dist/ by Vite)
//          build/icon.ico   (multi-size Windows ICO: 256/128/64/48/32/16, PNG-compressed entries)
// Usage:   npm run icons
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const SRC = path.join(root, 'dragonhub-logo.webp')
const OUT_PNG_BUILD = path.join(root, 'build', 'icon.png')
const OUT_PNG_PUBLIC = path.join(root, 'public', 'icon.png')
const OUT_ICO = path.join(root, 'build', 'icon.ico')

const ICO_SIZES = [256, 128, 64, 48, 32, 16]
const PNG_SIZE = 512
// The source artwork has wide transparent padding (content covers only ~68% of
// the width), which made the desktop icon look small next to other apps.
// Trim the padding and scale the artwork to fill most of the canvas.
const ARTWORK_FILL = 0.94

function buildIco(images) {
  // images: [{ size, data: Buffer(png) }]
  const count = images.length
  const headerSize = 6 + 16 * count
  let offset = headerSize
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  images.forEach((img, i) => {
    const o = 6 + 16 * i
    header.writeUInt8(img.size >= 256 ? 0 : img.size, o) // width (0 = 256)
    header.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1) // height
    header.writeUInt8(0, o + 2) // palette
    header.writeUInt8(0, o + 3) // reserved
    header.writeUInt16LE(1, o + 4) // planes
    header.writeUInt16LE(32, o + 6) // bit depth
    header.writeUInt32LE(img.data.length, o + 8) // bytes
    header.writeUInt32LE(offset, o + 12) // offset
    offset += img.data.length
  })
  return Buffer.concat([header, ...images.map((i) => i.data)])
}

async function fittedArtwork(boxSize) {
  // Trim transparent padding, fit longest side to ARTWORK_FILL of the box,
  // center on a transparent canvas (aspect preserved, nothing clipped).
  const inner = Math.max(8, Math.round(boxSize * ARTWORK_FILL))
  const art = await sharp(SRC).trim().resize(inner, inner, { fit: 'inside' }).png().toBuffer()
  return sharp({ create: { width: boxSize, height: boxSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`Missing source artwork: ${SRC}`)
  fs.mkdirSync(path.dirname(OUT_PNG_BUILD), { recursive: true })
  fs.mkdirSync(path.dirname(OUT_PNG_PUBLIC), { recursive: true })

  // Main PNGs (trimmed + slightly enlarged artwork, keep alpha).
  const png512 = await fittedArtwork(PNG_SIZE)
  fs.writeFileSync(OUT_PNG_BUILD, png512)
  fs.writeFileSync(OUT_PNG_PUBLIC, png512)
  console.log(`wrote ${path.relative(root, OUT_PNG_BUILD)} (${png512.length} bytes)`)
  console.log(`wrote ${path.relative(root, OUT_PNG_PUBLIC)} (${png512.length} bytes)`)

  // ICO entries.
  const entries = []
  for (const s of ICO_SIZES) {
    const data = await fittedArtwork(s)
    entries.push({ size: s, data })
  }
  const ico = buildIco(entries)
  fs.writeFileSync(OUT_ICO, ico)
  console.log(`wrote ${path.relative(root, OUT_ICO)} (${ico.length} bytes, sizes ${ICO_SIZES.join('/')}px)`)
}

main().catch((e) => {
  console.error('[generate-icons]', e?.message || e)
  process.exit(1)
})
