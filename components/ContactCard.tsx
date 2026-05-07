import Link from 'next/link'
import { ContactWithNotes } from '@/lib/types'
import { getMatchedNoteSnippet } from '@/lib/search'
import { FAMILIARITY_LABEL } from '@/lib/constants'

interface Props {
  contact: ContactWithNotes
  variant?: 'default' | 'attention'
  query?: string
}

function Highlight({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-zinc-200 rounded-sm">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  )
}

function H({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>
  return <Highlight text={text} query={query} />
}

function FamiliarityDots({ value }: { value: number | null }) {
  const f = value ?? 2
  return (
    <div className="flex gap-1 mt-2" title={FAMILIARITY_LABEL[f]}>
      {[1, 2, 3].map(n => (
        <div
          key={n}
          className={`w-2 h-2 rounded-full ${f >= n ? 'bg-zinc-400' : 'bg-zinc-200'}`}
        />
      ))}
    </div>
  )
}

export default function ContactCard({ contact: c, variant = 'default', query }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const isOverdue = c.next_follow_up_date && c.next_follow_up_date < today
  const isUpcoming = c.next_follow_up_date && c.next_follow_up_date >= today
  const tags = c.tags ? c.tags.split(',').map(t => t.trim()).filter(Boolean) : []
  const noteSnippet = query ? getMatchedNoteSnippet(c.notes, query) : null
  const showSnippet = noteSnippet && !c.name.toLowerCase().includes(query!.toLowerCase())

  return (
    <Link
      href={`/contacts/${c.id}`}
      className={`group block rounded-2xl border px-5 py-4 transition-all hover:shadow-sm ${
        variant === 'attention'
          ? 'bg-red-50/60 border-red-100 hover:border-red-200'
          : 'bg-white border-zinc-100 hover:border-zinc-300'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: identity */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 group-hover:text-zinc-700 transition-colors truncate">
            <H text={c.name} query={query} />
          </p>

          {(c.role || c.company) && (
            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              {c.role && c.company
                ? <><H text={c.role} query={query} /> · <H text={c.company} query={query} /></>
                : <H text={(c.role || c.company)!} query={query} />
              }
            </p>
          )}

          {c.city && (
            <p className="text-xs text-zinc-400 mt-0.5">
              <H text={c.city} query={query} />
            </p>
          )}

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.map(tag => (
                <span
                  key={tag}
                  className="rounded-full bg-zinc-100 text-zinc-500 px-2 py-0.5 text-xs leading-none"
                >
                  <H text={tag} query={query} />
                </span>
              ))}
            </div>
          )}

          {showSnippet && (
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed line-clamp-2 italic">
              <Highlight text={noteSnippet!} query={query!} />
            </p>
          )}

          <FamiliarityDots value={c.familiarity} />
        </div>

        {/* Right: dates */}
        <div className="text-right text-xs shrink-0 space-y-1 pt-0.5">
          {isOverdue && (
            <p className="font-semibold text-red-500">
              Overdue · {c.next_follow_up_date}
            </p>
          )}
          {isUpcoming && (
            <p className="font-medium text-blue-500">
              Follow up · {c.next_follow_up_date}
            </p>
          )}
          {c.last_interaction_date && (
            <p className="text-zinc-400">Last · {c.last_interaction_date}</p>
          )}
        </div>
      </div>
    </Link>
  )
}
