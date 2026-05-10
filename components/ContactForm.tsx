'use client'
import { useState } from 'react'
import { Contact } from '@/lib/types'
import CountrySelect from '@/components/CountrySelect'

type FormData = {
  name: string
  email: string
  phone: string
  linkedin_url: string
  company: string
  role: string
  city: string
  origin_country: string
  origin_city: string
  how_we_met: string
  tags: string
  next_follow_up_date: string
  follow_up_note: string
  familiarity: string          // "1" | "2" | "3"
}

type InternalForm = FormData & { where_we_met: string }

function splitHowWeMet(value: string | null | undefined): [string, string] {
  if (!value) return ['', '']
  const idx = value.indexOf(' — ')
  if (idx === -1) return ['', value]
  return [value.slice(0, idx), value.slice(idx + 3)]
}

interface Props {
  initial?: Partial<Contact>
  onSubmit: (data: FormData) => Promise<void>
  onCancel?: () => void
  submitLabel?: string
}

// Base input — theme-aware, used for all text/email/url/tel inputs
const inp = [
  'w-full rounded-xl border px-4 py-3 text-sm outline-none transition',
  'border-zinc-200 dark:border-zinc-700',
  'bg-white dark:bg-zinc-800',
  'text-zinc-900 dark:text-zinc-100',
  'placeholder-zinc-400 dark:placeholder-zinc-500',
  'focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-400 focus:border-transparent',
].join(' ')

const lbl = 'text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1.5 block'

const FAMILIARITY_OPTIONS = [
  { value: '1', label: '1', sub: 'Light' },
  { value: '2', label: '2', sub: 'Familiar' },
  { value: '3', label: '3', sub: 'Close' },
]

export default function ContactForm({ initial = {}, onSubmit, onCancel, submitLabel = 'Save' }: Props) {
  const hasSecondaryValues = !!(
    initial.role || initial.city || initial.tags ||
    initial.how_we_met || initial.next_follow_up_date || initial.follow_up_note ||
    initial.origin_country || initial.origin_city || initial.linkedin_url
  )

  const [where, how] = splitHowWeMet(initial.how_we_met)
  const [form, setForm] = useState<InternalForm>({
    name: initial.name ?? '',
    email: initial.email ?? '',
    phone: initial.phone ?? '',
    linkedin_url: initial.linkedin_url ?? '',
    company: initial.company ?? '',
    role: initial.role ?? '',
    city: initial.city ?? '',
    origin_country: initial.origin_country ?? '',
    origin_city: initial.origin_city ?? '',
    where_we_met: where,
    how_we_met: how,
    tags: initial.tags ?? '',
    next_follow_up_date: initial.next_follow_up_date ?? '',
    follow_up_note: initial.follow_up_note ?? '',
    familiarity: String(initial.familiarity ?? 1),
  })
  const [showMore, setShowMore] = useState(hasSecondaryValues)
  const [loading, setLoading] = useState(false)

  const set = (field: keyof InternalForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { where_we_met, ...rest } = form
    const combined = [where_we_met.trim(), rest.how_we_met.trim()].filter(Boolean).join(' — ')
    await onSubmit({ ...rest, how_we_met: combined })
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">

      {/* — Name — */}
      <div>
        <label className={lbl}>Name</label>
        <input
          className={inp}
          value={form.name}
          onChange={set('name')}
          required
          placeholder="Who are you adding?"
          autoFocus
        />
      </div>

      {/* — Familiarity — */}
      <div>
        <label className={lbl}>Familiarity</label>
        <div className="flex gap-2">
          {FAMILIARITY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setForm(prev => ({ ...prev, familiarity: opt.value }))}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                form.familiarity === opt.value
                  ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100 text-white dark:text-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              {opt.label}
              <span className={`block text-xs font-normal mt-0.5 ${
                form.familiarity === opt.value
                  ? 'opacity-60'
                  : 'text-zinc-400 dark:text-zinc-500'
              }`}>
                {opt.sub}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* — Company + Phone — */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Company</label>
          <input className={inp} value={form.company} onChange={set('company')} placeholder="Where do they work?" />
        </div>
        <div>
          <label className={lbl}>Phone</label>
          <input className={inp} value={form.phone} onChange={set('phone')} placeholder="+1 234 567 8900" />
        </div>
      </div>

      {/* — Email — */}
      <div>
        <label className={lbl}>Email</label>
        <input className={inp} type="email" value={form.email} onChange={set('email')} placeholder="Their email address" />
      </div>

      {/* — Secondary toggle — */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-zinc-100 dark:border-zinc-800" />
        <button
          type="button"
          onClick={() => setShowMore(v => !v)}
          className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors shrink-0 flex items-center gap-1"
        >
          {showMore ? 'Less details ↑' : 'More details ↓'}
        </button>
        <div className="flex-1 border-t border-zinc-100 dark:border-zinc-800" />
      </div>

      {/* — Secondary fields — */}
      {showMore && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Role</label>
              <input className={inp} value={form.role} onChange={set('role')} placeholder="What do they do?" />
            </div>
            <div>
              <label className={lbl}>City</label>
              <input className={inp} value={form.city} onChange={set('city')} placeholder="Where are they based?" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Country of origin</label>
              <CountrySelect
                value={form.origin_country}
                onChange={v => setForm(prev => ({ ...prev, origin_country: v }))}
              />
            </div>
            <div>
              <label className={lbl}>City of origin</label>
              <input className={inp} value={form.origin_city} onChange={set('origin_city')} placeholder="e.g. Athens, Madrid, Berlin" />
            </div>
          </div>

          <div>
            <label className={lbl}>Tags</label>
            <input
              className={inp}
              value={form.tags}
              onChange={set('tags')}
              placeholder="e.g. investor, friend, design — separate with commas"
            />
          </div>

          <div>
            <label className={lbl}>Where we met</label>
            <input
              className={inp}
              value={form.where_we_met}
              onChange={set('where_we_met')}
              placeholder="IE Business School, Web Summit Lisbon, Marco's wedding…"
            />
          </div>

          <div>
            <label className={lbl}>How we met</label>
            <textarea
              className={`${inp} resize-none`}
              value={form.how_we_met}
              onChange={set('how_we_met')}
              placeholder="Introduced by a mutual friend, sat next to each other at a workshop…"
              rows={3}
            />
          </div>

          <div>
            <label className={lbl}>Next follow-up</label>
            <input
              className={inp}
              type="date"
              value={form.next_follow_up_date}
              onChange={set('next_follow_up_date')}
            />
          </div>

          <div>
            <label className={lbl}>Follow-up note</label>
            <input
              className={inp}
              value={form.follow_up_note}
              onChange={set('follow_up_note')}
              placeholder="e.g. ask about Madrid project, send intro, check in"
            />
          </div>

          <div>
            <label className={lbl}>LinkedIn</label>
            <input
              className={inp}
              value={form.linkedin_url}
              onChange={set('linkedin_url')}
              placeholder="linkedin.com/in/username"
              type="url"
              inputMode="url"
            />
          </div>
        </div>
      )}

      {/* — CTA — */}
      <div className="flex flex-col sm:flex-row gap-3 pt-3">
        <button
          type="submit"
          disabled={loading}
          className="w-full sm:w-auto rounded-xl bg-zinc-900 dark:bg-zinc-100 px-8 py-3 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 active:scale-[0.98] transition-all disabled:opacity-40"
        >
          {loading ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto rounded-xl border border-zinc-200 dark:border-zinc-700 px-8 py-3 text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:scale-[0.98] transition-all"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
