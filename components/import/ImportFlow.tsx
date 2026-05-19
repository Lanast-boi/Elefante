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
  imported:  number   // new contacts created
  enriched:  number   // existing contacts that had empty fields filled
  skipped:   number   // no-name rows + no-new-info duplicates + user-unchecked rows
  failed:    number   // unexpected errors
}

// ── Field auto-detection ───────────────────────────────────────────────────────

function autoDetect(headers: string[]): Mapping {
  const lower = (h: string) => h.toLowerCase().trim()
  const find  = (kw: string[]) => headers.find(h => kw.includes(lower(h)))
  return {
    name:           find(['name', 'full name', 'fullname', 'contact name', 'person']),
    // Google Contacts exports: "E-mail 1 - Value", "E-mail 2 - Value"
    email:          find(['email', 'e-mail', 'email address',
                          'e-mail 1 - value', 'e-mail 2 - value']),
    // Google Contacts exports: "Phone 1 - Value", "Phone 2 - Value", "Mobile Phone"
    phone:          find(['phone', 'telephone', 'mobile', 'cell', 'phone number',
                          'phone 1 - value', 'phone 2 - value', 'mobile phone']),
    // Google Contacts exports: "Organization 1 - Name"
    company:        find(['company', 'organization', 'organisation', 'employer', 'firm',
                          'organization 1 - name', 'organisation 1 - name']),
    // Google Contacts exports: "Organization 1 - Title", "Occupation"
    role:           find(['role', 'title', 'job title', 'position', 'job',
                          'organization 1 - title', 'organisation 1 - title', 'occupation']),
    city:           find(['city', 'location', 'town']),
    origin_country: find(['origin country', 'country', 'nationality', 'country of origin', 'home country']),
    origin_city:    find(['origin city', 'hometown', 'city of origin', 'home city']),
    how_we_met:     find(['how we met', 'how_we_met', 'source', 'where met']),
    // Google Contacts exports: "Group Membership"
    tags:           find(['tags', 'tag', 'labels', 'category', 'categories', 'group membership']),
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
// Keys (checked most → least reliable):
//   li:<linkedin>  — stripped protocol/www/trailing slash
//   em:<email>     — lowercased
//   ph:<phone>     — digits only (stripped formatting)
//   nc:<name>|<company> — lowercased, collapsed whitespace

type DedupeRecord = {
  name:         string
  email:        string | null
  phone:        string | null
  linkedin_url: string | null
  company:      string | null
}

// Full existing-contact shape fetched for enrichment decisions
type ExistingContact = DedupeRecord & {
  id:   string
  role: string | null
  city: string | null
}

function normLi(url: string | null | undefined): string {
  if (!url?.trim()) return ''
  return url.toLowerCase().trim()
    .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}

function normEmail(email: string | null | undefined): string {
  return email?.toLowerCase().trim() ?? ''
}

function normPhone(phone: string | null | undefined): string {
  if (!phone?.trim()) return ''
  // Strip all formatting; keep digits and a leading +
  const stripped = phone.trim().replace(/[\s\-\.\(\)]/g, '')
  if (stripped.length < 7) return ''   // too short to be a real number
  return stripped.toLowerCase()
}

function normStr(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
}

function dedupeKeys(r: DedupeRecord): string[] {
  const keys: string[] = []
  const li = normLi(r.linkedin_url)
  const em = normEmail(r.email)
  const ph = normPhone(r.phone)
  if (li) keys.push(`li:${li}`)
  if (em) keys.push(`em:${em}`)
  if (ph) keys.push(`ph:${ph}`)
  keys.push(`nc:${normStr(r.name)}|${normStr(r.company)}`)
  return keys
}

// Map<key → ExistingContact> for O(1) match lookup that also returns WHICH contact matched.
// First contact encountered for each key wins (handles rare multi-contact key collisions).
function buildDedupeMap(existing: ExistingContact[]): Map<string, ExistingContact> {
  const map = new Map<string, ExistingContact>()
  for (const c of existing) {
    for (const k of dedupeKeys(c)) {
      if (!map.has(k)) map.set(k, c)
    }
  }
  return map
}

// Secondary name-only lookup — used as a FALLBACK when primary keys (linkedin, email,
// phone, name+company) all miss. Safe because we only match when the normalized name
// is unique across all existing contacts.
//
// If two existing contacts share the same normalized name the value is set to 'ambiguous'
// and that name will never be used for auto-matching, preventing false merges.
function buildNameOnlyMap(existing: ExistingContact[]): Map<string, ExistingContact | 'ambiguous'> {
  const map = new Map<string, ExistingContact | 'ambiguous'>()
  for (const c of existing) {
    const key = normStr(c.name)
    if (!key) continue
    if (map.has(key)) {
      map.set(key, 'ambiguous')   // multiple contacts share this name → never auto-match
    } else {
      map.set(key, c)
    }
  }
  return map
}

// ── Enrichment helpers ─────────────────────────────────────────────────────────
// Conservative: only fill fields that are empty/null in the existing contact.
// Protected fields (name, familiarity, how_we_met, follow_up_*, personal_context,
// notes) are intentionally absent from this list and cannot be touched.

const ENRICHABLE_FIELDS = ['phone', 'email', 'company', 'role', 'linkedin_url', 'city'] as const
type EnrichableField = typeof ENRICHABLE_FIELDS[number]

function computeEnrichFields(existing: ExistingContact, incoming: ContactRow): EnrichableField[] {
  return ENRICHABLE_FIELDS.filter(field => {
    const existingVal = existing[field as keyof ExistingContact] as string | null | undefined
    const incomingVal = incoming[field as keyof ContactRow] as string | null | undefined
    return !existingVal && !!incomingVal   // existing is empty, import has data
  })
}

// ── Review row ─────────────────────────────────────────────────────────────────

interface ReviewRow {
  row:             ContactRow
  isDuplicate:     boolean
  matchedContact:  ExistingContact | null   // null for intra-file dups
  enrichFields:    EnrichableField[]        // [] → "Already complete" or intra-file dup
  checked:         boolean                  // true for new + enrichable; false otherwise
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
  const router   = useRouter()

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
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const validCount = parsed && mapping.name
    ? parsed.rows.filter(r => (r[mapping.name!] ?? '').trim().length > 0).length
    : 0

  // ── Build review rows (map → review) ──────────────────────────────────────
  // Fetches all existing contacts, runs dedupe + enrichment analysis.

  const handleReview = async () => {
    if (!parsed || !mapping.name) return
    setError(null)
    setLoadingReview(true)

    const allRows = parsed.rows
      .map(row => buildContactRow(row, mapping, defaults))
      .filter(row => row.name.length > 0)

    setNoNameSkipped(parsed.rows.length - allRows.length)

    // Fetch ALL existing contacts for deduplication, paging past Supabase's 1,000-row limit.
    // Without batching, a database with > 1,000 contacts would silently miss some contacts,
    // causing those to be classified as "new" instead of matches for enrichment.
    const BATCH_SIZE = 1000
    const allExisting: ExistingContact[] = []
    let fetchFrom = 0
    let fetchErr = null

    while (true) {
      const { data: batch, error: batchErr } = await supabase
        .from('contacts')
        .select('id, name, email, phone, linkedin_url, company, role, city')
        .range(fetchFrom, fetchFrom + BATCH_SIZE - 1)

      if (batchErr) { fetchErr = batchErr; break }
      if (!batch || batch.length === 0) break

      allExisting.push(...(batch as ExistingContact[]))

      if (batch.length < BATCH_SIZE) break
      fetchFrom += BATCH_SIZE
    }

    if (fetchErr) {
      console.error('[Import] Failed to fetch contacts for dedupe:', fetchErr)
      setError(`Could not check for duplicates: ${(fetchErr as { message: string }).message}`)
      setLoadingReview(false)
      return
    }

    const existingContacts = allExisting
    const dedupeMap    = buildDedupeMap(existingContacts)
    const nameOnlyMap  = buildNameOnlyMap(existingContacts)
    const seenInFile   = new Set<string>()  // grows as rows are processed

    const rows: ReviewRow[] = allRows.map(row => {
      const keys = dedupeKeys(row as DedupeRecord)

      // ── Primary match: linkedin, email, phone, name+company ─────────────
      let matchedContact: ExistingContact | null = null
      for (const k of keys) {
        const m = dedupeMap.get(k)
        if (m) { matchedContact = m; break }
      }

      // ── Secondary match: unique normalized name (fallback) ───────────────
      // Used only when primary keys all miss AND the name is unique in the DB.
      // This catches the common case where LinkedIn and Google contacts have
      // the same person under different company names.
      if (!matchedContact) {
        const nameKey  = normStr(row.name)
        const nameHit  = nameOnlyMap.get(nameKey)
        if (nameHit && nameHit !== 'ambiguous') {
          matchedContact = nameHit
        }
      }

      // ── Intra-file duplicate check ───────────────────────────────────────
      const isIntraFileDup = !matchedContact && keys.some(k => seenInFile.has(k))
      const isDuplicate    = !!matchedContact || isIntraFileDup

      // Register keys so later rows in the file see this one as taken
      for (const k of keys) seenInFile.add(k)

      const enrichFields = matchedContact ? computeEnrichFields(matchedContact, row) : []

      // ── Diagnostic logging (temporary — remove when stable) ─────────────
      console.log('[Import Review]', row.name, {
        importedPhone:   row.phone,
        importedEmail:   row.email,
        importedCompany: row.company,
        importedLinkedin: row.linkedin_url,
        dedupeKeys:      keys,
        primaryMatch:    matchedContact?.name ?? null,
        matchedPhone:    matchedContact?.phone ?? null,
        matchedCompany:  matchedContact?.company ?? null,
        enrichFields,
        isDuplicate,
        isIntraFileDup,
      })

      // Default checked state:
      //   new contact               → checked (will create)
      //   matched + can enrich      → checked (will enrich)
      //   matched + no new info     → unchecked (skip)
      //   intra-file dup            → unchecked (skip)
      const checked = !isDuplicate || (!!matchedContact && enrichFields.length > 0)

      return { row, isDuplicate, matchedContact, enrichFields, checked }
    })

    setReviewRows(rows)
    setLoadingReview(false)
    setStep('review')
  }

  // ── Execute import from review step ───────────────────────────────────────
  // Separates rows into: create, enrich (by existing contact id), skip.
  // Enrichment is deduplicated by id — if the same existing contact appears
  // multiple times in the file, it is only updated once.

  const handleImport = async () => {
    setError(null)
    setStep('importing')

    const toCreate: ContactRow[] = []
    const enrichById = new Map<string, Record<string, unknown>>()   // id → patch
    let dupSkipped = 0
    let usrSkipped = 0

    for (const item of reviewRows) {
      if (!item.checked) {
        if (item.isDuplicate) dupSkipped++
        else                  usrSkipped++
        continue
      }

      if (!item.isDuplicate) {
        // Brand-new contact
        toCreate.push(item.row)
      } else if (item.matchedContact && item.enrichFields.length > 0) {
        // Enrich existing contact — deduplicated by id
        if (!enrichById.has(item.matchedContact.id)) {
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
          for (const field of item.enrichFields) {
            const val = (item.row as Record<string, unknown>)[field]
            if (val) patch[field] = val
          }
          enrichById.set(item.matchedContact.id, patch)
        }
      } else {
        // Checked but nothing to do (intra-file dup or no enrichable fields)
        dupSkipped++
      }
    }

    // ── 1. Insert new contacts ─────────────────────────────────────────────
    let inserted = 0
    if (toCreate.length > 0) {
      const { error: insertErr } = await supabase.from('contacts').insert(toCreate)
      if (insertErr) {
        console.error('[Import] Insert error:', insertErr)
        setError(insertErr.message)
        setStep('review')   // preserve checkbox state
        return
      }
      inserted = toCreate.length
    }

    // ── 2. Enrich existing contacts ────────────────────────────────────────
    // Each update is a separate call that only touches the patch fields.
    // On error: log and continue — partial enrichment is better than none.
    let enriched = 0
    for (const [id, patch] of enrichById) {
      const { error: updateErr } = await supabase
        .from('contacts')
        .update(patch)
        .eq('id', id)
      if (updateErr) {
        console.error('[Import] Enrich error for contact', id, updateErr)
      } else {
        enriched++
      }
    }

    setResult({
      imported: inserted,
      enriched,
      skipped:  noNameSkipped + usrSkipped + dupSkipped,
      failed:   0,
    })
    setStep('done')
  }

  // ── Review row helpers ─────────────────────────────────────────────────────

  const toggleRow = (i: number) =>
    setReviewRows(prev => prev.map((r, idx) => idx === i ? { ...r, checked: !r.checked } : r))

  const selectAll = () =>
    setReviewRows(prev => prev.map(r => ({ ...r, checked: true })))

  // Enrich-only: check new + check enrichable matches; uncheck no-new-info
  const enrichOnly = () =>
    setReviewRows(prev => prev.map(r => ({
      ...r,
      checked: !r.isDuplicate || (!!r.matchedContact && r.enrichFields.length > 0),
    })))

  const skipAll = () =>
    setReviewRows(prev => prev.map(r => ({ ...r, checked: false })))

  // Derived counts
  const newCount        = reviewRows.filter(r => !r.isDuplicate).length
  const canEnrichCount  = reviewRows.filter(r => r.isDuplicate && r.matchedContact && r.enrichFields.length > 0).length
  const noNewInfoCount  = reviewRows.filter(r => r.isDuplicate && r.enrichFields.length === 0).length
  const checkedCount    = reviewRows.filter(r => r.checked).length

  // ── Done ───────────────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    const parts: string[] = []
    if (result.imported > 0) parts.push(`${result.imported} contact${result.imported !== 1 ? 's' : ''} created`)
    if (result.enriched > 0) parts.push(`${result.enriched} enriched`)
    if (result.skipped  > 0) parts.push(`${result.skipped} skipped`)
    if (result.failed   > 0) parts.push(`${result.failed} failed`)
    const summary = parts.join(' · ') || 'Nothing to import'

    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-10 text-center">
        <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-5 text-2xl">✓</div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          {result.imported === 0 && result.enriched === 0 ? 'Nothing new to import' : 'Import complete'}
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

      {/* ── Preview ──────────────────────────────────────────────────────── */}
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
                    <th key={h} className="px-4 py-2.5 text-left font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap border-b border-zinc-100 dark:border-zinc-800">{h}</th>
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
            <button onClick={() => { setStep('upload'); setParsed(null) }} className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">← Back</button>
            <button onClick={() => setStep('map')} className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors">Continue →</button>
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
            <FieldMapper headers={parsed.headers} mapping={mapping} onChange={setMapping} defaults={defaults} onDefaultsChange={setDefaults} />
          </div>
          <div className="px-6 py-4 flex items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-800 flex-wrap">
            <button onClick={() => setStep('preview')} className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">← Back</button>
            <div className="flex items-center gap-3">
              {!mapping.name && <p className="text-xs text-zinc-400">Map "Name" to continue</p>}
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
          {/* Header: counts + bulk actions */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm px-5 py-4 mb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {/* Live summary */}
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{checkedCount}</span> ready
                {noNameSkipped > 0 && <> · <span className="text-zinc-400">{noNameSkipped}</span> skipped (no name)</>}
              </p>
              {/* Bulk controls */}
              <div className="flex items-center gap-1">
                <button onClick={selectAll}  className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Select all</button>
                {(canEnrichCount > 0 || noNewInfoCount > 0) && (
                  <button onClick={enrichOnly} className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Enrich only</button>
                )}
                <button onClick={skipAll} className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Skip all</button>
              </div>
            </div>

            {/* Stats pills */}
            {(newCount > 0 || canEnrichCount > 0 || noNewInfoCount > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {newCount > 0 && (
                  <span className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full px-2.5 py-0.5">{newCount} new</span>
                )}
                {canEnrichCount > 0 && (
                  <span className="text-xs bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 rounded-full px-2.5 py-0.5">{canEnrichCount} can enrich</span>
                )}
                {noNewInfoCount > 0 && (
                  <span className="text-xs bg-zinc-50 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded-full px-2.5 py-0.5">{noNewInfoCount} no new info</span>
                )}
              </div>
            )}
          </div>

          {/* Row cards */}
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pb-1">
            {reviewRows.map((item, i) => {
              const isNew        = !item.isDuplicate
              const canEnrich    = item.isDuplicate && item.matchedContact && item.enrichFields.length > 0
              const noNewInfo    = item.isDuplicate && item.enrichFields.length === 0

              return (
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

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{item.row.name}</span>

                      {/* Status badge */}
                      {canEnrich && (
                        <span className="flex-shrink-0 text-xs bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 rounded-full px-2 py-px">
                          Can enrich
                        </span>
                      )}
                      {noNewInfo && item.matchedContact && (
                        <span className="flex-shrink-0 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-full px-2 py-px">
                          Already complete
                        </span>
                      )}
                      {noNewInfo && !item.matchedContact && (
                        <span className="flex-shrink-0 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-full px-2 py-px">
                          Duplicate in file
                        </span>
                      )}
                    </div>

                    {/* Role / company */}
                    {(item.row.role || item.row.company) && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 truncate">
                        {[item.row.role, item.row.company].filter(Boolean).join(' · ')}
                      </p>
                    )}

                    {/* For enrichable matches: show what will be added */}
                    {canEnrich && item.enrichFields.length > 0 && (
                      <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">
                        Adds: {item.enrichFields.map(f => {
                          const labels: Record<string, string> = {
                            phone: 'phone', email: 'email', company: 'company',
                            role: 'role', linkedin_url: 'LinkedIn', city: 'city',
                          }
                          return labels[f] ?? f
                        }).join(', ')}
                      </p>
                    )}

                    {/* For new rows: LinkedIn URL preview */}
                    {isNew && item.row.linkedin_url && (
                      <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-0.5 truncate">
                        {item.row.linkedin_url.replace(/^https?:\/\/(www\.)?/i, '')}
                      </p>
                    )}

                    {/* For new rows: phone preview */}
                    {isNew && item.row.phone && (
                      <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-0.5">{item.row.phone}</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 pt-4">
            <button onClick={() => setStep('map')} className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">← Back</button>
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
