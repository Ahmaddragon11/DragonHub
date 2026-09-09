// Minimal, safe Markdown -> HTML renderer (no raw HTML passthrough; everything escaped)
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function inline(s: string): string {
  let out = esc(s)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~(.+?)~~/g, '<del>$1</del>')
  out = out.replace(/==(.+?)==/g, '<mark>$1</mark>')
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-ext>$1</a>')
  out = out.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" data-ext>$2</a>')
  return out
}
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let list: 'ul' | 'ol' | null = null
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null } }
  while (i < lines.length) {
    const l = lines[i]
    if (/^```/.test(l)) {
      closeList()
      const lang = l.slice(3).trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      html.push(`<pre><code class="lang-${esc(lang)}">${esc(buf.join('\n'))}</code></pre>`)
      i++; continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l)
    if (h) { closeList(); html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }
    if (/^(-{3,}|\*{3,})$/.test(l.trim())) { closeList(); html.push('<hr/>'); i++; continue }
    if (/^>\s?/.test(l)) { closeList(); html.push(`<blockquote>${inline(l.replace(/^>\s?/, ''))}</blockquote>`); i++; continue }
    const task = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(l)
    if (task) {
      if (list !== 'ul') { closeList(); list = 'ul'; html.push('<ul class="list-none !ps-0">') }
      html.push(`<li><input type="checkbox" disabled ${task[1] !== ' ' ? 'checked' : ''}/>${task[1] !== ' ' ? '<del>' : ''}${inline(task[2])}${task[1] !== ' ' ? '</del>' : ''}</li>`)
      i++; continue
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(l)
    if (ul) { if (list !== 'ul') { closeList(); list = 'ul'; html.push('<ul>') } html.push(`<li>${inline(ul[1])}</li>`); i++; continue }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(l)
    if (ol) { if (list !== 'ol') { closeList(); list = 'ol'; html.push('<ol>') } html.push(`<li>${inline(ol[1])}</li>`); i++; continue }
    if (/^\|.*\|$/.test(l.trim()) && i + 1 < lines.length && /^\|[\s:-|]+\|$/.test(lines[i + 1].trim())) {
      closeList()
      const cells = (r: string) => r.trim().slice(1, -1).split('|').map((c) => inline(c.trim()))
      html.push('<table><thead><tr>' + cells(l).map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>')
      i += 2
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { html.push('<tr>' + cells(lines[i]).map((c) => `<td>${c}</td>`).join('') + '</tr>'); i++ }
      html.push('</tbody></table>'); continue
    }
    if (l.trim() === '') { closeList(); i++; continue }
    closeList()
    html.push(`<p>${inline(l)}</p>`)
    i++
  }
  closeList()
  return html.join('\n')
}
