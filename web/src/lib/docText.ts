/**
 * Reads the text out of a document in the browser, for "Fill from a document".
 * Table cells are separated by tabs and paragraphs by blank lines, so the server can tell labels from answers.
 */

export const DOC_ACCEPT = '.pdf,.docx,.txt,.md,.csv'
export const DOC_MAX_MB = 20

export async function extractText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.size > DOC_MAX_MB * 1024 * 1024) throw new Error(`That file is larger than ${DOC_MAX_MB} MB.`)
  if (ext === 'pdf') return pdfText(file)
  if (ext === 'docx') return docxText(file)
  if (ext === 'txt' || ext === 'md') return file.text()
  if (ext === 'csv') return csvText(await file.text())
  if (ext === 'doc') throw new Error('Old Word files (.doc) can’t be read. Open it in Word and save it as .docx or PDF.')
  throw new Error('Use a PDF, Word (.docx) or text file.')
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  let doc
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise }
  catch (e) { throw new Error(e instanceof Error && e.name === 'PasswordException' ? 'That PDF is password protected. Remove the password and try again.' : 'That PDF could not be opened.') }

  const pages: string[] = []
  for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    type Item = { str: string; x: number; y: number; w: number; h: number }
    const items: Item[] = []
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 10 })
    }
    // Group into lines by height on the page, top to bottom
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: { y: number; low: number; h: number; items: Item[] }[] = []
    for (const it of items) {
      // Some tolerance keeps table cells that wrap onto two lines on the same row as their label
      const tol = (l: { h: number }) => Math.max(2, Math.min(l.h, it.h) * 0.6)
      const line = lines.find(l => it.y <= l.y + tol(l) && it.y >= l.low - tol(l))
      if (line) { line.items.push(it); line.low = Math.min(line.low, it.y) } else lines.push({ y: it.y, low: it.y, h: it.h, items: [it] })
    }
    lines.sort((a, b) => b.y - a.y)
    const out: string[] = []
    let prev: { y: number; h: number } | null = null
    for (const line of lines) {
      line.items.sort((a, b) => Math.round(a.x / 3) - Math.round(b.x / 3) || b.y - a.y)
      let text = ''
      let end = -Infinity
      for (const it of line.items) {
        const gap = it.x - end
        // A negative gap means the next line of a wrapped cell in the same column
        if (text) text += gap > it.h * 2 ? '\t' : (gap > it.h * 0.15 || gap < -1) && !text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : ''
        text += it.str
        end = Math.max(end, it.x + it.w)
      }
      if (prev && prev.y - line.y > Math.max(prev.h, line.h) * 1.9) out.push('')
      out.push(text.trim())
      prev = line
    }
    pages.push(out.join('\n'))
  }
  return pages.join('\n\n')
}

async function docxText(file: File): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate')
  let xml: string
  try {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: f => f.name === 'word/document.xml' })
    xml = strFromU8(files['word/document.xml'])
  } catch { throw new Error('That Word file could not be opened.') }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const body = doc.getElementsByTagName('w:body')[0]
  if (!body) throw new Error('That Word file could not be read.')

  const para = (p: Element): string => {
    let s = ''
    const walk = (el: Element) => {
      for (const c of Array.from(el.children)) {
        if (c.tagName === 'w:t') s += c.textContent ?? ''
        else if (c.tagName === 'w:tab') s += '\t'
        else if (c.tagName === 'w:br' || c.tagName === 'w:cr') s += '\n'
        else walk(c)
      }
    }
    walk(p)
    return s
  }
  const out: string[] = []
  const block = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.tagName === 'w:p') {
        const t = para(c).trim()
        out.push(t)
      } else if (c.tagName === 'w:tbl') {
        out.push('')
        for (const row of Array.from(c.getElementsByTagName('w:tr'))) {
          const cells = Array.from(row.children).filter(x => x.tagName === 'w:tc')
            .map(tc => Array.from(tc.getElementsByTagName('w:p')).map(para).map(x => x.trim()).filter(Boolean).join(' '))
          if (cells.some(Boolean)) out.push(cells.join('\t'))
        }
        out.push('')
      } else if (c.tagName === 'w:sdt' || c.tagName === 'w:sdtContent' || c.tagName === 'w:customXml') block(c)
    }
  }
  block(body)
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

function csvText(raw: string): string {
  return raw.split(/\r?\n/).map(line => {
    const cells: string[] = []
    let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (ch === ',' && !q) { cells.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cells.push(cur.trim())
    return cells.filter(Boolean).join('\t')
  }).join('\n')
}
