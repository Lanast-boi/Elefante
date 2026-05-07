'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ContactWithNotes } from '@/lib/types'
import { searchContacts } from '@/lib/search'
import ContactCard from '@/components/ContactCard'

const TODAY = () => new Date().toISOString().split('T')[0]

function sortAll(contacts: ContactWithNotes[]): ContactWithNotes[] {
  const today = TODAY()
  return [...contacts].sort((a, b) => {
    const aUpcoming = a.next_follow_up_date && a.next_follow_up_date >= today
    const bUpcoming = b.next_follow_up_date && b.next_follow_up_date >= today
    if (aUpcoming && !bUpcoming) return -1
    if (!aUpcoming && bUpcoming) return 1
    if (aUpcoming && bUpcoming) return a.next_follow_up_date!.localeCompare(b.next_follow_up_date!)
    if (a.last_interaction_date && !b.last_interaction_date) return -1
    if (!a.last_interaction_date && b.last_interaction_date) return 1
    if (a.last_interaction_date && b.last_interaction_date) {
      return b.last_interaction_date.localeCompare(a.last_interaction_date)
    }
    return a.name.localeCompare(b.name)
  })
}

export default function HomePage() {
  const [contacts, setContacts] = useState<ContactWithNotes[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('contacts')
        .select('*, notes(text)')
        .order('name')
      setContacts((data as ContactWithNotes[]) || [])
      setLoading(false)
    }
    load()
  }, [])

  const q = search.trim()
  const isSearching = q.length > 0
  const results = isSearching ? searchContacts(contacts, q) : null

  const today = TODAY()
  const needsAttention = contacts.filter(c => c.next_follow_up_date && c.next_follow_up_date < today)
  const needsAttentionIds = new Set(needsAttention.map(c => c.id))
  const recent = contacts
    .filter(c => c.last_interaction_date && !needsAttentionIds.has(c.id))
    .sort((a, b) => b.last_interaction_date!.localeCompare(a.last_interaction_date!))
    .slice(0, 5)
  const allSorted = sortAll(contacts)

  return (
    <div className="relative pb-24">
      {/* Sticky search */}
      <div className="sticky top-14 z-10 bg-zinc-50 pt-2 pb-4 -mx-4 px-4">
        <div className="relative">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search people, companies, notes, places…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 pr-10 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition shadow-sm"
          />
          {isSearching && (
            <button
              onClick={() => { setSearch(''); searchRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors text-lg leading-none"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {loading && (
        <p className="text-sm text-zinc-400 text-center py-16">Loading…</p>
      )}

      {/* Search results */}
      {!loading && results !== null && (
        results.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-500 text-sm font-medium">No results for "{search}"</p>
            <p className="text-zinc-400 text-xs mt-1">Try a name, company, tag, or something from your notes.</p>
          </div>
        ) : (
          <Section title="Results" count={results.length}>
            {results.map(c => <ContactCard key={c.id} contact={c} query={q} />)}
          </Section>
        )
      )}

      {/* Sectioned home view */}
      {!loading && results === null && (
        contacts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-500 font-medium">No contacts yet</p>
            <p className="text-zinc-400 text-sm mt-1">Start building your network.</p>
            <Link
              href="/contacts/new"
              className="inline-block mt-5 rounded-xl bg-zinc-900 text-white text-sm font-medium px-5 py-2.5 hover:bg-zinc-700 transition-colors"
            >
              Add first contact
            </Link>
          </div>
        ) : (
          <>
            {needsAttention.length > 0 && (
              <Section title="Needs Attention" count={needsAttention.length} variant="red">
                {needsAttention.map(c => (
                  <ContactCard key={c.id} contact={c} variant="attention" />
                ))}
              </Section>
            )}

            {recent.length > 0 && (
              <Section title="Recent" count={recent.length}>
                {recent.map(c => <ContactCard key={c.id} contact={c} />)}
              </Section>
            )}

            <Section title="All Contacts" count={allSorted.length}>
              {allSorted.map(c => <ContactCard key={c.id} contact={c} />)}
            </Section>
          </>
        )
      )}

      {/* Floating add button */}
      <Link
        href="/contacts/new"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-zinc-900 text-white text-2xl rounded-full flex items-center justify-center shadow-lg hover:bg-zinc-700 active:scale-95 transition-all"
        aria-label="Add contact"
      >
        +
      </Link>
    </div>
  )
}

function Section({
  title,
  count,
  variant = 'default',
  children,
}: {
  title: string
  count: number
  variant?: 'default' | 'red'
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <p className={`text-xs font-semibold uppercase tracking-widest ${variant === 'red' ? 'text-red-500' : 'text-zinc-400'}`}>
          {title}
        </p>
        <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${variant === 'red' ? 'bg-red-50 text-red-500' : 'bg-zinc-100 text-zinc-500'}`}>
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {children}
      </div>
    </section>
  )
}
