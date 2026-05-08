// Elefante — parse-business-card edge function
//
// Accepts two mutually-exclusive input modes:
//
//   Vision (primary):
//     { imageBase64: string, mimeType: string }
//     → Claude Vision reads the image directly → cleanVisionResponse()
//
//   OCR text (fallback):
//     { rawText: string }
//     → normalise → deterministicExtract → Claude text prompt → postProcess()
//
// If both are provided, Vision is used.
// Returns the same shape in both cases:
//   { name, company, role, phone, email, website, city, country,
//     confidence, source, warnings }
//
// Deploy:  supabase functions deploy parse-business-card
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Types ──────────────────────────────────────────────────────────────────────

type PhoneLabel = 'mobile' | 'direct' | 'tel' | 'none' | 'fax'

interface PhoneCandidate {
  number:   string
  label:    PhoneLabel
  priority: number
}

interface DeterministicCandidates {
  emails:         string[]
  phones:         PhoneCandidate[]
  legalEntities:  string[]
  roles:          string[]
  nameCandidates: string[]
  domains:        string[]
  domainHints:    string[]
}

// Unified response shape — both Vision and OCR paths return this
interface ParsedFields {
  name?:        string
  company?:     string
  role?:        string
  phone?:       string
  email?:       string
  website?:     string
  city?:        string
  country?:     string
  confidence:   number          // 0.0–1.0
  source:       'vision' | 'ocr'
  warnings:     string[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PHONE_PRIORITY: Record<PhoneLabel, number> = {
  mobile: 1, direct: 2, none: 3, tel: 4, fax: 99,
}

const LEGAL_ENTITY_RE =
  /\b(S\.L\.?|SL|S\.A\.?|SA|GmbH|Ltd\.?|Inc\.?|S\.A\.S\.?|SAS|LLC|L\.L\.C\.?|B\.V\.?|BV|N\.V\.?|NV|Corp\.?|A\.G\.?|AG|K\.G\.?|KG|OHG|SpA|SARL|S\.R\.L\.?|SRL|PLC|AB|AS|OY|A\/S)\b/

const ROLE_RE = new RegExp(
  '\\b(' + [
    'director\\s+general', 'managing\\s+director', 'general\\s+manager', 'gerente\\s+general',
    'director', 'ceo', 'cto', 'cfo', 'coo', 'cso', 'chro', 'cpo',
    'founder', 'co-?founder', 'cofundador',
    'partner', 'socio',
    'manager', 'gerente', 'responsable',
    'comercial', 'account\\s+executive',
    'sales', 'ventas',
    'engineer', 'ingeniero',
    'project\\s+manager',
    'business\\s+development',
    'analyst', 'analista',
    'consultant', 'consultor',
    'architect', 'arquitecto',
    'head\\s+of', 'jefe\\s+de',
    'president', 'presidente',
    'vice\\s+president', 'vicepresidente',
    'executive', 'ejecutivo',
    'specialist', 'especialista',
  ].join('|') + ')\\b',
  'i',
)

const LABEL_PREFIX_RE =
  /^(fax|tel[eé]?[f]?|telef[oó]no|phone|mob[il]+|m[oó]vil|handy|e-?mail|web|www|http|nif|vat|c\.?c\.?|@)/i

const ADDRESS_BOUNDARY_RE = new RegExp(
  '(' + [
    '[•|]',
    '\\bPol\\.?\\s*(?:Ind\\.?)?\\b', '\\bPolígono\\b',
    'C\\/', '\\bCalle\\b', '\\bAvd?a?\\.?\\b', '\\bAvenida\\b',
    '\\bPlaza\\b', '\\bPza\\.\\b', '\\bPaseo\\b',
    '\\bCarretera\\b', '\\bCtra\\.\\b',
    '\\bStraße\\b', '\\bStr\\.\\b', '\\bWeg\\b', '\\bAllee\\b',
    '\\bStreet\\b', '\\bRoad\\b', '\\bAvenue\\b', '\\bBlvd\\b',
    '(?:,?\\s*)\\d{4,6}(?=\\s|$)',
    ',\\s*\\d{1,3}(?:[\\-–]\\d{1,3})?(?=\\s|,|$)',
  ].join('|') + ')',
  'i',
)

const COMPANY_BAD_PREFIXES = [
  'fax', 'tel:', 'tel.', 'telefon', 'mobile', 'movil', 'móvil',
  'handy', 'e-mail', 'email', 'www', 'http',
]

// ── Vision system prompt ───────────────────────────────────────────────────────
// Used when an image is provided. Claude reads the card visually.
// Much simpler than the OCR text prompt — no need for candidate anchoring.

const VISION_SYSTEM_PROMPT = `\
You extract contact information from business card images.

Return ONLY a valid JSON object — no markdown, no code fences, nothing else:
{
  "name":       string | null,
  "company":    string | null,
  "role":       string | null,
  "phone":      string | null,
  "email":      string | null,
  "website":    string | null,
  "city":       string | null,
  "country":    string | null,
  "confidence": number,
  "source":     "vision",
  "warnings":   string[]
}

RULES
name    — person's full name only; never the company name
company — official organisation name; prefer with legal suffix (S.L., GmbH, Ltd, etc.)
phone   — prefer mobile/direct; NEVER return a fax number unless it is the only number
email   — as written; if the start is cut off and the name is visible, reconstruct it
website — URL if present; omit https:// and www
city    — city shown in address or clearly stated
country — country if present or strongly implied by phone prefix or postal code
confidence — 0.9+ clear card, 0.5–0.9 partial/uncertain, <0.5 poor quality
warnings — list issues: "blurry", "partial card visible", "glare", etc.
null    — use null (not empty string) for any field you cannot confidently identify`

// ── OCR text system prompt ─────────────────────────────────────────────────────

const OCR_SYSTEM_PROMPT = `\
You finalize business card contact extraction.

You receive two inputs:
1. CANDIDATES — pre-extracted deterministic results (high reliability)
2. RAW OCR TEXT — may contain noise and errors

Return ONLY a valid JSON object with these fields (omit uncertain ones):
  name, email, phone, company, role, city

FIELD INSTRUCTIONS

email
• Use the first candidate email if present.
• If the email local part appears truncated relative to the person's name
  (e.g. name "Alvaro Imaz" but email starts "varo.imaz@..."), reconstruct the full email.
• Lowercase. Preserve domain exactly.

phone
• Use the first phone candidate (mobile/direct preferred; fax is last resort).
• Include country code if present.

company
• Use the legal entity line if one is listed in candidates.
• If a legal entity candidate is annotated with [⚠ OCR mismatch vs domain ...], the first
  word may be OCR-corrupted — search the raw text for a word matching the domain root.
• Never return a phone number, fax, address, URL, or label row as the company.

role
• Use the first role candidate if present; otherwise look below the name in the raw text.

name
• Prefer name candidates listed in CANDIDATES; pick the one closest before the role.
• Otherwise find a 2–4 word title-case name in the raw text.

city
• Include only if clearly stated. Omit if uncertain.

RULES
• Never invent values. When uncertain, omit.
• Return ONLY the JSON object — no markdown, no explanation.`

// ── Shared utilities ───────────────────────────────────────────────────────────

function stripSymbols(value: string): string {
  return value
    .replace(/^[\s\-|\\\/,:;.'"`]+/, '')
    .replace(/[\s\-|\\\/,:;.'"`]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function cleanCompanyBoundary(raw: string): string {
  const match = ADDRESS_BOUNDARY_RE.exec(raw)
  let value = match && match.index > 0 ? raw.slice(0, match.index) : raw
  value = value.replace(/[\s,•|\-]+$/, '').trim()
  return value
}

function isValidCompany(value: string): boolean {
  if (value.length < 3) return false
  const letters = (value.match(/[a-zA-ZÀ-ÖØ-öø-ÿ]/g) ?? []).length
  if (letters < 2) return false
  if (letters / value.length < 0.35) return false
  const lower = value.toLowerCase()
  if (COMPANY_BAD_PREFIXES.some(p => lower.startsWith(p))) return false
  return true
}

function tryReconstructEmail(email: string, name: string | undefined): string {
  if (!name || !email.includes('@')) return email
  const atIdx  = email.indexOf('@')
  const local  = email.slice(0, atIdx).toLowerCase()
  const domain = email.slice(atIdx)
  const parts  = name.toLowerCase()
    .replace(/[^a-záéíóúüñàèìòùâêîôûäëïöü\s]/gi, '')
    .trim().split(/\s+/).filter(p => p.length > 1)
  if (parts.length < 2) return email
  const first = parts[0], last = parts[parts.length - 1]
  for (const p of [`${first}.${last}`, `${first[0]}.${last}`, `${first}${last}`, `${last}.${first}`]) {
    if (p.length > local.length && p.endsWith(local)) {
      const dropped = p.slice(0, p.length - local.length)
      if (dropped.length >= 1 && dropped.length <= 4) return p + domain
    }
  }
  return email
}

function inferCompanyFromDomain(email: string): string | undefined {
  const m = email.match(/@([a-zA-Z0-9-]+)(?:\.[a-zA-Z]{2,})+$/)
  if (!m) return undefined
  const part = m[1]
  return part.length >= 3 && /^[a-zA-Z]+$/.test(part)
    ? part.charAt(0).toUpperCase() + part.slice(1)
    : undefined
}

// ── Vision post-processing ─────────────────────────────────────────────────────
// Lighter than the OCR path — no deterministic candidate fallbacks needed.
// Claude saw the image directly, so we trust it more and just clean/validate.

function cleanVisionResponse(raw: Record<string, unknown>): ParsedFields {
  const confidence = typeof raw.confidence === 'number'
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.5
  const warnings = Array.isArray(raw.warnings)
    ? (raw.warnings as unknown[]).filter((w): w is string => typeof w === 'string')
    : []

  const result: ParsedFields = { confidence, source: 'vision', warnings }

  const STRING_FIELDS = ['name', 'company', 'role', 'phone', 'email', 'website', 'city', 'country'] as const

  for (const key of STRING_FIELDS) {
    const val = raw[key]
    if (typeof val !== 'string' || !val.trim()) continue

    let v = stripSymbols(val)
    if (!v) continue

    if (key === 'email') {
      v = v.toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) continue
      // Attempt reconstruction if name is already set
      v = tryReconstructEmail(v, result.name)
    }

    if (key === 'company') {
      v = cleanCompanyBoundary(v)
      if (!isValidCompany(v)) continue
    }

    result[key] = v
  }

  return result
}

// ── OCR text normalisation + deterministic extractors ─────────────────────────

function normalizeText(text: string): string {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/[•·★✓✦◆◉○●▶►▸]/g, '\n')
    .replace(/[ --]/g, '')
    .replace(/[­​‌‍﻿]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractEmails(text: string): string[] {
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
  const found = new Set<string>()
  for (const m of text.matchAll(re)) found.add(m[0].toLowerCase())
  return Array.from(found)
}

function extractPhones(lines: string[]): PhoneCandidate[] {
  const PHONE_RE = /(?:\+?\d[\d\s\-().]{5,17}\d)/g
  const results: PhoneCandidate[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const matches = line.match(PHONE_RE)
    if (!matches) continue
    const ctx = ((i > 0 ? lines[i - 1] : '') + ' ' + line).toLowerCase()
    let label: PhoneLabel
    if (/m[oó]vil|mobile|cell(?:ular)?|handy/i.test(ctx))        label = 'mobile'
    else if (/directo?\b|direct\b/i.test(ctx))                   label = 'direct'
    else if (/fax/i.test(ctx))                                   label = 'fax'
    else if (/tel[eé]?f?(?:ono|on)?\.?|phone|tel\b/i.test(ctx)) label = 'tel'
    else                                                         label = 'none'
    for (const raw of matches) {
      const number = raw.replace(/\s{2,}/g, ' ').trim()
      const digitCount = (number.match(/\d/g) ?? []).length
      if (digitCount >= 7 && digitCount <= 15)
        results.push({ number, label, priority: PHONE_PRIORITY[label] })
    }
  }
  const seen = new Set<string>()
  return results.sort((a, b) => a.priority - b.priority)
    .filter(p => { if (seen.has(p.number)) return false; seen.add(p.number); return true })
}

function extractLegalEntities(lines: string[]): string[] {
  return lines
    .filter(l => LEGAL_ENTITY_RE.test(l) && l.length <= 120 && !LABEL_PREFIX_RE.test(l))
    .map(l => cleanCompanyBoundary(l))
    .filter(isValidCompany)
}

function extractRoles(lines: string[]): string[] {
  return lines.filter(l =>
    ROLE_RE.test(l) && l.length < 80 && !LABEL_PREFIX_RE.test(l) && !/\d{5,}/.test(l)
  )
}

function extractNameCandidates(lines: string[]): string[] {
  const NAME_RE = /^[A-ZÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÜ][a-záéíóúüñàèìòùâêîôûäëïöü\-]+(?:\s[A-ZÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÜ][a-záéíóúüñàèìòùâêîôûäëïöü\-]+){1,3}$/
  return lines.filter(line => {
    const words = line.trim().split(/\s+/)
    return NAME_RE.test(line.trim()) && !LABEL_PREFIX_RE.test(line) &&
      !LEGAL_ENTITY_RE.test(line) && !ROLE_RE.test(line) &&
      !/\d/.test(line) && !line.includes('@') &&
      words.length >= 2 && words.length <= 4
  })
}

function rankNamesByRoleProximity(lines: string[], names: string[], roles: string[]): string[] {
  if (roles.length === 0 || names.length <= 1) return names
  const roleIdx = lines.findIndex(l => l === roles[0])
  if (roleIdx < 0) return names
  return [...names].sort((a, b) => {
    const scoreOf = (idx: number) => idx >= 0 && idx < roleIdx ? roleIdx - idx : 999
    return scoreOf(lines.indexOf(a)) - scoreOf(lines.indexOf(b))
  })
}

function extractDomains(text: string): string[] {
  const re = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]{2,}\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/g
  const found = new Set<string>()
  for (const m of text.matchAll(re)) {
    const d = m[1].toLowerCase()
    if (!['gmail.com','yahoo.com','hotmail.com','outlook.com'].includes(d)) found.add(d)
  }
  return Array.from(found)
}

function extractDomainHints(emails: string[]): string[] {
  const hints: string[] = []
  for (const email of emails) {
    const m = email.match(/@([a-zA-Z0-9-]+)\./)
    if (!m) continue
    const root = m[1]
    if (root.length >= 3 && /^[a-z]+$/i.test(root))
      hints.push(root.charAt(0).toUpperCase() + root.slice(1))
  }
  return [...new Set(hints)]
}

function deterministicExtract(rawText: string): DeterministicCandidates {
  const lines   = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const emails  = extractEmails(rawText)
  const roles   = extractRoles(lines)
  const rawNames = extractNameCandidates(lines)
  return {
    emails,
    phones:         extractPhones(lines),
    legalEntities:  extractLegalEntities(lines),
    roles,
    nameCandidates: rankNamesByRoleProximity(lines, rawNames, roles),
    domains:        extractDomains(rawText),
    domainHints:    extractDomainHints(emails),
  }
}

function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bg = (s: string) => { const g = new Set<string>(); for (let i=0;i<s.length-1;i++) g.add(s.slice(i,i+2)); return g }
  const ga = bg(a), gb = bg(b)
  let shared = 0; for (const g of ga) if (gb.has(g)) shared++
  return (2 * shared) / (ga.size + gb.size)
}

function bestWordSimilarity(phrase: string, target: string): number {
  const words = phrase.toLowerCase().replace(/[^a-záéíóúüñ0-9\s]/gi, '').split(/\s+/)
  let best = 0
  for (const w of words) { if (w.length < 3) continue; const s = bigramSimilarity(w, target.toLowerCase()); if (s > best) best = s }
  return best
}

function buildOcrPrompt(rawText: string, c: DeterministicCandidates): string {
  const out: string[] = ['=== CANDIDATES ===']
  if (c.emails.length) out.push(`Emails: ${c.emails.join(', ')}`)
  if (c.phones.length) {
    const ps = c.phones.map(p => p.label !== 'none' ? `${p.number} (${p.label})` : p.number)
    out.push(`Phones (best first): ${ps.join(' | ')}`)
  }
  if (c.legalEntities.length) {
    const domainRoot = c.domainHints[0]?.toLowerCase() ?? ''
    const annotated  = c.legalEntities.map(e => {
      if (domainRoot.length >= 3 && bestWordSimilarity(e, domainRoot) < 0.4)
        return `${e} [⚠ OCR mismatch vs domain "${domainRoot}" — first word may be garbled]`
      return e
    })
    out.push(`Legal entity lines: ${annotated.join(' | ')}`)
  }
  if (c.domainHints.length)    out.push(`Domain company hints: ${c.domainHints.join(', ')}`)
  if (c.roles.length)           out.push(`Role/title lines: ${c.roles.slice(0,3).join(' | ')}`)
  if (c.nameCandidates.length) out.push(`Name candidates (closest-to-role first): ${c.nameCandidates.slice(0,3).join(' | ')}`)
  if (c.domains.length)         out.push(`Domains: ${c.domains.join(', ')}`)
  out.push('\n=== RAW OCR TEXT ===')
  out.push(rawText)
  return out.join('\n')
}

// ── OCR post-processing ────────────────────────────────────────────────────────

const OCR_ALLOWED_FIELDS = ['name', 'email', 'phone', 'company', 'role', 'city'] as const

function postProcessOcr(
  raw: Record<string, unknown>,
  candidates: DeterministicCandidates,
): ParsedFields {
  const result: ParsedFields = { confidence: 0.7, source: 'ocr', warnings: [] }

  for (const key of OCR_ALLOWED_FIELDS) {
    const val = raw[key]
    if (typeof val !== 'string') continue
    let v = stripSymbols(val)
    if (!v) continue
    if (key === 'email') {
      v = v.toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) continue
    }
    if (key === 'company') {
      v = cleanCompanyBoundary(v)
      if (!isValidCompany(v)) continue
    }
    result[key] = v
  }

  if (result.email) result.email = tryReconstructEmail(result.email, result.name)

  if (!result.company) {
    if (candidates.legalEntities.length > 0)  result.company = candidates.legalEntities[0]
    else if (candidates.domainHints.length > 0) result.company = candidates.domainHints[0]
    else if (result.email)                     result.company = inferCompanyFromDomain(result.email)
  }
  if (!result.phone && candidates.phones.length > 0) {
    const best = candidates.phones.find(p => p.label !== 'fax') ?? candidates.phones[0]
    result.phone = best.number
  }
  if (!result.email && candidates.emails.length > 0)
    result.email = tryReconstructEmail(candidates.emails[0], result.name)

  return result
}

function deterministicFallback(candidates: DeterministicCandidates): ParsedFields {
  const result: ParsedFields = { confidence: 0.5, source: 'ocr', warnings: ['AI unavailable — deterministic extraction only'] }
  if (candidates.emails.length > 0)       result.email   = candidates.emails[0]
  const bestPhone = candidates.phones.find(p => p.label !== 'fax') ?? candidates.phones[0]
  if (bestPhone)                           result.phone   = bestPhone.number
  if (candidates.legalEntities.length > 0) result.company = candidates.legalEntities[0]
  else if (candidates.domainHints.length > 0) result.company = candidates.domainHints[0]
  else if (result.email)                  result.company = inferCompanyFromDomain(result.email)
  if (candidates.roles.length > 0)         result.role    = candidates.roles[0]
  if (candidates.nameCandidates.length > 0) result.name   = candidates.nameCandidates[0]
  return result
}

// ── Anthropic call helpers ─────────────────────────────────────────────────────

async function callAnthropicVision(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  // Defensive strip: remove data URL prefix if the frontend accidentally sent it
  // e.g. "data:image/jpeg;base64,/9j/..." → "/9j/..."
  const rawBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      // Sonnet 4.5 for Vision — better at reading card layouts; all 4.x models
      // support image_input. This account has no access to claude-3.x models.
      model:      'claude-sonnet-4-5-20250929',
      max_tokens: 600,
      system:     VISION_SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mimeType, data: rawBase64 },
          },
          { type: 'text', text: 'Extract the contact information from this business card.' },
        ],
      }],
    }),
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Anthropic Vision error ${resp.status}: ${body}`)
  }
  const payload = await resp.json() as { content?: { text: string }[] }
  return payload.content?.[0]?.text ?? ''
}

async function callAnthropicText(
  apiKey: string,
  prompt: string,
): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      // Haiku 4.5 for OCR text — fast, cheap, adequate for structured extraction.
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:     OCR_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Anthropic text error ${resp.status}: ${body}`)
  }
  const payload = await resp.json() as { content?: { text: string }[] }
  return payload.content?.[0]?.text ?? ''
}

function extractJsonFromText(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) as Record<string, unknown> }
  catch { return null }
}

// ── Edge function ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')   return respond({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return respond({ error: 'Unauthorized' }, 401)

  let body: { imageBase64?: unknown; mimeType?: unknown; rawText?: unknown }
  try {
    body = await req.json() as typeof body
  } catch {
    return respond({ error: 'Invalid JSON body' }, 400)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  // ── Vision path ──────────────────────────────────────────────────────────────
  if (typeof body.imageBase64 === 'string' && typeof body.mimeType === 'string') {
    const imageBase64 = body.imageBase64
    const mimeType    = body.mimeType

    // Sanity checks
    if (!imageBase64.trim()) return respond({ error: 'imageBase64 is empty' }, 400)
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!ALLOWED_TYPES.includes(mimeType))
      return respond({ error: 'Unsupported mimeType' }, 400)

    console.log(`[parse-business-card] Vision path | mimeType=${mimeType} | b64len=${imageBase64.length} | apiKey=${apiKey ? 'SET' : '*** NOT SET ***'}`)

    if (!apiKey) {
      console.error('[parse-business-card] *** ANTHROPIC_API_KEY secret is missing — run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ***')
      return respond({ error: 'AI parsing not configured — ANTHROPIC_API_KEY secret is missing' }, 503)
    }

    try {
      const aiText = await callAnthropicVision(apiKey, imageBase64, mimeType)
      console.log('[parse-business-card] Vision AI raw response:', aiText.slice(0, 400))

      const raw    = extractJsonFromText(aiText)
      if (!raw) throw new Error('No JSON in Vision response')

      const fields = cleanVisionResponse(raw)
      console.log('[parse-business-card] Vision final fields:', JSON.stringify(fields))
      return respond(fields, 200)
    } catch (err) {
      console.error('[parse-business-card] Vision failed:', err)
      return respond({ error: 'Vision parsing failed', detail: String(err) }, 502)
    }
  }

  // ── OCR text path ────────────────────────────────────────────────────────────
  if (typeof body.rawText === 'string' && body.rawText.trim()) {
    const rawText    = normalizeText(body.rawText.trim().slice(0, 2000))
    const candidates = deterministicExtract(rawText)

    console.log(`[parse-business-card] OCR path | chars=${rawText.length} | apiKey=${apiKey ? 'SET' : '*** NOT SET ***'}`)
    console.log('[parse-business-card] rawText:\n' + rawText)
    console.log('[parse-business-card] candidates:', JSON.stringify(candidates))

    if (!apiKey) {
      console.error('[parse-business-card] *** ANTHROPIC_API_KEY secret is missing ***')
      // Distinct warning so curl tests can tell this apart from an Anthropic API error
      const fallback = deterministicFallback(candidates)
      fallback.warnings = ['key-missing: ANTHROPIC_API_KEY secret not found in Deno.env']
      return respond(fallback, 200)
    }

    // Log a prefix of the key so we can confirm which key the function is using
    // (never log the full key)
    console.log(`[parse-business-card] apiKey prefix: ${apiKey.slice(0, 20)}...`)

    let fields: ParsedFields
    try {
      const prompt  = buildOcrPrompt(rawText, candidates)
      const aiText  = await callAnthropicText(apiKey, prompt)
      console.log('[parse-business-card] OCR AI response:', aiText)

      const raw = extractJsonFromText(aiText)
      if (!raw) throw new Error('No JSON in OCR AI response')

      fields = postProcessOcr(raw, candidates)
    } catch (err) {
      // Distinct warning + error detail so curl tests can see the Anthropic error
      console.error('[parse-business-card] OCR AI failed:', err)
      fields = deterministicFallback(candidates)
      fields.warnings = [`anthropic-error: ${String(err).slice(0, 300)}`]
    }

    console.log('[parse-business-card] OCR final fields:', JSON.stringify(fields))
    return respond(fields, 200)
  }

  return respond({ error: 'Provide either imageBase64+mimeType or rawText' }, 400)
})

// ── Helper ─────────────────────────────────────────────────────────────────────

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
