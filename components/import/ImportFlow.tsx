'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { parseFile, ParseResult, ParsedRow } from '@/utils/parseFile'
import FieldMapper, { Defaults, ElefeKey, Mapping } from './FieldMapper'

type Step = 'upload' | 'preview' | 'map' | 'importing' | 'done'
interface ImportResult { imported: number; skipped: number }

// Try to auto-detect which file column maps to each Elefante field
function autoDetect(headers: string[]): Mapping {
  const lower = (h: string) => h.toLowerCase().trim()
  const find = (kw: string[]) => headers.find(h => kw.includes(lower(h)))
  return {
    name: find(['name', 'full name', 'fullname', 'contact name', 'person']),
    email: find(['email', 'e-mail', 'email address']),
    phone: find(['phone', 'telephone', 'mobile', 'cell', 'phone number']),
    company: find(['company', 'organization', 'organisation', 'employer', 'firm']),
    role: find(['role', 'title', 'job title', 'position', 'job']),
    city: find(['city', 'location', 'town']),
    origin_country: find(['origin country', 'country', 'nationality', 'country of origin', 'home country']),
    origin_city: find(['origin city', 'hometown', 'city of origin', 'home city']),
    how_we_met: find(['how we met', 'how_we_met', 'source', 'where met']),
    tags: find(['tags', 'tag', 'labels', 'category', 'categories']),
    linkedin_url: find(['linkedin', 'linkedin url', 'linkedin_url', 'linkedin profile', 'profile url', 'linkedin link']),
  }
}

function buildContactRow(row: ParsedRow, mapping: Mapping, defaults: Defaults) {
  const get = (key: ElefeKey) => {
    const col = mapping[key]
    return col ? (row[col] ?? '').trim() : ''
  }
  return {
    name: get('name'),
    company: get('company') || null,
    role: get('role') || null,
    city: get('city') || null,
    origin_country: get('origin_country') || null,
    origin_city: get('origin_city') || null,
    how_we_met: get('how_we_met') || defaults.how_we_met.trim() || null,
    tags: get('tags') || null,
    email: get('email') || null,
    phone: get('phone') || null,
    linkedin_url: get('linkedin_url') || null,
    familiarity: 1,
    updated_at: new Date().toISOString(),
  }
}

export default function ImportFlow() {
  const [step, setStep] = useState<Step>('upload')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [defaults, setDefaults] = useState<Defaults>({ how_we_met: 'LinkedIn' })
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const handleFile = async (file: File) => {
    setError(null)
    try {
      const res = await parseFile(file)
      if (res.headers.length === 0) {
        setError('No columns found. Make sure the first row contains column headers.')
        return
      }
      setParsed(res)
      setMapping(autoDetect(res.headers))
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read file.')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  // Count rows that would actually be imported (have a name)
  const validCount = parsed && mapping.name
    ? parsed.rows.filter(r => (r[mapping.name!] ?? '').trim().length > 0).length
    : 0

  const handleImport = async () => {
    if (!parsed || !mapping.name) return
    setError(null)
    setStep('importing')

    const rows = parsed.rows
      .map(row => buildContactRow(row, mapping, defaults))
      .filter(row => row.name.length > 0)

    const skipped = parsed.rows.length - rows.length

    const { error: err } = await supabase.from('contacts').insert(rows)
    if (err) {
      setError(err.message)
      setStep('map')
      return
    }

    setResult({ imported: rows.length, skipped })
    setStep('done')
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-10 text-center">
        <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center mx-auto mb-5 text-2xl">
          ✓
        </div>
        <h2 className="text-xl font-semibold text-zinc-900 mb-1">Import complete</h2>
        <p className="text-sm text-zinc-400 mb-8">
          {result.imported} contact{result.imported !== 1 ? 's' : ''} imported
          {result.skipped > 0 && (
            <> · {result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped (no name)</>
          )}
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button
            onClick={() => router.push('/')}
            className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
          >
            View Contacts
          </button>
          <button
            onClick={() => { setStep('upload'); setParsed(null); setResult(null); setMapping({}) }}
            className="rounded-xl border border-zinc-200 px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Import another file
          </button>
        </div>
      </div>
    )
  }

  // ── Importing ────────────────────────────────────────────────────────────────
  if (step === 'importing') {
    return (
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-10 text-center">
        <p className="text-sm text-zinc-400">Importing contacts…</p>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ── Upload ─────────────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-16 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-zinc-400 bg-zinc-50'
              : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50/50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
          <p className="text-base font-medium text-zinc-700 mb-1">Drop your file here</p>
          <p className="text-sm text-zinc-400 mb-5">or click to browse</p>
          <p className="text-xs text-zinc-300">Supports .csv and .xlsx</p>
        </div>
      )}

      {/* ── Preview ────────────────────────────────────────────────────────── */}
      {step === 'preview' && parsed && (
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-900">
                {parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''} detected
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">Showing first 20 · {parsed.headers.length} columns</p>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-50">
                  {parsed.headers.map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-medium text-zinc-500 whitespace-nowrap border-b border-zinc-100">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 20).map((row, i) => (
                  <tr key={i} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                    {parsed.headers.map(h => (
                      <td key={h} className="px-4 py-2.5 text-zinc-700 whitespace-nowrap max-w-[200px] truncate">
                        {row[h] || <span className="text-zinc-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 flex items-center justify-between gap-3 border-t border-zinc-100">
            <button
              onClick={() => { setStep('upload'); setParsed(null) }}
              className="text-sm text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep('map')}
              className="rounded-xl bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Map ────────────────────────────────────────────────────────────── */}
      {step === 'map' && parsed && (
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm">
          <div className="px-6 py-5 border-b border-zinc-100">
            <p className="text-sm font-medium text-zinc-900">Map columns to Elefante fields</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Name is required. Everything else is optional.
            </p>
          </div>

          <div className="px-6 py-5">
            <FieldMapper
              headers={parsed.headers}
              mapping={mapping}
              onChange={setMapping}
              defaults={defaults}
              onDefaultsChange={setDefaults}
            />
          </div>

          <div className="px-6 py-4 flex items-center justify-between gap-3 border-t border-zinc-100 flex-wrap">
            <button
              onClick={() => setStep('preview')}
              className="text-sm text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              ← Back
            </button>
            <div className="flex items-center gap-3">
              {!mapping.name && (
                <p className="text-xs text-zinc-400">Map "Name" to continue</p>
              )}
              <button
                onClick={() => void handleImport()}
                disabled={!mapping.name || validCount === 0}
                className="rounded-xl bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Import {validCount} contact{validCount !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
