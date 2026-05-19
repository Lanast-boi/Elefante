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

// Fetch every contact by paging through Supabase's 1,000-row default limit.
// Each call to .range(from, to) returns at most 1,000 rows; we keep requesting
// the next window until a batch comes back smaller than BATCH_SIZE, which means
// we've reached the end of the table. No config change required — scales to any size.
async function fetchAllContacts(): Promise<ContactWithNotes[]> {
  const BATCH_SIZE = 1000
  const all: ContactWithNotes[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*, notes(text)')
      .order('name')
      .range(from, from + BATCH_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    all.push(...(data as ContactWithNotes[]))

    if (data.length < BATCH_SIZE) break   // last batch — no more rows
    from += BATCH_SIZE
  }

  return all
}

export default function HomePage() {
  const [contacts, setContacts] = useState<ContactWithNotes[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const all = await fetchAllContacts()
        setContacts(all)
      } catch (err) {
        console.error('[Contacts] Failed to load:', err)
      } finally {
        setLoading(false)
      }
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
      <div className="sticky top-14 z-10 bg-zinc-50 dark:bg-zinc-950 pt-2 pb-4 -mx-4 px-4">
        <div className="relative">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search people, companies, notes, places…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 pr-10 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-400 focus:border-transparent transition shadow-sm"
          />
          {isSearching && (
            <button
              onClick={() => { setSearch(''); searchRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors text-lg leading-none"
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
            <p className="text-zinc-500 dark:text-zinc-400 text-sm font-medium">No results for "{search}"</p>
            <p className="text-zinc-400 dark:text-zinc-500 text-xs mt-1">Try a name, company, tag, or something from your notes.</p>
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
            <p className="text-zinc-500 dark:text-zinc-400 font-medium">No contacts yet</p>
            <p className="text-zinc-400 dark:text-zinc-500 text-sm mt-1">Start building your network.</p>
            <Link
              href="/contacts/new"
              className="inline-block mt-5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium px-5 py-2.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
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

      {/* Floating add button — visible only on mobile (nav has + Add on desktop) */}
      <Link
        href="/contacts/new"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-2xl rounded-full flex items-center justify-center shadow-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 active:scale-95 transition-all"
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
        <p className={`text-xs font-semibold uppercase tracking-widest ${
          variant === 'red' ? 'text-red-500 dark:text-red-400' : 'text-zinc-400 dark:text-zinc-500'
        }`}>
          {title}
        </p>
        <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${
          variant === 'red'
            ? 'bg-red-50 dark:bg-red-950/40 text-red-500 dark:text-red-400'
            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
        }`}>
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {children}
      </div>
    </section>
  )
}
