// Elefante — parse-business-card edge function
//
// Hybrid deterministic + AI extraction pipeline:
//
//   rawText
//     → deterministicExtract()   regex/rules — emails, phones, legal entities, roles, domains
//     → buildPrompt()            both raw text AND candidates are sent to the model
//     → Claude                  anchored to candidates; fills name/city from raw text
//     → postProcess()            cleanup + email reconstruction using the AI-identified name
//     → if AI fails → deterministicFallback() returns extracted candidates directly
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
  number: string
  label: PhoneLabel
  priority: number   // lower = better; fax = 99
}

interface DeterministicCandidates {
  emails:        string[]
  phones:        PhoneCandidate[]    // sorted best-first
  legalEntities: string[]
  roles:         string[]
  nameCandidates:string[]
  domains:       string[]
}

interface ParsedFields {
  name?:    string
  email?:   string
  phone?:   string
  company?: string
  role?:    string
  city?:    string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PHONE_PRIORITY: Record<PhoneLabel, number> = {
  mobile: 1, direct: 2, none: 3, tel: 4, fax: 99,
}

// Legal entity suffixes common in Europe + Americas
const LEGAL_ENTITY_RE =
  /\b(S\.L\.?|SL|S\.A\.?|SA|GmbH|Ltd\.?|Inc\.?|S\.A\.S\.?|SAS|LLC|L\.L\.C\.?|B\.V\.?|BV|N\.V\.?|NV|Corp\.?|A\.G\.?|AG|K\.G\.?|KG|OHG|SpA|SARL|S\.R\.L\.?|SRL|PLC|AB|AS|OY|A\/S)\b/

// Role/title keywords — multilingual, used for line scoring.
// Built with new RegExp() because JS regex literals cannot span multiple lines
// and the 'x' (verbose) flag does not exist in V8/Deno.
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

// Label prefixes that can never be company or role
const LABEL_PREFIX_RE =
  /^(fax|tel[eé]?[f]?|telef[oó]no|phone|mob[il]+|m[oó]vil|handy|e-?mail|web|www|http|nif|vat|c\.?c\.?|@)/i

// Bad-prefix set used in company validation (subset of LABEL_PREFIX_RE for company)
const COMPANY_BAD_PREFIXES = [
  'fax', 'tel:', 'tel.', 'telefon', 'mobile', 'movil', 'móvil',
  'handy', 'e-mail', 'email', 'www', 'http',
]

// ── Deterministic extractors ───────────────────────────────────────────────────

function extractEmails(text: string): string[] {
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
  const found = new Set<string>()
  for (const m of text.matchAll(re)) found.add(m[0].toLowerCase())
  return Array.from(found)
}

function extractPhones(lines: string[]): PhoneCandidate[] {
  // Matches international and local formats; requires 7–15 digits
  const PHONE_RE = /(?:\+?\d[\d\s\-().]{5,17}\d)/g
  const results: PhoneCandidate[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const matches = line.match(PHONE_RE)
    if (!matches) continue

    // Check label on current line AND previous line (some cards put label above)
    const ctx = ((i > 0 ? lines[i - 1] : '') + ' ' + line).toLowerCase()

    let label: PhoneLabel
    if (/m[oó]vil|mobile|cell(?:ular)?|handy/i.test(ctx)) {
      label = 'mobile'
    } else if (/directo?\b|direct\b/i.test(ctx)) {
      label = 'direct'
    } else if (/fax/i.test(ctx)) {
      label = 'fax'
    } else if (/tel[eé]?f?(?:ono|on)?\.?|phone|tel\b/i.test(ctx)) {
      label = 'tel'
    } else {
      label = 'none'
    }

    for (const raw of matches) {
      const number = raw.replace(/\s{2,}/g, ' ').trim()
      const digitCount = (number.match(/\d/g) ?? []).length
      if (digitCount >= 7 && digitCount <= 15) {
        results.push({ number, label, priority: PHONE_PRIORITY[label] })
      }
    }
  }

  // Sort best-first; deduplicate by number string
  const seen = new Set<string>()
  return results
    .sort((a, b) => a.priority - b.priority)
    .filter(p => { if (seen.has(p.number)) return false; seen.add(p.number); return true })
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

function extractLegalEntities(lines: string[]): string[] {
  return lines.filter(line =>
    LEGAL_ENTITY_RE.test(line) &&
    isValidCompany(line) &&
    line.length <= 120 &&
    !LABEL_PREFIX_RE.test(line)
  )
}

function extractRoles(lines: string[]): string[] {
  return lines.filter(line =>
    ROLE_RE.test(line) &&
    line.length < 80 &&
    !LABEL_PREFIX_RE.test(line) &&
    !/\d{5,}/.test(line)          // reject lines that are mostly numbers
  )
}

// Extract name candidates: 2–4 title-case words, no digits, no label prefixes
function extractNameCandidates(lines: string[]): string[] {
  const NAME_RE = /^[A-ZÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÜ][a-záéíóúüñàèìòùâêîôûäëïöü\-]+(?:\s[A-ZÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÜ][a-záéíóúüñàèìòùâêîôûäëïöü\-]+){1,3}$/

  return lines.filter(line => {
    const words = line.trim().split(/\s+/)
    return (
      NAME_RE.test(line.trim()) &&
      !LABEL_PREFIX_RE.test(line) &&
      !LEGAL_ENTITY_RE.test(line) &&
      !ROLE_RE.test(line) &&
      !/\d/.test(line) &&
      !line.includes('@') &&
      words.length >= 2 &&
      words.length <= 4
    )
  })
}

function extractDomains(text: string): string[] {
  const re = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]{2,}\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/g
  const found = new Set<string>()
  for (const m of text.matchAll(re)) {
    const d = m[1].toLowerCase()
    // Exclude common TLDs that aren't company domains
    if (!['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'].includes(d)) {
      found.add(d)
    }
  }
  return Array.from(found)
}

function deterministicExtract(rawText: string): DeterministicCandidates {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  return {
    emails:         extractEmails(rawText),
    phones:         extractPhones(lines),
    legalEntities:  extractLegalEntities(lines),
    roles:          extractRoles(lines),
    nameCandidates: extractNameCandidates(lines),
    domains:        extractDomains(rawText),
  }
}

// ── AI prompt ─────────────────────────────────────────────────────────────────
// AI's job is narrow: choose among candidates, fill name/city from raw text,
// and reconstruct truncated emails. It should NOT invent company names.

const SYSTEM_PROMPT = `\
You finalize business card contact extraction.

You receive two inputs:
1. CANDIDATES — pre-extracted deterministic results (high reliability)
2. RAW OCR TEXT — may contain noise and errors

Your task is to return ONLY a valid JSON object with these fields (omit uncertain ones):
  name, email, phone, company, role, city

FIELD INSTRUCTIONS

email
• Use the first candidate email if present.
• If the email local part appears truncated relative to the person's name
  (e.g. name "Alvaro Imaz" but email starts "varo.imaz@..."), reconstruct the full email.
• Lowercase. Preserve domain exactly.

phone
• Use the first phone candidate (mobile/direct are preferred; fax is last resort).
• Include country code if present.

company
• Use the legal entity line if one is listed in candidates.
• Otherwise, look in the raw OCR text for the organisation name near the top.
• If an email domain matches a word in the raw text, that word is likely the company.
• Never use a phone number, fax, address, URL, or label row as the company name.
• Never return fragments shorter than 3 meaningful letters.

role
• Use the first role candidate if present.
• Otherwise look in raw OCR text directly below the person's name.

name
• Find the person's full human name from the raw OCR text.
• Usually 2–4 words in title case, no digits, not a company or label.
• If a name candidate is listed, prefer it.

city
• Include only if clearly stated. Omit if uncertain.

RULES
• Never invent values. When uncertain, omit.
• Return ONLY the JSON object — no markdown, no explanation.`

function buildPrompt(rawText: string, c: DeterministicCandidates): string {
  const lines: string[] = ['=== CANDIDATES ===']

  if (c.emails.length)
    lines.push(`Emails: ${c.emails.join(', ')}`)

  if (c.phones.length) {
    const ps = c.phones.map(p => p.label !== 'none' ? `${p.number} (${p.label})` : p.number)
    lines.push(`Phones (best first): ${ps.join(' | ')}`)
  }

  if (c.legalEntities.length)
    lines.push(`Legal entity lines: ${c.legalEntities.join(' | ')}`)

  if (c.roles.length)
    lines.push(`Role/title lines: ${c.roles.slice(0, 3).join(' | ')}`)

  if (c.nameCandidates.length)
    lines.push(`Name candidates: ${c.nameCandidates.slice(0, 3).join(' | ')}`)

  if (c.domains.length)
    lines.push(`Domains: ${c.domains.join(', ')}`)

  lines.push('\n=== RAW OCR TEXT ===')
  lines.push(rawText)

  return lines.join('\n')
}

// ── Post-processing ────────────────────────────────────────────────────────────

function stripSymbols(value: string): string {
  return value
    .replace(/^[\s\-|\\\/,:;.'"`]+/, '')
    .replace(/[\s\-|\\\/,:;.'"`]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Try to fix OCR-truncated email local parts using the identified name.
// Example: name="Alvaro Imaz", email="varo.imaz@muepro.es" → "alvaro.imaz@muepro.es"
// Only reconstructs when the dropped prefix is ≤ 4 chars (conservative).
function tryReconstructEmail(email: string, name: string | undefined): string {
  if (!name || !email.includes('@')) return email

  const atIdx = email.indexOf('@')
  const local = email.slice(0, atIdx).toLowerCase()
  const domain = email.slice(atIdx)                   // includes '@'

  const parts = name.toLowerCase()
    .replace(/[^a-záéíóúüñàèìòùâêîôûäëïöü\s]/gi, '')
    .trim()
    .split(/\s+/)
    .filter(p => p.length > 1)

  if (parts.length < 2) return email

  const first = parts[0]
  const last = parts[parts.length - 1]

  // Common name-to-email patterns
  const patterns = [
    `${first}.${last}`,
    `${first[0]}.${last}`,
    `${first}${last}`,
    `${last}.${first}`,
  ]

  for (const pattern of patterns) {
    if (pattern.length > local.length && pattern.endsWith(local)) {
      const dropped = pattern.slice(0, pattern.length - local.length)
      if (dropped.length >= 1 && dropped.length <= 4) {
        return pattern + domain      // reconstruct
      }
    }
  }

  return email
}

// Infer company fallback from email domain — used only when no legal entity found
function inferCompanyFromDomain(email: string): string | undefined {
  const match = email.match(/@([a-zA-Z0-9-]+)(?:\.[a-zA-Z]{2,})+$/)
  if (!match) return undefined
  const part = match[1]
  if (part.length >= 3 && /^[a-zA-Z]+$/.test(part)) {
    return part.charAt(0).toUpperCase() + part.slice(1)
  }
  return undefined
}

const ALLOWED_FIELDS = ['name', 'email', 'phone', 'company', 'role', 'city'] as const

function postProcess(
  raw: Record<string, unknown>,
  candidates: DeterministicCandidates,
): ParsedFields {
  const result: ParsedFields = {}

  for (const key of ALLOWED_FIELDS) {
    const val = raw[key]
    if (typeof val !== 'string') continue

    let v = stripSymbols(val)
    if (!v) continue

    if (key === 'email') {
      v = v.toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) continue
    }

    if (key === 'company' && !isValidCompany(v)) continue

    result[key] = v
  }

  // Email reconstruction: apply if the AI didn't fix the truncation itself
  if (result.email) {
    result.email = tryReconstructEmail(result.email, result.name)
  }

  // Company fallback: legal entity candidate → domain inference
  if (!result.company) {
    if (candidates.legalEntities.length > 0) {
      result.company = candidates.legalEntities[0]
    } else if (result.email) {
      const inferred = inferCompanyFromDomain(result.email)
      if (inferred) result.company = inferred
    }
  }

  // Phone fallback: if AI omitted phone but we have a candidate
  if (!result.phone && candidates.phones.length > 0) {
    const best = candidates.phones.find(p => p.label !== 'fax') ?? candidates.phones[0]
    result.phone = best.number
  }

  // Email fallback: if AI omitted email but deterministic found one
  if (!result.email && candidates.emails.length > 0) {
    const reconstructed = tryReconstructEmail(candidates.emails[0], result.name)
    result.email = reconstructed
  }

  return result
}

// Deterministic-only fallback used when AI call fails entirely
function deterministicFallback(candidates: DeterministicCandidates): ParsedFields {
  const result: ParsedFields = {}

  if (candidates.emails.length > 0) result.email = candidates.emails[0]

  const bestPhone = candidates.phones.find(p => p.label !== 'fax') ?? candidates.phones[0]
  if (bestPhone) result.phone = bestPhone.number

  if (candidates.legalEntities.length > 0) {
    result.company = candidates.legalEntities[0]
  } else if (result.email) {
    result.company = inferCompanyFromDomain(result.email)
  }

  if (candidates.roles.length > 0) result.role = candidates.roles[0]
  if (candidates.nameCandidates.length > 0) result.name = candidates.nameCandidates[0]

  return result
}

// ── Edge function ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')   return respond({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return respond({ error: 'Unauthorized' }, 401)

  let rawText: string
  try {
    const body = await req.json() as { rawText?: unknown }
    if (typeof body.rawText !== 'string' || !body.rawText.trim())
      return respond({ error: 'rawText must be a non-empty string' }, 400)
    rawText = body.rawText.trim().slice(0, 2000)
  } catch {
    return respond({ error: 'Invalid JSON body' }, 400)
  }

  // ── Step 1: deterministic extraction ──────────────────────────────────────
  const candidates = deterministicExtract(rawText)

  console.log('[parse-business-card] rawText:\n' + rawText)
  console.log('[parse-business-card] candidates:', JSON.stringify(candidates))

  // ── Step 2: AI refinement (optional — falls back to deterministic on error) ─
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.warn('[parse-business-card] ANTHROPIC_API_KEY not set — using deterministic fallback')
    const fallback = deterministicFallback(candidates)
    console.log('[parse-business-card] fallback result:', JSON.stringify(fallback))
    return respond(fallback, 200)
  }

  let fields: ParsedFields
  try {
    const prompt = buildPrompt(rawText, candidates)

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiResp.ok) {
      const errBody = await aiResp.text()
      console.error('[parse-business-card] Anthropic error:', aiResp.status, errBody)
      throw new Error('Anthropic API error')
    }

    const payload = await aiResp.json() as { content?: { text: string }[] }
    const aiText = payload.content?.[0]?.text ?? ''
    console.log('[parse-business-card] AI response:', aiText)

    const match = aiText.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON in AI response')

    const raw = JSON.parse(match[0]) as Record<string, unknown>
    fields = postProcess(raw, candidates)
  } catch (err) {
    console.error('[parse-business-card] AI step failed, using deterministic fallback:', err)
    fields = deterministicFallback(candidates)
  }

  console.log('[parse-business-card] final result:', JSON.stringify(fields))
  return respond(fields, 200)
})

// ── Helper ─────────────────────────────────────────────────────────────────────

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
