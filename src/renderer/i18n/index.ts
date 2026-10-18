import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en'
import ar from './ar'
import ui from './sections/ui'
import tools from './sections/tools'
import core from './sections/core'
import updatecard from './sections/updatecard'
import capture from './sections/capture'
import home from './sections/home'
import vaultx from './sections/vaultx'
import media from './sections/media'
import ai from './sections/ai'

/** Deep clone so merging never mutates the imported base dictionaries. */
function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => clone(x)) as unknown as T
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = clone(x)
    return o as T
  }
  return v
}

/** Deep merge `extra` into `base` (objects recurse, anything else replaces). */
function merge(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(extra)) {
    const cur = base[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      merge(cur as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      base[k] = clone(v)
    }
  }
  return base
}

const enRes = merge(clone(en) as Record<string, unknown>, ui.en)
merge(enRes, tools.en)
merge(enRes, core.en)
merge(enRes, home.en)
merge(enRes, updatecard.en)
merge(enRes, capture.en)
merge(enRes, vaultx.en)
merge(enRes, media.en)
merge(enRes, ai.en)
const arRes = merge(clone(ar) as Record<string, unknown>, ui.ar)
merge(arRes, tools.ar)
merge(arRes, core.ar)
merge(arRes, home.ar)
merge(arRes, updatecard.ar)
merge(arRes, capture.ar)
merge(arRes, vaultx.ar)
merge(arRes, media.ar)
merge(arRes, ai.ar)

i18n.use(initReactI18next).init({
  resources: { en: { translation: enRes }, ar: { translation: arRes } },
  lng: 'ar',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnObjects: true,
})

export default i18n
