'use client'
import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Contact } from '@/lib/types'

export type BusinessCardScannerProps = {
  onExtract: (fields: Partial<Contact>) => void
}

type Phase = 'idle' | 'processing' | 'review' | 'error'
type ProcessingLabel = 'loading' | 'reading' | 'parsing'

// ── Deterministic OCR parser ───────────────────────────────────────────────────
// Used as a fallback when the AI step is unavailable or returns nothing useful.
// Heuristics only — fields are suggestions for the user to review.

function parseCard(rawText: string): Partial<Contact> {
  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 1)

  const result: Partial<Contact> = {}
  const usedLines = new Set<string>()

  // Email — unambiguous pattern
  const emailMatch = rawText.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/)
  if (emailMatch) {
    result.email = emailMatch[0].toLowerCase()
    const emailLine = lines.find(l => l.includes(emailMatch[0]))
    if (emailLine) usedLines.add(emailLine)
  }

  // Phone — common international formats; must have 7–15 digits
  const phoneRe = /(?:\+\d{1,3}[\s\-.]?)?\(?\d{3,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}(?:[\s\-.]?\d{1,4})?/
  const phoneMatch = rawText.match(phoneRe)
  if (phoneMatch) {
    const cleaned = phoneMatch[0].trim()
    const digits = (cleaned.match(/\d/g) ?? []).length
    if (digits >= 7 && digits <= 15) {
      result.phone = cleaned
      const phoneLine = lines.find(l => l.includes(phoneMatch[0].trim()))
      if (phoneLine) usedLines.add(phoneLine)
    }
  }

  // Role / title — keyword match
  const roleKeywords = [
    'ceo', 'cto', 'coo', 'cmo', 'cfo', 'cso', 'chro', 'cpo',
    'founder', 'co-founder', 'cofounder',
    'director', 'managing director',
    'manager', 'product manager', 'project manager', 'account manager',
    'engineer', 'software engineer', 'lead engineer', 'senior engineer',
    'developer', 'designer', 'architect', 'researcher',
    'consultant', 'senior consultant',
    'advisor', 'board advisor',
    'president', 'vice president', 'vp ', 'svp ', 'evp ',
    'head of', 'partner', 'general partner', 'managing partner',
    'analyst', 'business analyst', 'executive',
    'specialist', 'coordinator', 'associate',
    'sales', 'business development', 'account executive',
  ]

  const roleLine = lines.find(line => {
    const low = line.toLowerCase()
    return (
      !usedLines.has(line) &&
      roleKeywords.some(kw => low.includes(kw)) &&
      line.length < 80 &&
      !line.includes('@') &&
      !/^\d/.test(line) &&
      !/^\+/.test(line)
    )
  })
  if (roleLine) {
    result.role = roleLine
    usedLines.add(roleLine)
  }

  // Name — 2–4 title-case words, no numbers, not already matched
  const nameRe = /^[A-ZÀ-Ö][a-zA-Zà-ö\-]+(?:\s[A-ZÀ-Ö][a-zA-Zà-ö\-]+){1,3}$/
  const nameLine = lines.find(line =>
    nameRe.test(line) &&
    !usedLines.has(line) &&
    !line.includes('@') &&
    !/\d/.test(line) &&
    line.split(/\s+/).length >= 2 &&
    line.split(/\s+/).length <= 4
  )
  if (nameLine) {
    result.name = nameLine
    usedLines.add(nameLine)
  }

  // Company — prefer ALL-CAPS lines (common on cards), then early unlabelled lines
  const remaining = lines.filter(l => !usedLines.has(l))

  const allCapsLine = remaining.find(line =>
    line === line.toUpperCase() &&
    /[A-Z]/.test(line) &&
    line.length >= 2 &&
    line.length <= 60 &&
    !/^[+\d\s\-().]+$/.test(line) &&
    !/^https?:/i.test(line) &&
    !/^www\./i.test(line) &&
    !line.includes('@')
  )

  if (allCapsLine) {
    result.company = allCapsLine
      .split(' ')
      .map(w => w.charAt(0) + w.slice(1).toLowerCase())
      .join(' ')
    usedLines.add(allCapsLine)
  } else {
    const companyLine = remaining.find(line =>
      line.length >= 3 &&
      line.length <= 60 &&
      !/^[+\d\s\-().]+$/.test(line) &&
      !/^https?:/i.test(line) &&
      !/^www\./i.test(line) &&
      !line.includes('@') &&
      lines.indexOf(line) <= 4
    )
    if (companyLine) result.company = companyLine
  }

  return result
}

// ── AI parser — calls the Supabase Edge Function ───────────────────────────────
// Returns null on any error so callers always have a safe fallback.
// The image is never sent — only the raw OCR text string.

async function parseWithAI(rawText: string): Promise<Partial<Contact> | null> {
  try {
    const { data, error } = await supabase.functions.invoke<Record<string, string>>(
      'parse-business-card',
      { body: { rawText: rawText.slice(0, 2000) } },
    )

    if (error || !data) return null

    // Validate: accept only truthy string values for the known fields
    const clean: Partial<Contact> = {}
    if (data.name?.trim())    clean.name    = data.name.trim()
    if (data.email?.trim())   clean.email   = data.email.toLowerCase().trim()
    if (data.phone?.trim())   clean.phone   = data.phone.trim()
    if (data.company?.trim()) clean.company = data.company.trim()
    if (data.role?.trim())    clean.role    = data.role.trim()
    if (data.city?.trim())    clean.city    = data.city.trim()

    return Object.keys(clean).length > 0 ? clean : null
  } catch {
    return null
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const FIELD_LABELS: Partial<Record<keyof Contact, string>> = {
  name:    'Name',
  email:   'Email',
  phone:   'Phone',
  company: 'Company',
  role:    'Role',
  city:    'City',
}

// City is included here and in FIELD_LABELS so AI-extracted city is shown in review.
const DISPLAYED_FIELDS: (keyof Contact)[] = ['name', 'email', 'phone', 'company', 'role', 'city']

function hasAnyField(fields: Partial<Contact>): boolean {
  return DISPLAYED_FIELDS.some(k => fields[k])
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BusinessCardScanner({ onExtract }: BusinessCardScannerProps) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [processingLabel, setProcessingLabel] = useState<ProcessingLabel>('loading')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [extracted, setExtracted] = useState<Partial<Contact>>({})
  const [parsedByAI, setParsedByAI] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setPhase('idle')
    setProcessingLabel('loading')
    setImageUrl(null)
    setExtracted({})
    setParsedByAI(false)
    setErrorMsg('')
  }

  const close = () => {
    reset()
    setOpen(false)
  }

  const processImage = async (file: File) => {
    const url = URL.createObjectURL(file)
    setImageUrl(url)
    setPhase('processing')
    setProcessingLabel('loading')

    try {
      // ── Step 1: OCR ──────────────────────────────────────────────────────────
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setProcessingLabel('reading')
        },
      })
      setProcessingLabel('reading')
      const { data: { text: rawText } } = await worker.recognize(file)
      await worker.terminate()

      // ── Step 2: AI parsing → silent fallback to deterministic ─────────────
      setProcessingLabel('parsing')
      const aiFields = await parseWithAI(rawText)
      const usedAI = aiFields !== null && hasAnyField(aiFields)
      const fields: Partial<Contact> = usedAI ? aiFields! : parseCard(rawText)

      if (!hasAnyField(fields)) {
        setErrorMsg("Couldn't find recognisable contact fields. Try a clearer photo with good lighting.")
        setPhase('error')
        return
      }

      setExtracted(fields)
      setParsedByAI(usedAI)
      setPhase('review')
    } catch (err) {
      console.error('[BusinessCardScanner]', err)
      setErrorMsg('Something went wrong while reading the card. Please try again.')
      setPhase('error')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    processImage(file)
  }

  const handleApply = () => {
    onExtract(extracted)
    close()
  }

  // ── Trigger button (collapsed) ─────────────────────────────────────────────

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        <CameraIcon />
        Scan business card
      </button>
    )
  }

  // ── Scanner panel ─────────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60 p-5 mb-2">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
          Scan business card
        </span>
        <button
          type="button"
          onClick={close}
          className="-m-2 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          aria-label="Close scanner"
        >
          <XIcon />
        </button>
      </div>

      {/* ── Idle: capture options ── */}
      {phase === 'idle' && (
        <>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 py-4 text-sm text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500 active:bg-zinc-50 dark:active:bg-zinc-700 transition-colors"
            >
              <CameraIcon />
              Take a photo
            </button>
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 py-4 text-sm text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500 active:bg-zinc-50 dark:active:bg-zinc-700 transition-colors"
            >
              <UploadIcon />
              Upload image
            </button>
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-3 text-center leading-relaxed">
            Works best with a clear, well-lit photo.<br />
            Fields are suggestions — you can edit before saving.
          </p>

          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
          <input ref={uploadRef} type="file" accept="image/*"                        onChange={handleFileChange} className="hidden" />
        </>
      )}

      {/* ── Processing ── */}
      {phase === 'processing' && (
        <>
          {imageUrl && <CardImage src={imageUrl} />}

          <div className="flex items-start gap-3 mt-4">
            <SpinnerIcon />
            <div>
              {processingLabel === 'loading' && (
                <>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-snug">Loading OCR engine…</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">First use downloads ~2 MB of language data.</p>
                </>
              )}
              {processingLabel === 'reading' && (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Reading card…</p>
              )}
              {processingLabel === 'parsing' && (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Parsing fields…</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Review: extracted fields ── */}
      {phase === 'review' && (
        <>
          {imageUrl && <CardImage src={imageUrl} />}

          <dl className="mt-4 space-y-2.5">
            {DISPLAYED_FIELDS.map(key => {
              const value = extracted[key]
              if (!value) return null
              return (
                <div key={key} className="flex gap-3 min-w-0">
                  <dt className="text-xs text-zinc-400 dark:text-zinc-500 w-16 shrink-0 leading-5">
                    {FIELD_LABELS[key]}
                  </dt>
                  <dd className="text-sm text-zinc-700 dark:text-zinc-300 min-w-0 break-words leading-5">
                    {String(value)}
                  </dd>
                </div>
              )
            })}
          </dl>

          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-4 mb-3 leading-relaxed">
            {parsedByAI
              ? 'Parsed with AI — review and edit before saving.'
              : 'Auto-detected — review and edit before saving.'
            }
          </p>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleApply}
              className="rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium px-5 py-2.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 active:scale-[0.98] transition-all"
            >
              Apply to form
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors py-2.5"
            >
              Try again
            </button>
          </div>
        </>
      )}

      {/* ── Error ── */}
      {phase === 'error' && (
        <>
          {imageUrl && <CardImage src={imageUrl} />}
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-4 leading-relaxed">{errorMsg}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            Try again
          </button>
        </>
      )}
    </div>
  )
}

// ── Shared image preview ──────────────────────────────────────────────────────

function CardImage({ src }: { src: string }) {
  return (
    <div className="w-full rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800" style={{ aspectRatio: '7/4' }}>
      <img src={src} alt="Business card" className="w-full h-full object-contain" />
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" className="w-4 h-4 shrink-0 mt-0.5 animate-spin" aria-hidden="true">
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  )
}
