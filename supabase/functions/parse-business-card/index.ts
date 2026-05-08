// Elefante — parse-business-card edge function
//
// Receives raw OCR text extracted client-side from a business card image (Tesseract.js).
// Sends ONLY the text to the Anthropic API — the image is never transmitted.
// Returns cleaned, validated, structured contact fields for the user to review.
//
// Deploy:  supabase functions deploy parse-business-card
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── System prompt ──────────────────────────────────────────────────────────────
// Detailed rules to counteract the most common OCR/parsing failure modes.
// Structured by field, with explicit rejection rules and confidence guidance.

const SYSTEM_PROMPT = `\
You extract structured contact information from business card OCR text.
The text may contain OCR errors, noise, and label prefixes — be tolerant but never inventive.

OUTPUT FORMAT
Return ONLY a valid JSON object. No markdown, no explanation, nothing else.
Omit any field you cannot identify with high confidence. It is always better to omit a field than to return a fragment or a wrong value.

FIELD RULES

name
- The person's full human name (first name + last name).
- Usually prominent near the top of the card.
- Typically 2–4 words, title case, no digits or symbols.
- NEVER use a company name, domain, URL, email address, or job title as the name.
- If you cannot find a clear human name, omit this field.

role
- The person's job title or position.
- Often directly below the name.
- Examples: "Managing Director", "Sales Manager", "Head of Engineering".
- NEVER use a label like "Tel:", "Fax:", "Telefono:", "Mobile:" as a role.
- If uncertain, omit.

company
- The organisation's name.
- MUST be at least 3 characters long.
- MUST consist primarily of letters — not digits, hyphens, pipes, or punctuation fragments.
- PRIORITY: prefer lines containing legal entity identifiers: S.L., S.A., Ltd, GmbH, Inc, Corp, AG, SAS, BV, NV, LLC.
- HINT: the email domain often implies the company name. For example, domain "muepro.es" likely belongs to "MÜPRO" or "MUPRO Hispania S.L." — look for a matching word in the OCR text.
- NEVER use a phone number, fax number, URL, email address, or postal address as the company.
- NEVER use lines that start with any of these label prefixes (case-insensitive):
    Fax, Tel, Telefono, Teléfono, Telefon, Phone, Mobile, Móvil, Movil, Handy,
    E-Mail, Email, Web, www, http
- NEVER return fragments like "- Fy", "| Co", or any string that starts with a symbol or is fewer than 3 real letters.
- If no confident company name is found, omit this field.

email
- A valid email address (local@domain.tld).
- Lowercase the entire address.
- OCR often drops leading characters from the local part. If you have both a name and an email, check for truncation: for example, if the name is "Alvaro Imaz" and the email reads "varo.imaz@domain.com", the OCR likely dropped "al" — reconstruct the full email as "alvaro.imaz@domain.com".
- Preserve the domain exactly as OCR provided it.

phone
- A phone number with at least 7 digits.
- PREFER numbers labelled "Mobile", "Móvil", "Handy", or without any label, over numbers labelled "Fax".
- If a line is clearly labelled "Fax:", do NOT use it as the phone number unless it is the only number present.
- Include country code (e.g. +34, +49) if present.

city
- A city or location explicitly stated on the card.
- Omit if not clearly present.

GENERAL RULES
- Strip leading/trailing symbols from all values (hyphens, pipes, backslashes, colons).
- Normalise internal whitespace (collapse multiple spaces).
- When in doubt, omit the field. A missing field is better than a wrong one.
- NEVER hallucinate values not present in the OCR text.`

// ── Types ──────────────────────────────────────────────────────────────────────

interface ParsedFields {
  name?: string
  email?: string
  phone?: string
  company?: string
  role?: string
  city?: string
}

const ALLOWED_FIELDS = ['name', 'email', 'phone', 'company', 'role', 'city'] as const
type AllowedField = typeof ALLOWED_FIELDS[number]

// ── Post-processing ────────────────────────────────────────────────────────────
// Second line of defence after the AI response.
// Applies deterministic cleanup and rejection rules that are hard to express
// reliably in natural language.

// Remove leading/trailing noise characters the AI might have missed
function stripSymbols(value: string): string {
  return value
    .replace(/^[\s\-|\\\/,:;.'"`]+/, '')   // leading symbols
    .replace(/[\s\-|\\\/,:;.'"`]+$/, '')   // trailing symbols
    .replace(/\s{2,}/g, ' ')              // collapse internal whitespace
    .trim()
}

// Reject obviously invalid company names
function isValidCompany(value: string): boolean {
  if (value.length < 3) return false
  // Must have at least 2 actual letters
  const letterCount = (value.match(/[a-zA-ZÀ-ÖØ-öø-ÿ]/g) ?? []).length
  if (letterCount < 2) return false
  // Reject if it starts with a label prefix (case-insensitive)
  const lower = value.toLowerCase()
  const badPrefixes = [
    'fax', 'tel:', 'tel.', 'telefon', 'mobile', 'movil', 'móvil',
    'handy', 'e-mail', 'email', 'www', 'http',
  ]
  if (badPrefixes.some(p => lower.startsWith(p))) return false
  // Reject strings that are mostly non-letter characters
  if (letterCount / value.length < 0.4) return false
  return true
}

// Try to infer a company fallback from the email domain when the AI returned nothing
function inferCompanyFromEmail(email: string): string | undefined {
  const match = email.match(/@([a-zA-Z0-9-]+)(?:\.[a-zA-Z]{2,})+$/)
  if (!match) return undefined
  const domainPart = match[1] // e.g. "muepro" from "muepro.es"
  // Only use as fallback if it looks like a real company word (≥ 4 chars, all letters)
  if (domainPart.length >= 4 && /^[a-zA-Z]+$/.test(domainPart)) {
    return domainPart.charAt(0).toUpperCase() + domainPart.slice(1)
  }
  return undefined
}

function postProcess(raw: Record<string, unknown>): ParsedFields {
  const result: ParsedFields = {}

  for (const key of ALLOWED_FIELDS) {
    const val = raw[key]
    if (typeof val !== 'string') continue

    let cleaned = stripSymbols(val)
    if (!cleaned) continue

    if (key === 'email') {
      cleaned = cleaned.toLowerCase()
      // Basic format check — must have exactly one @ and a dot after it
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) continue
    }

    if (key === 'company') {
      if (!isValidCompany(cleaned)) continue
    }

    result[key as AllowedField] = cleaned
  }

  // Domain-based company fallback: if company is still missing but email is present,
  // use the email domain as a minimal hint (better than nothing / "- Fy")
  if (!result.company && result.email) {
    const inferred = inferCompanyFromEmail(result.email)
    if (inferred) result.company = inferred
  }

  return result
}

// ── Edge function ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405)
  }

  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return respond({ error: 'Unauthorized' }, 401)
  }

  // Parse + validate input
  let rawText: string
  try {
    const body = await req.json() as { rawText?: unknown }
    if (typeof body.rawText !== 'string' || !body.rawText.trim()) {
      return respond({ error: 'rawText must be a non-empty string' }, 400)
    }
    rawText = body.rawText.trim().slice(0, 2000)
  } catch {
    return respond({ error: 'Invalid JSON body' }, 400)
  }

  // Debug: log raw OCR input so failures can be diagnosed from Supabase logs
  console.log('[parse-business-card] rawText:\n' + rawText)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.error('[parse-business-card] ANTHROPIC_API_KEY secret is not set')
    return respond({ error: 'AI parsing is not configured on this deployment' }, 503)
  }

  // Call Anthropic API
  let aiResponse: Response
  try {
    aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: rawText }],
      }),
    })
  } catch (err) {
    console.error('[parse-business-card] Anthropic fetch error:', err)
    return respond({ error: 'Failed to reach AI service' }, 502)
  }

  if (!aiResponse.ok) {
    const errBody = await aiResponse.text()
    console.error('[parse-business-card] Anthropic error:', aiResponse.status, errBody)
    return respond({ error: 'AI service returned an error' }, 502)
  }

  // Extract JSON from AI response and post-process
  let fields: ParsedFields
  try {
    const payload = await aiResponse.json() as { content?: { text: string }[] }
    const aiText = payload.content?.[0]?.text ?? ''

    // Debug: log what the model returned before we touch it
    console.log('[parse-business-card] AI raw response:', aiText)

    const match = aiText.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object in AI response')

    const raw = JSON.parse(match[0]) as Record<string, unknown>

    // Apply post-processing: symbol stripping, validation, domain inference
    fields = postProcess(raw)
  } catch (err) {
    console.error('[parse-business-card] parse/process error:', err)
    return respond({ error: 'Failed to parse AI response' }, 422)
  }

  // Debug: log the final cleaned result
  console.log('[parse-business-card] final fields:', JSON.stringify(fields))

  return respond(fields, 200)
})

// ── Helper ─────────────────────────────────────────────────────────────────────

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
