'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Contact } from '@/lib/types'

export default function FollowUpsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      // Batch through Supabase's 1,000-row limit so follow-ups are never truncated.
      const BATCH_SIZE = 1000
      const all: Contact[] = []
      let from = 0

      try {
        while (true) {
          const { data, error: err } = await supabase
            .from('contacts')
            .select('*')
            .not('next_follow_up_date', 'is', null)
            .order('next_follow_up_date')
            .range(from, from + BATCH_SIZE - 1)

          if (err) throw err
          if (!data || data.length === 0) break

          all.push(...(data as Contact[]))

          if (data.length < BATCH_SIZE) break
          from += BATCH_SIZE
        }

        setContacts(all)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('Failed to load follow-ups:', msg)
        setError(msg)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Planned Follow-ups</h1>
        <p className="text-sm text-zinc-400 mt-1">
          People you've set a date to reconnect with.
        </p>
      </div>

      {loading && <p className="text-sm text-zinc-400 text-center py-12">Loading…</p>}

      {!loading && error && (
        <p className="text-sm text-red-400 text-center py-12">
          Could not load follow-ups — {error}
        </p>
      )}

      {!loading && !error && contacts.length === 0 && (
        <div className="text-center py-20">
          <p className="text-sm text-zinc-400">No follow-up dates saved yet.</p>
          <p className="text-xs text-zinc-300 mt-1">
            Open any contact and set a follow-up date to see them here.
          </p>
        </div>
      )}

      {!loading && !error && contacts.length > 0 && (
        <div className="flex flex-col gap-2">
          {contacts.map(c => <FollowUpRow key={c.id} contact={c} />)}
        </div>
      )}
    </div>
  )
}

function FollowUpRow({ contact: c }: { contact: Contact }) {
  const today = new Date().toISOString().split('T')[0]
  const isOverdue = c.next_follow_up_date! < today

  return (
    <Link
      href={`/contacts/${c.id}`}
      className="group bg-white rounded-2xl border border-zinc-100 px-5 py-4 hover:border-zinc-200 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-6">
        {/* Left: identity + note */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 group-hover:text-zinc-600 transition-colors">
            {c.name}
          </p>

          {(c.role || c.company) && (
            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              {[c.role, c.company].filter(Boolean).join(' · ')}
            </p>
          )}

          {c.follow_up_note && (
            <p className="text-xs text-zinc-400 mt-2 italic leading-relaxed">
              {c.follow_up_note}
            </p>
          )}
        </div>

        {/* Right: date */}
        <div className="text-right text-xs shrink-0 pt-0.5">
          <p className={`font-medium ${isOverdue ? 'text-red-400' : 'text-zinc-500'}`}>
            {c.next_follow_up_date}
          </p>
          {c.last_interaction_date && (
            <p className="text-zinc-300 mt-1">Last · {c.last_interaction_date}</p>
          )}
        </div>
      </div>
    </Link>
  )
}
