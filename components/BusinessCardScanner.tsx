'use client'
import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Contact } from '@/lib/types'

export type BusinessCardScannerProps = {
  onExtract: (fields: Partial<Contact>) => void
}

type Phase = 'idle' | 'warning' | 'processing' | 'review' | 'error'
type ProcessingLabel = 'scanning' | 'preprocessing' | 'loading' | 'reading' | 'parsing'

// Unified response shape from the edge function
interface EdgeFunctionResponse {
  name?:        string | null
  company?:     string | null
  role?:        string | null
  phone?:       string | null
  email?:       string | null
  website?:     string | null
  city?:        string | null
  country?:     string | null
  confidence?:  number
  source?:      'vision' | 'ocr'
  warnings?:    string[]
}

// ── Image analysis types ───────────────────────────────────────────────────────

// Crop region in original-image pixel coordinates
interface CardBounds { x: number; y: number; w: number; h: number }

interface ImageAnalysis {
  warning: string | null   // non-null = show warning before proceeding
  bounds:  CardBounds | null  // crop region to pass to preprocessForOCR; null = full image
}

// ── Image analysis ─────────────────────────────────────────────────────────────
// Single-pass analysis at 200 px sample width. Returns a warning if the image
// is too dark/blurry/small, and crop bounds for the detected card region.
//
// Algorithm (all in one pixel loop):
//   1. Grayscale + brightness sum for darkness check
//   2. Laplacian (|4c − n − s − e − w|) for blur detection
//      variance of Laplacian: low → blurry, high → sharp
//   3. Edge presence per row/column (|Laplacian| > threshold)
//      → bounding box of edge-active region → crop + card-size ratio

async function analyzeImage(file: File): Promise<ImageAnalysis> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Hard minimum: anything this small is clearly not a proper card photo
      if (img.naturalWidth < 400 || img.naturalHeight < 250) {
        resolve({
          warning: 'The photo looks too small. Move closer so the card fills most of the frame.',
          bounds: null,
        })
        return
      }

      try {
        const SW = 200  // sample width; height is proportional
        const SH = Math.max(1, Math.round(SW * img.naturalHeight / img.naturalWidth))

        const canvas = document.createElement('canvas')
        canvas.width  = SW
        canvas.height = SH
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve({ warning: null, bounds: null }); return }
        ctx.drawImage(img, 0, 0, SW, SH)
        const { data } = ctx.getImageData(0, 0, SW, SH)

        // ── Pass 1: grayscale + brightness sum ───────────────────────────────
        const gray = new Uint8Array(SW * SH)
        let brightnessSum = 0
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          const g = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0
          gray[j] = g
          brightnessSum += g
        }
        const avgBrightness = brightnessSum / (SW * SH)
        if (avgBrightness < 45) {
          resolve({
            warning: 'The photo looks too dark. Try in brighter light or near a window.',
            bounds: null,
          })
          return
        }

        // ── Pass 2: Laplacian — blur score + edge map ────────────────────────
        // lap(x,y) = |4·c − n − s − e − w|  (clamped, inner pixels only)
        //
        // Variance of Laplacian: low → blurry (all values near zero),
        //                        high → sharp (mix of large and small values)
        //
        // Row/column edge presence: count pixels where |lap| > EDGE_THR.
        // If ≥ EDGE_FRAC of the row/column are edge-active, that row/col is "hot".
        // Bounding box of hot rows/cols ≈ card extent.

        const EDGE_THR  = 12    // Laplacian threshold to count as an edge pixel
        const EDGE_FRAC = 0.04  // fraction of row/col that must be hot

        const rowHot = new Uint8Array(SH)
        const colHot = new Uint8Array(SW)

        let lapSum = 0, lapSqSum = 0, lapCount = 0
        const rowEdgeCount = new Int32Array(SH)
        const colEdgeCount = new Int32Array(SW)

        for (let y = 1; y < SH - 1; y++) {
          for (let x = 1; x < SW - 1; x++) {
            const c = gray[y * SW + x]
            const lap = Math.abs(
              4 * c
              - gray[(y - 1) * SW + x]
              - gray[(y + 1) * SW + x]
              - gray[y * SW + (x - 1)]
              - gray[y * SW + (x + 1)],
            )
            lapSum   += lap
            lapSqSum += lap * lap
            lapCount++
            if (lap > EDGE_THR) {
              rowEdgeCount[y]++
              colEdgeCount[x]++
            }
          }
        }

        for (let y = 1; y < SH - 1; y++)
          rowHot[y] = rowEdgeCount[y] > SW * EDGE_FRAC ? 1 : 0
        for (let x = 1; x < SW - 1; x++)
          colHot[x] = colEdgeCount[x] > SH * EDGE_FRAC ? 1 : 0

        const lapMean     = lapSum / lapCount
        const lapVariance = lapSqSum / lapCount - lapMean * lapMean

        // ── Bounding box of hot rows/cols ────────────────────────────────────
        let top = 0, bottom = SH - 1, left = 0, right = SW - 1
        for (let y = 0; y < SH; y++)  if (rowHot[y]) { top    = y; break }
        for (let y = SH - 1; y >= 0; y--) if (rowHot[y]) { bottom = y; break }
        for (let x = 0; x < SW; x++)  if (colHot[x]) { left   = x; break }
        for (let x = SW - 1; x >= 0; x--) if (colHot[x]) { right  = x; break }

        const contentW = Math.max(1, right  - left)
        const contentH = Math.max(1, bottom - top)
        const cardRatio = (contentW * contentH) / (SW * SH)

        // Card occupies less than 30 % of the image → too far away
        if (cardRatio < 0.30) {
          resolve({
            warning: 'Move closer so the card fills more of the frame.',
            bounds: null,
          })
          return
        }

        // Blur check AFTER card-size check (a far-away card gives meaningless blur scores)
        if (lapVariance < 20) {
          resolve({
            warning: 'Photo looks blurry. Hold the phone steady and tap the card to focus.',
            bounds: null,
          })
          return
        }

        // ── Compute crop bounds in original-image coordinates ────────────────
        // Add 3 % padding on each side so we don't clip the card edge.
        const PAD = 0.03
        const padX = SW * PAD
        const padY = SH * PAD
        const sx = img.naturalWidth  / SW
        const sy = img.naturalHeight / SH

        const bounds: CardBounds = {
          x: Math.max(0,                   (left   - padX) * sx),
          y: Math.max(0,                   (top    - padY) * sy),
          w: Math.min(img.naturalWidth,    (right  - left + 2 * padX) * sx),
          h: Math.min(img.naturalHeight,   (bottom - top  + 2 * padY) * sy),
        }

        resolve({ warning: null, bounds })
      } catch {
        // Analysis is best-effort — never block the user on a check failure
        resolve({ warning: null, bounds: null })
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ warning: null, bounds: null })
    }

    img.src = url
  })
}

// ── Canvas preprocessing pipeline ─────────────────────────────────────────────
// 1. Crop to card bounds (if detected) — done in one drawImage call
// 2. Resize to ≤ 1600 px wide for OCR-optimal resolution
// 3. Pass 1: grayscale + find luminance range [lo, hi]
// 4. Pass 2: histogram stretch → [0, 255], then +25 % contrast boost
// 5. Output as PNG (lossless — no JPEG artefacts on text edges)
//
// The user-visible preview always shows the original file, not this processed version.

async function preprocessForOCR(file: File, bounds: CardBounds | null): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        // Source region: use crop bounds if available, otherwise full image
        const srcX = bounds?.x ?? 0
        const srcY = bounds?.y ?? 0
        const srcW = bounds?.w ?? img.naturalWidth
        const srcH = bounds?.h ?? img.naturalHeight

        // Scale the crop region to ≤ 1600 px wide
        const MAX_W = 1600
        const scale = srcW > MAX_W ? MAX_W / srcW : 1
        const dstW  = Math.round(srcW * scale)
        const dstH  = Math.round(srcH * scale)

        const canvas = document.createElement('canvas')
        canvas.width  = dstW
        canvas.height = dstH
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) { reject(new Error('No canvas context')); return }

        // Crop + resize in one drawImage call
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH)

        const id = ctx.getImageData(0, 0, dstW, dstH)
        const d  = id.data
        const n  = dstW * dstH

        // Pass 1 — luminosity grayscale + histogram bounds
        const gray = new Uint8Array(n)
        let lo = 255, hi = 0
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0
          gray[j] = g
          if (g < lo) lo = g
          if (g > hi) hi = g
        }

        const range = hi - lo || 1

        // Pass 2 — histogram stretch + 25 % contrast boost
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          const stretched = ((gray[j] - lo) / range * 255) | 0
          const v = Math.min(255, Math.max(0, ((stretched - 128) * 1.25 + 128) | 0))
          d[i] = d[i + 1] = d[i + 2] = v
          // alpha unchanged
        }

        ctx.putImageData(id, 0, 0)
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
          'image/png',
        )
      } catch (e) {
        reject(e)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image load failed'))
    }

    img.src = url
  })
}

// ── Vision helpers ────────────────────────────────────────────────────────────

// Compress the image (or its cropped region) to a JPEG suitable for Vision.
// Keeps colour — do NOT grayscale here, Claude Vision uses colour information.
// Max 1024 px on the longest side; JPEG 85 % quality ≈ 150–400 KB encoded.
async function compressForVision(
  file: File,
  bounds: CardBounds | null,
): Promise<{ base64: string; mimeType: string } | null> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        const srcX = bounds?.x ?? 0
        const srcY = bounds?.y ?? 0
        const srcW = bounds?.w ?? img.naturalWidth
        const srcH = bounds?.h ?? img.naturalHeight

        const MAX_SIDE = 1024
        const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH))
        const dstW  = Math.round(srcW * scale)
        const dstH  = Math.round(srcH * scale)

        const canvas = document.createElement('canvas')
        canvas.width  = dstW
        canvas.height = dstH
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }

        // Crop + resize; keep full colour for Claude Vision
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH)

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        const base64  = dataUrl.split(',')[1]

        // Safety guard: reject if somehow > 4 MB encoded (Anthropic limit is 5 MB)
        if (!base64 || base64.length > 4 * 1024 * 1024) { resolve(null); return }

        resolve({ base64, mimeType: 'image/jpeg' })
      } catch {
        resolve(null)
      }
    }

    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

// Map a raw EdgeFunctionResponse to Partial<Contact>.
// Fields not present in Contact (website, country, confidence, source, warnings)
// are silently dropped — the user sees only the contact-relevant fields in review.
function edgeResponseToContact(data: EdgeFunctionResponse): Partial<Contact> {
  const clean: Partial<Contact> = {}
  if (data.name?.trim())    clean.name    = data.name.trim()
  if (data.email?.trim())   clean.email   = data.email.toLowerCase().trim()
  if (data.phone?.trim())   clean.phone   = data.phone.trim()
  if (data.company?.trim()) clean.company = data.company.trim()
  if (data.role?.trim())    clean.role    = data.role.trim()
  if (data.city?.trim())    clean.city    = data.city.trim()
  return clean
}

// Call the edge function with the compressed image.
// Returns null on any failure so the caller can fall back to OCR.
async function tryVisionParse(
  file: File,
  bounds: CardBounds | null,
): Promise<Partial<Contact> | null> {
  try {
    const compressed = await compressForVision(file, bounds)
    if (!compressed) return null

    const { data, error } = await supabase.functions.invoke<EdgeFunctionResponse>(
      'parse-business-card',
      { body: { imageBase64: compressed.base64, mimeType: compressed.mimeType } },
    )
    if (error || !data) return null

    // Reject low-confidence or empty results so the OCR fallback gets a chance
    if (typeof data.confidence === 'number' && data.confidence < 0.3) return null

    const fields = edgeResponseToContact(data)
    const hasIdentity = !!(fields.name || fields.company || fields.email || fields.phone)
    return hasIdentity ? fields : null
  } catch {
    return null
  }
}

// ── Deterministic OCR parser (fallback) ───────────────────────────────────────

function parseCard(rawText: string): Partial<Contact> {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 1)
  const result: Partial<Contact> = {}
  const usedLines = new Set<string>()

  const emailMatch = rawText.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/)
  if (emailMatch) {
    result.email = emailMatch[0].toLowerCase()
    const el = lines.find(l => l.includes(emailMatch[0]))
    if (el) usedLines.add(el)
  }

  const phoneRe = /(?:\+\d{1,3}[\s\-.]?)?\(?\d{3,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}(?:[\s\-.]?\d{1,4})?/
  const phoneMatch = rawText.match(phoneRe)
  if (phoneMatch) {
    const cleaned = phoneMatch[0].trim()
    const digits = (cleaned.match(/\d/g) ?? []).length
    if (digits >= 7 && digits <= 15) {
      result.phone = cleaned
      const pl = lines.find(l => l.includes(phoneMatch[0].trim()))
      if (pl) usedLines.add(pl)
    }
  }

  const roleKeywords = [
    'ceo', 'cto', 'coo', 'cmo', 'cfo', 'cso', 'chro', 'cpo',
    'founder', 'co-founder', 'cofounder', 'director', 'managing director',
    'manager', 'product manager', 'project manager', 'account manager',
    'engineer', 'software engineer', 'developer', 'designer', 'architect',
    'consultant', 'advisor', 'president', 'vice president', 'vp ', 'svp ', 'evp ',
    'head of', 'partner', 'general partner', 'analyst', 'executive',
    'specialist', 'coordinator', 'associate', 'sales', 'business development',
  ]
  const roleLine = lines.find(line => {
    const low = line.toLowerCase()
    return !usedLines.has(line) && roleKeywords.some(kw => low.includes(kw)) &&
      line.length < 80 && !line.includes('@') && !/^\d/.test(line) && !/^\+/.test(line)
  })
  if (roleLine) { result.role = roleLine; usedLines.add(roleLine) }

  const nameRe = /^[A-ZÀ-Ö][a-zA-Zà-ö\-]+(?:\s[A-ZÀ-Ö][a-zA-Zà-ö\-]+){1,3}$/
  const nameLine = lines.find(line =>
    nameRe.test(line) && !usedLines.has(line) && !line.includes('@') &&
    !/\d/.test(line) && line.split(/\s+/).length >= 2 && line.split(/\s+/).length <= 4
  )
  if (nameLine) { result.name = nameLine; usedLines.add(nameLine) }

  const remaining = lines.filter(l => !usedLines.has(l))
  const allCapsLine = remaining.find(line =>
    line === line.toUpperCase() && /[A-Z]/.test(line) && line.length >= 2 && line.length <= 60 &&
    !/^[+\d\s\-().]+$/.test(line) && !/^https?:/i.test(line) && !/^www\./i.test(line) && !line.includes('@')
  )
  if (allCapsLine) {
    result.company = allCapsLine.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
  } else {
    const cl = remaining.find(line =>
      line.length >= 3 && line.length <= 60 && !/^[+\d\s\-().]+$/.test(line) &&
      !/^https?:/i.test(line) && !/^www\./i.test(line) && !line.includes('@') && lines.indexOf(line) <= 4
    )
    if (cl) result.company = cl
  }

  return result
}

// ── AI parser ─────────────────────────────────────────────────────────────────

async function parseWithAI(rawText: string): Promise<Partial<Contact> | null> {
  try {
    const { data, error } = await supabase.functions.invoke<EdgeFunctionResponse>(
      'parse-business-card',
      { body: { rawText: rawText.slice(0, 2000) } },
    )
    if (error || !data) return null
    const fields = edgeResponseToContact(data)
    return Object.keys(fields).length > 0 ? fields : null
  } catch {
    return null
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const FIELD_LABELS: Partial<Record<keyof Contact, string>> = {
  name: 'Name', email: 'Email', phone: 'Phone', company: 'Company', role: 'Role', city: 'City',
}
const DISPLAYED_FIELDS: (keyof Contact)[] = ['name', 'email', 'phone', 'company', 'role', 'city']

function hasAnyField(fields: Partial<Contact>): boolean {
  return DISPLAYED_FIELDS.some(k => fields[k])
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BusinessCardScanner({ onExtract }: BusinessCardScannerProps) {
  const [open, setOpen]                   = useState(false)
  const [phase, setPhase]                 = useState<Phase>('idle')
  const [processingLabel, setProcessingLabel] = useState<ProcessingLabel>('preprocessing')
  const [imageUrl, setImageUrl]           = useState<string | null>(null)
  const [pendingFile, setPendingFile]     = useState<File | null>(null)
  const [pendingBounds, setPendingBounds] = useState<CardBounds | null>(null)
  const [warningMsg, setWarningMsg]       = useState('')
  const [extracted, setExtracted]         = useState<Partial<Contact>>({})
  const [parsedByAI, setParsedByAI]       = useState(false)
  const [errorMsg, setErrorMsg]           = useState('')

  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setPhase('idle')
    setProcessingLabel('preprocessing')
    setImageUrl(null)
    setPendingFile(null)
    setPendingBounds(null)
    setWarningMsg('')
    setExtracted({})
    setParsedByAI(false)
    setErrorMsg('')
  }

  const close = () => { reset(); setOpen(false) }

  // ── startProcessing ───────────────────────────────────────────────────────
  // Called once quality check passes (or user chooses "Continue anyway").
  // bounds may be null; preprocessForOCR falls back to full image in that case.

  const startProcessing = async (file: File, bounds: CardBounds | null) => {
    setPhase('processing')
    setProcessingLabel('scanning')

    try {
      // ── Path 1: Vision (primary) ────────────────────────────────────────────
      // Send compressed image directly to the edge function; Claude reads it visually.
      // Much more accurate than OCR for business cards with complex layouts.
      const visionFields = await tryVisionParse(file, bounds)
      if (visionFields && hasAnyField(visionFields)) {
        setExtracted(visionFields)
        setParsedByAI(true)
        setPhase('review')
        return
      }

      // ── Path 2: OCR fallback ─────────────────────────────────────────────────
      // Vision unavailable, failed, low-confidence, or returned no identity fields.
      // Fall back to the existing Tesseract → edge function text pipeline.

      // Step 1: crop + grayscale + contrast boost
      setProcessingLabel('preprocessing')
      const processedBlob = await preprocessForOCR(file, bounds)

      // Step 2: Tesseract OCR
      setProcessingLabel('loading')
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setProcessingLabel('reading')
        },
      })
      setProcessingLabel('reading')
      const { data: { text: rawText } } = await worker.recognize(processedBlob)
      await worker.terminate()

      // Step 3: edge function text parser → deterministic fallback
      setProcessingLabel('parsing')
      const aiFields = await parseWithAI(rawText)
      const usedAI   = aiFields !== null && hasAnyField(aiFields)
      const fields: Partial<Contact> = usedAI ? aiFields! : parseCard(rawText)

      if (!hasAnyField(fields)) {
        setErrorMsg("Couldn't find recognisable contact fields. Try a clearer photo with the card filling more of the frame.")
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

  // ── handleFileChange ──────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    // Show preview immediately while analysis runs
    const url = URL.createObjectURL(file)
    setImageUrl(url)

    const { warning, bounds } = await analyzeImage(file)

    if (warning) {
      setPendingFile(file)
      setPendingBounds(bounds)   // might be null — pass through either way
      setWarningMsg(warning)
      setPhase('warning')
      return
    }

    startProcessing(file, bounds)
  }

  const handleContinue = () => {
    const file = pendingFile
    if (!file) return
    const bounds = pendingBounds
    setPendingFile(null)
    setPendingBounds(null)
    setWarningMsg('')
    startProcessing(file, bounds)
  }

  const handleApply = () => { onExtract(extracted); close() }

  // ── Trigger button (collapsed) ────────────────────────────────────────────

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
        <button type="button" onClick={close}
          className="-m-2 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          aria-label="Close scanner">
          <XIcon />
        </button>
      </div>

      {/* ── Idle ── */}
      {phase === 'idle' && (
        <>
          <div className="flex gap-3">
            <button type="button" onClick={() => cameraRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 py-4 text-sm text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500 active:bg-zinc-50 dark:active:bg-zinc-700 transition-colors">
              <CameraIcon />
              Take a photo
            </button>
            <button type="button" onClick={() => uploadRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 py-4 text-sm text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500 active:bg-zinc-50 dark:active:bg-zinc-700 transition-colors">
              <UploadIcon />
              Upload image
            </button>
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-3 text-center leading-relaxed">
            Best when the card fills the frame — flat angle, no glare.<br />
            Fields are suggestions; review before saving.
          </p>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
          <input ref={uploadRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </>
      )}

      {/* ── Warning ── */}
      {phase === 'warning' && (
        <>
          {imageUrl && <CardImage src={imageUrl} />}
          <div className="mt-4 rounded-xl bg-zinc-100 dark:bg-zinc-800 px-4 py-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{warningMsg}</p>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <button type="button" onClick={handleContinue}
              className="rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium px-5 py-2.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 active:scale-[0.98] transition-all">
              Continue anyway
            </button>
            <button type="button" onClick={reset}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors py-2.5">
              Try another photo
            </button>
          </div>
        </>
      )}

      {/* ── Processing ── */}
      {phase === 'processing' && (
        <>
          {imageUrl && <CardImage src={imageUrl} />}
          <div className="flex items-start gap-3 mt-4">
            <SpinnerIcon />
            <div>
              {processingLabel === 'scanning' && (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Reading with AI…</p>
              )}
              {processingLabel === 'preprocessing' && (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Preparing image…</p>
              )}
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

      {/* ── Review ── */}
      {phase === 'review' && (
        <>
          {imageUrl && <CardImage src={imageUrl} />}
          <dl className="mt-4 space-y-2.5">
            {DISPLAYED_FIELDS.map(key => {
              const value = extracted[key]
              if (!value) return null
              return (
                <div key={key} className="flex gap-3 min-w-0">
                  <dt className="text-xs text-zinc-400 dark:text-zinc-500 w-16 shrink-0 leading-5">{FIELD_LABELS[key]}</dt>
                  <dd className="text-sm text-zinc-700 dark:text-zinc-300 min-w-0 break-words leading-5">{String(value)}</dd>
                </div>
              )
            })}
          </dl>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-4 mb-3 leading-relaxed">
            {parsedByAI
              ? 'Parsed with AI — review and edit before saving.'
              : 'Auto-detected — review and edit before saving.'}
          </p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={handleApply}
              className="rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium px-5 py-2.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 active:scale-[0.98] transition-all">
              Apply to form
            </button>
            <button type="button" onClick={reset}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors py-2.5">
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
          <button type="button" onClick={reset}
            className="mt-3 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
            Try again
          </button>
        </>
      )}
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

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
