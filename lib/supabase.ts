import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton — createClient is deferred until the first property access.
// This prevents "supabaseUrl is required" errors during Next.js static prerendering,
// where the module graph is loaded but Supabase methods are never actually called
// (all usage lives inside useEffect or event handlers, which don't run on the server).
let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) {
      throw new Error(
        '[Elefante] Supabase environment variables are not configured.\n' +
        'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment.'
      )
    }
    _client = createClient(url, key)
  }
  return _client
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver)
  },
})
