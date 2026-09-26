/**
 * Tiny subsequence fuzzy matcher (≈ fzf-lite) — no dependency.
 * Scores consecutive runs, word-boundary hits and prefix matches higher, and
 * returns matched character indices for highlighting. Case/diacritic-insensitive
 * for Latin; Arabic is matched as-is (with tatweel/diacritics stripped).
 */
export interface FuzzyResult { score: number; indices: number[] }

const AR_MARKS = /[\u064B-\u065F\u0670\u0640]/g
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(AR_MARKS, '').toLowerCase()

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = norm(query.trim())
  if (!q) return { score: 0, indices: [] }
  const t = norm(target)
  // Fast path: plain substring gets a strong, contiguous score.
  const sub = t.indexOf(q)
  if (sub !== -1) {
    const boundary = sub === 0 || /[\s\-_/.:]/.test(t[sub - 1])
    return { score: 1000 - sub + (boundary ? 200 : 0) + (sub === 0 ? 300 : 0) - t.length * 0.5, indices: Array.from({ length: q.length }, (_, i) => sub + i) }
  }
  let ti = 0, score = 0, run = 0
  const indices: number[] = []
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    if (ch === ' ') continue
    let found = -1
    while (ti < t.length) { if (t[ti] === ch) { found = ti; break } ti++ }
    if (found === -1) return null
    const boundary = found === 0 || /[\s\-_/.:]/.test(t[found - 1])
    run = indices.length && indices[indices.length - 1] === found - 1 ? run + 1 : 0
    score += 10 + run * 15 + (boundary ? 25 : 0) - Math.min(20, found - (indices[indices.length - 1] ?? -1))
    indices.push(found)
    ti = found + 1
  }
  // Reject weak, widely-scattered matches (noise) — require on average a
  // boundary or consecutive hit per query char.
  const final = score - t.length * 0.5
  if (q.replace(/ /g, '').length >= 3 && final < q.length * 12) return null
  return { score: final, indices }
}

/** Splits `text` into highlighted/unhighlighted parts for rendering. */
export function highlightParts(text: string, indices: number[]): { s: string; hit: boolean }[] {
  if (!indices.length) return [{ s: text, hit: false }]
  const set = new Set(indices)
  const out: { s: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.s += text[i]
    else out.push({ s: text[i], hit })
  }
  return out
}
