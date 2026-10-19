interface PositionedText {
  str: string
  x: number
  y: number
  width: number
  size: number
}

/** Groups positioned text into visual lines (top to bottom), separating distant columns with a wide gap. */
export function layoutLines(items: PositionedText[]): string[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: PositionedText[][] = []
  for (const item of sorted) {
    const row = rows.at(-1)
    if (row && Math.abs(row[0].y - item.y) <= Math.max(2, Math.min(row[0].size, item.size) * 0.5)) row.push(item)
    else rows.push([item])
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x)
    let line = ''
    let end = -Infinity
    for (const item of row) {
      const gap = item.x - end
      if (line) line += gap > item.size * 1.2 ? '   ' : gap > item.size * 0.15 && !/\s$/.test(line) && !/^\s/.test(item.str) ? ' ' : ''
      line += item.str
      end = item.x + item.width
    }
    return line.trim()
  })
}

/** Extracts a PDF's text as visual lines. Throws PDF_PASSWORD_REQUIRED / PDF_PASSWORD_INCORRECT for locked files. */
export async function extractPdfText(data: Uint8Array, password?: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), password, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise
  } catch (e) {
    const err = e as { name?: string; code?: number }
    if (err.name === 'PasswordException') throw new Error(err.code === 2 ? 'PDF_PASSWORD_INCORRECT' : 'PDF_PASSWORD_REQUIRED')
    throw new Error('Could not read this PDF. It may be damaged or not a real PDF file.')
  }
  try {
    const pages: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const items: PositionedText[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        const [a, b, , , x, y] = item.transform as number[]
        items.push({ str: item.str, x, y, width: item.width, size: Math.hypot(a, b) || item.height || 10 })
      }
      pages.push(layoutLines(items).join('\n'))
    }
    return pages.join('\n')
  } finally {
    await doc.destroy()
  }
}
