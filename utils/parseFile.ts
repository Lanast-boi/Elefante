import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export type ParsedRow = Record<string, string>

export interface ParseResult {
  headers: string[]
  rows: ParsedRow[]
}

export async function parseFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCSV(file)
  if (name.match(/\.xlsx?$/)) return parseExcel(file)
  throw new Error('Unsupported file type. Please upload a .csv or .xlsx file.')
}

function parseCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete(results) {
        const headers = results.meta.fields ?? []
        const rows = results.data.map(row => {
          const cleaned: ParsedRow = {}
          headers.forEach(h => { cleaned[h] = (row[h] ?? '').toString().trim() })
          return cleaned
        })
        resolve({ headers, rows })
      },
      error(err: { message: string }) { reject(new Error(err.message)) },
    })
  })
}

async function parseExcel(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
  if (data.length < 2) return { headers: [], rows: [] }
  const [headerRow, ...bodyRows] = data
  const headers = headerRow.map((h: unknown) => String(h).trim()).filter(Boolean)
  const rows = bodyRows
    .filter((row: unknown[]) => row.some(cell => String(cell).trim() !== ''))
    .map((row: unknown[]) => {
      const obj: ParsedRow = {}
      headers.forEach((h, i) => { obj[h] = String(row[i] ?? '').trim() })
      return obj
    })
  return { headers, rows }
}
