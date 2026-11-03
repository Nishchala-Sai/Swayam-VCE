// Shared by the staff spreadsheets (the Registrations tab and All students): sorting, India-time formatting, the .xlsx
// download and copying phone numbers for WhatsApp.
import { useMemo, useState } from 'react'

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: filename }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 3 Nov, 9:15 pm in India time
export const istShort = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : ''

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }) // 2026-11-03

// rows sorted by the column the user clicked; columns: [{ key, sortValue?: (row) => value }]
export function useSorted(rows, columns, initial) {
  const [sort, setSort] = useState(initial)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const value = col.sortValue ?? ((r) => r[col.key])
    const dir = sort.dir === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      if (x == null || x === '') return 1 // empty cells last either way
      if (y == null || y === '') return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * dir
    })
  }, [rows, columns, sort])
  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))
  return { sorted, sort, toggle }
}

// sheets: [{ name, columns: [{ header, width, value: (row) => any, type?: 'date' | 'number' }], rows }]
// Dates are written as real Excel dates showing India time. Text cells stay text (phone numbers keep every digit,
// and nothing a student typed is run as a formula).
export async function downloadWorkbook(sheets, title) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const cell = (type, v) => {
    if (v == null || v === '') return null
    if (type === 'date') return { value: new Date(new Date(v).getTime() + 330 * 60e3), type: Date, format: 'dd mmm yyyy hh:mm' }
    if (type === 'number') return { value: Number(v), type: Number }
    return { value: String(v), type: String }
  }
  const blob = await writeXlsxFile(
    sheets.map((s) => ({
      sheet: s.name.slice(0, 31), // Excel's limit for sheet names
      columns: s.columns.map((c) => ({ width: c.width ?? 14 })),
      stickyRowsCount: 1,
      stickyColumnsCount: 1,
      data: [
        s.columns.map((c) => ({ value: c.header, fontWeight: 'bold', backgroundColor: '#FFE2B8' })),
        ...s.rows.map((r) => s.columns.map((c) => cell(c.type, c.value(r)))),
      ],
    })),
    { fontFamily: 'Calibri', fontSize: 11 },
  ).toBlob()
  saveBlob(blob, `${title} ${today()}.xlsx`.replace(/[\\/:*?"<>|]/g, ''))
}

// Copies the phone numbers of these rows, one per line with +91, for pasting into WhatsApp. Resolves to the count.
export async function copyPhones(rows) {
  const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))].map((p) => `+91${p}`)
  if (!phones.length) return 0
  await navigator.clipboard.writeText(phones.join('\n'))
  return phones.length
}
