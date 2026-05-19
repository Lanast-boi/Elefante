'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { parseFile, ParseResult, ParsedRow } from '@/utils/parseFile'
import FieldMapper, { Defaults, ElefeKey, Mapping } from './FieldMapper'

// ── Step machine ───────────────────────────────────────────────────────────────
// upload → preview → map → review → importing → done
type Step = 'upload' | 'preview' | 'map' | 'review' | 'importing' | 'done'

interface ImportResult {
  imported:   number
  skipped:    number   // no-name rows + user-manually-unchecked non-duplicates
  duplicates: number   // rows detected as duplicates (left unchecked)
  failed:     number   // unexpected insert errors
}

// ── Field auto-detection ───────────────────────────────────────────────────────

function autoDetect(headers: string[]): Mapping {
  const lower = (h: string) => h.toLowerCase().trim()
  const find  = (kw: string[]) => headers.find(h => kw.includes(lower(h)))
  return {
    name:           find(['name', 'full name', 'fullname', 'contact name', 'person']),
    email:          find(['email', 'e-mail', 'email address']),
    phone:          find(['phone', 'telephone', 'mobile', 'cell', 'phone number']),
    company:        find(['company', 'organization', 'organisation', 'employer', 'firm']),
    role:           find(['role', 'title', 'job title', 'position', 'job']),
    city:           find(['city', 'location', 'town']),
    origin_country: find(['origin country', 'country', 'nationality', 'country of origin', 'home country']),
    origin_city:    find(['origin city', 'hometown', 'city of origin', 'home city']),
    how_we_met:     find(['how we met', 'how_we_met', 'source', 'where met']),
    tags:           find(['tags', 'tag', 'labels', 'category', 'categories']),
    linkedin_url:   find(['linkedin', 'linkedin url', 'linkedin_url', 'linkedin profile', 'profile url', 'linkedin link']),
  }
}

function buildContactRow(row: ParsedRow, mapping: Mapping, defaults: Defaults) {
  const get = (key: ElefeKey) => {
    const col = mapping[key]
    return col ? (row[col] ?? '').trim() : ''
  }
  return {
    name:           get('name'),
    company:        get('company')        || null,
    role:           get('role')           || null,
    city:           get('city')           || null,
    origin_country: get('origin_country') || null,
    origin_city:    get('origin_city')    || null,
    how_we_met:     get('how_we_met')     || defaults.how_we_met.trim() || null,
    tags:           get('tags')           || null,
    email:          get('email')          || null,
    phone:          get('phone')          || null,
    linkedin_url:   get('linkedin_url')   || null,
    familiarity:    1,
    updated_at:     new Date().toISOString(),
  }
}

type ContactRow = ReturnType<typeof buildContactRow>

// ── Dedupe helpers ─────────────────────────────────────────────────────────────
// Each record is represented by a small set of normalized lookup keys.
// A row is a duplicate if ANY of its keys already appear in the dedupe set.
//
// Key types (checked in order, most → least reliable):
//   li:<linkedin>        — stripped of protocol / www / trailing slash
//   em:<email>           — lowercased
//   nc:<name>|<company>  — lowercased, whitespace-collapsed

type DedupeRecord = {
  name:         string
  email:        string | null
  linkedin_url: string | null
  company:      string | null
}

function normLi(url: string | null | undefined): string {
  if (!url?.trim()) return ''
  return url.toLowerCase().trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')
}

function normEmail(email: string | null | undefined): string {
  return email?.toLowerCase().trim() ?? ''
}

function normStr(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
}

function dedupeKeys(r: DedupeRecord): string[] {
  const keys: string[] = []
  const li = normLi(r.linkedin_url)
  const em = normEmail(r.email)
  if (li) keys.push(`li:${li}`)
  if (em) keys.push(`em:${em}`)
  keys.push(`nc:${normStr(r.name)}|${normStr(r.company)}`)
  return keys
}

function buildDedupeSet(existing: DedupeRecord[]): Set<string> {
  const set = new Set<string>()
  for (const c of existing) for (const k of dedupeKeys(c)) set.add(k)
  return set
}

// ── Review row ─────────────────────────────────────────────────────────────────
// Wraps a built ContactRow with UI state for the review step.

interface ReviewRow {
  row:         ContactRow
  isDuplicate: boolean
  checked:     boolean   // false by default for duplicates; user can override
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImportFlow() {
  const [step,          setStep]          = useState<Step>('upload')
  const [parsed,        setParsed]        = useState<ParseResult | null>(null)
  const [mapping,       setMapping]       = useState<Mapping>({})
  const [defaults,      setDefaults]      = useState<Defaults>({ how_we_met: 'LinkedIn' })
  const [result,        setResult]        = useState<ImportResult | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [dragging,      setDragging]      = useState(false)
  const [reviewRows,    setReviewRows]    = useState<ReviewRow[]>([])
  const [noNameSkipped, setNoNameSkipped] = useState(0)
  const [loadingReview, setLoadingReview] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // ── File handling ──────────────────────────────────────────────────────────

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

  // Count rows with a name (displayed on the map step button)
  const validCount = parsed && mapping.name
    ? parsed.rows.filter(r => (r[mapping.name!] ?? '').trim().length > 0).length
    : 0

  // ── Build review rows (map → review) ──────────────────────────────────────
  // Fetches existing contacts from Supabase, runs dedupe, then shows review.

  const handleReview = async () => {
    if (!parsed || !mapping.name) return
    setError(null)
    setLoadingReview(true)

    // Build candidate rows (must have a name)
    const allRows = parsed.rows
      .map(row => buildContactRow(row, mapping, defaults))
      .filter(row => row.name.length > 0)

    setNoNameSkipped(parsed.rows.length - allRows.length)

    // Fetch existing contacts for deduplication
    const { data: existing, error: fetchErr } = await supabase
      .from('contacts')
      .select('name, email, linkedin_url, company')

    if (fetchErr) {
      console.error('[Import] Failed to fetch contacts for dedupe:', fetchErr)
      setError(`Could not check for duplicates: ${fetchErr.message}`)
      setLoadingReview(false)
      return
    }

    // Build dedupe set from existing, then grow it with each accepted row
    // so intra-file duplicates are also caught.
    const dedupeSet  = buildDedupeSet((existing ?? []) as DedupeRecord[])
    const seenInFile = new Set<string>()

    const rows: ReviewRow[] = allRows.map(row => {
      const keys        = dedupeKeys(row as DedupeRecord)
      const isDuplicate = keys.some(k => dedupeSet.has(k) || seenInFile.has(k))
      // Register keys so later rows in the file see this one as existing
      if (!isDuplicate) for (const k of keys) seenInFile.add(k)
      return { row, isDuplicate, checked: !isDuplicate }
    })

    setReviewRows(rows)
    setLoadingReview(false)
    setStep('review')
  }

  // ── Insert from review step ────────────────────────────────────────────────

  const handleImport = async () => {
    setError(null)
    setStep('importing')

    const toInsert   = reviewRows.filter(r =>  r.checked).map(r => r.row)
    const dupSkipped = reviewRows.filter(r => !r.checked &&  r.isDuplicate).length
    const usrSkipped = reviewRows.filter(r => !r.checked && !r.isDuplicate).length

    if (toInsert.length === 0) {
      setResult({ imported: 0, skipped: noNameSkipped + usrSkipped, duplicates: dupSkipped, failed: 0 })
      setStep('done')
      return
    }

    const { error: insertErr } = await supabase.from('contacts').insert(toInsert)
    if (insertErr) {
      console.error('[Import] Insert error:', insertErr)
      setError(insertErr.message)
      setStep('review')   // keep selections intact, let user retry
      return
    }

    setResult({ imported: toInsert.length, skipped: noNameSkipped + usrSkipped, duplicates: dupSkipped, failed: 0 })
    setStep('done')
  }

  // ── Review row helpers ─────────────────────────────────────────────────────

  const toggleRow = (i: number) =>
    setReviewRows(prev => prev.map((r, idx) => idx === i ? { ...r, checked: !r.checked } : r))

  const selectAll = () =>
    setReviewRows(prev => prev.map(r => ({ ...r, checked: true })))

  const skipDuplicates = () =>
    setReviewRows(prev => prev.map(r => ({ ...r, checked: !r.isDuplicate })))

  // Derived counts for the review header
  const checkedCount  = reviewRows.filter(r =>  r.checked).length
  const dupCount      = reviewRows.filter(r =>  r.isDuplicate).length
  const readyCount    = reviewRows.filter(r => !r.isDuplicate).length

  // ── Done ───────────────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    const parts: string[] = []
    if (result.imported   > 0) parts.push(`${result.imported} contact${result.imported !== 1 ? 's' : ''} imported`)
    if (result.duplicates > 0) parts.push(`${result.duplicates} duplicate${result.duplicates !== 1 ? 's' : ''} skipped`)
    if (result.skipped    > 0) parts.push(`${result.skipped} row${result.skipped !== 1 ? 's' : ''} skipped`)
    if (result.failed     > 0) parts.push(`${result.failed} failed`)
    const summary = parts.join(' · ') || 'Nothing to import'

    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-10 text-center">
        <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-5 text-2xl">
          ✓
        </div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          {result.imported === 0 && result.duplicates > 0 ? 'Nothing new to import' : 'Import complete'}
        </h2>
        <p className="text-sm text-zinc-400 mb-8">{summary}</p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button
            onClick={() => router.push('/')}
            className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 py-2.5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
          >
            View Contacts
          </button>
          <button
            onClick={() => { setStep('upload'); setParsed(null); setResult(null); setMapping({}); setReviewRows([]) }}
            className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Import another file
          </button>
        </div>
      </div>
    )
  }

  // ── Importing ──────────────────────────────────────────────────────────────
  if (step === 'importing') {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-10 text-center">
        <p className="text-sm text-zinc-400">Importing contacts…</p>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── Upload ───────────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-16 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-zinc-400 bg-zinc-50 dark:bg-zinc-900/60'
              : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
          <p className="text-base font-medium text-zinc-700 dark:text-zinc-300 mb-1">Drop your file here</p>
          <p className="text-sm text-zinc-400 mb-5">or click to browse</p>
          <p className="text-xs text-zinc-300 dark:text-zinc-600">Supports .csv and .xlsx</p>
        </div>
      )}

      {/* ── Preview (raw data table) ──────────────────────────────────────── */}
      {step === 'preview' && parsed && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''} detected
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">Showing first 20 · {parsed.headers.length} columns</p>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                  {parsed.headers.map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap border-b border-zinc-100 dark:border-zinc-800">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 20).map((row, i) => (
                  <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                    {parsed.headers.map(h => (
                      <td key={h} className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300 whitespace-nowrap max-w-[200px] truncate">
                        {row[h] || <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 flex items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              onClick={() => { setStep('upload'); setParsed(null) }}
              className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep('map')}
              className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Map ──────────────────────────────────────────────────────────── */}
      {step === 'map' && parsed && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm">
          <div className="px-6 py-5 border-b border-zinc-100 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Map columns to Elefante fields</p>
            <p className="text-xs text-zinc-400 mt-0.5">Name is required. Everything else is optional.</p>
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

          <div className="px-6 py-4 flex items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-800 flex-wrap">
            <button
              onClick={() => setStep('preview')}
              className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            >
              ← Back
            </button>
            <div className="flex items-center gap-3">
              {!mapping.name && (
                <p className="text-xs text-zinc-400">Map "Name" to continue</p>
              )}
              <button
                onClick={() => void handleReview()}
                disabled={!mapping.name || validCount === 0 || loadingReview}
                className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loadingReview ? 'Loading…' : `Review ${validCount} contact${validCount !== 1 ? 's' : ''} →`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Review ───────────────────────────────────────────────────────── */}
      {step === 'review' && (
        <div>
          {/* Header bar: counts + bulk actions */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm px-5 py-4 mb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {/* Live counts */}
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{checkedCount}</span> ready
                {dupCount > 0 && (
                  <> · <span className="text-amber-500">{dupCount}</span> duplicate{dupCount !== 1 ? 's' : ''}</>
                )}
                {noNameSkipped > 0 && (
                  <> · <span className="text-zinc-400">{noNameSkipped}</span> skipped (no name)</>
                )}
              </p>

              {/* Bulk controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={selectAll}
                  className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Select all
                </button>
                {dupCount > 0 && (
                  <button
                    onClick={skipDuplicates}
                    className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Skip duplicates
                  </button>
                )}
              </div>
            </div>

            {/* Compact stats pills */}
            {(readyCount > 0 || dupCount > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {readyCount > 0 && (
                  <span className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full px-2.5 py-0.5">
                    {readyCount} new
                  </span>
                )}
                {dupCount > 0 && (
                  <span className="text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 rounded-full px-2.5 py-0.5">
                    {dupCount} already in Elefante
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Row cards — scrollable */}
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pb-1">
            {reviewRows.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleRow(i)}
                className={`w-full text-left flex items-start gap-3 rounded-2xl border px-4 py-3.5 transition-all ${
                  item.checked
                    ? 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                    : 'bg-zinc-50/70 dark:bg-zinc-900/40 border-zinc-100 dark:border-zinc-800 opacity-60 hover:opacity-80'
                }`}
              >
                {/* Checkbox */}
                <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  item.checked
                    ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100'
                    : 'border-zinc-300 dark:border-zinc-600'
                }`}>
                  {item.checked && (
                    <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 text-white dark:text-zinc-900" aria-hidden="true">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>

                {/* Contact info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {item.row.name}
                    </span>
                    {item.isDuplicate && (
                      <span className="flex-shrink-0 text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 rounded-full px-2 py-px">
                        Duplicate
                      </span>
                    )}
                  </div>

                  {(item.row.role || item.row.company) && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 truncate">
                      {[item.row.role, item.row.company].filter(Boolean).join(' · ')}
                    </p>
                  )}

                  {item.row.linkedin_url && (
                    <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-0.5 truncate">
                      {item.row.linkedin_url.replace(/^https?:\/\/(www\.)?/i, '')}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Footer: back + import CTA */}
          <div className="flex items-center justify-between gap-3 pt-4">
            <button
              onClick={() => setStep('map')}
              className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => void handleImport()}
              disabled={checkedCount === 0}
              className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 py-2.5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import {checkedCount} contact{checkedCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
