// Elefante — parse-business-card edge function
//
// Receives raw OCR text extracted client-side from a business card image (Tesseract.js).
// Sends ONLY the text to the Anthropic API — the image is never transmitted.
// Returns a structured JSON object of contact fields for the user to review.
//
// Deploy:  supabase functions deploy parse-business-card
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM_PROMPT = `\
You extract structured contact information from business card OCR text.

Return ONLY a valid JSON object. Include only fields you can clearly identify in the text.
Allowed fields: name, email, phone, company, role, city.

Rules:
- name: the person's full name (never the company name)
- email: lowercase
- phone: preserve the original format, including country code if present
- company: organisation or company name
- role: job title or role
- city: city or location if clearly stated

Do not guess or invent values. Do not include markdown, explanation, or any text outside the JSON object.`

interface ParsedFields {
  name?: string
  email?: string
  phone?: string
  company?: string
  role?: string
  city?: string
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // Basic auth check — Supabase gateway validates the anon key before this runs,
  // so we just verify an Authorization header was forwarded (user is logged in).
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // Parse + validate input
  let rawText: string
  try {
    const body = await req.json() as { rawText?: unknown }
    if (typeof body.rawText !== 'string' || !body.rawText.trim()) {
      return json({ error: 'rawText must be a non-empty string' }, 400)
    }
    // Hard cap: a business card should never produce more than ~500 chars of OCR.
    // Capping at 2000 chars prevents misuse while being generous for noisy OCR.
    rawText = body.rawText.trim().slice(0, 2000)
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Check API key is configured
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.error('[parse-business-card] ANTHROPIC_API_KEY secret is not set')
    return json({ error: 'AI parsing is not configured on this deployment' }, 503)
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
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: rawText }],
      }),
    })
  } catch (err) {
    console.error('[parse-business-card] Anthropic fetch error:', err)
    return json({ error: 'Failed to reach AI service' }, 502)
  }

  if (!aiResponse.ok) {
    const body = await aiResponse.text()
    console.error('[parse-business-card] Anthropic error:', aiResponse.status, body)
    return json({ error: 'AI service returned an error' }, 502)
  }

  // Extract and validate the JSON from the AI response
  let fields: ParsedFields
  try {
    const payload = await aiResponse.json() as { content?: { text: string }[] }
    const text = payload.content?.[0]?.text ?? ''

    // Greedy match finds the outermost { ... } block in case of any surrounding text
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object in response')

    const raw = JSON.parse(match[0]) as Record<string, unknown>

    // Validate: only accept string values for the known fields
    fields = {}
    const ALLOWED = ['name', 'email', 'phone', 'company', 'role', 'city'] as const
    for (const key of ALLOWED) {
      const val = raw[key]
      if (typeof val === 'string' && val.trim()) {
        fields[key] = key === 'email' ? val.toLowerCase().trim() : val.trim()
      }
    }
  } catch (err) {
    console.error('[parse-business-card] JSON parse error:', err)
    return json({ error: 'Failed to parse AI response' }, 422)
  }

  return json(fields, 200)
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
