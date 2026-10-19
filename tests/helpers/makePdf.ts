/** Builds a minimal text-only PDF. Each page is a list of [x, y, text] using 10pt Helvetica on a US Letter page. */
export function makePdf(pages: [number, number, string][][]): Uint8Array {
  const objects: string[] = []
  const fontId = 3
  const pageIds = pages.map((_, i) => 4 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  pages.forEach((items, i) => {
    const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`)
    const stream = items.map(([x, y, s]) => `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${esc(s)}) Tj ET`).join('\n')
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`
    objects[pageIds[i] + 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1')
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

/** Lays out a statement as rows of columns: [x, text] pairs at successive y positions from the top. */
export function statementPage(rows: [number, string][][]): [number, number, string][] {
  return rows.flatMap((cols, i) => cols.map(([x, s]) => [x, 740 - i * 14, s] as [number, number, string]))
}
