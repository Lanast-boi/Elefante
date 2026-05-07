'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Contact, Note } from '@/lib/types'
import { FAMILIARITY_LABEL } from '@/lib/constants'
import ContactForm from '@/components/ContactForm'
import NoteForm from '@/components/NoteForm'
import NoteList from '@/components/NoteList'

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [contact, setContact] = useState<Contact | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [{ data: c }, { data: n }] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', id).single(),
        supabase.from('notes').select('*').eq('contact_id', id).order('date', { ascending: false }),
      ])
      setContact(c)
      setNotes(n || [])
      setLoading(false)
    }
    load()
  }, [id])

  const handleEdit = async (data: Record<string, string>) => {
    const cleaned = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()])
    )

    const rawFamiliarity = parseInt(cleaned.familiarity as string)
    const familiarity = [1, 2, 3].includes(rawFamiliarity) ? rawFamiliarity : 1

    const toUpdate = {
      ...cleaned,
      familiarity,
      updated_at: new Date().toISOString(),
    }

    const { data: updated, error } = await supabase
      .from('contacts')
      .update(toUpdate)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Failed to save contact:', error.message)
      return
    }

    setContact(updated)
    setEditing(false)
  }

  const handleAddNote = async (text: string, date: string) => {
    const { data: note } = await supabase
      .from('notes')
      .insert({ contact_id: id, text, date })
      .select()
      .single()
    if (note) {
      const isNewer = !contact!.last_interaction_date || date >= contact!.last_interaction_date
      await supabase
        .from('contacts')
        .update({
          ...(isNewer ? { last_interaction_date: date } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      setNotes(prev => [note, ...prev])
      if (isNewer) setContact(prev => prev ? { ...prev, last_interaction_date: date } : prev)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete ${contact?.name}? This cannot be undone.`)) return
    await supabase.from('contacts').delete().eq('id', id)
    router.push('/')
  }

  if (loading) return <p className="text-sm text-zinc-400 text-center py-20">Loading…</p>
  if (!contact) return <p className="text-sm text-zinc-400 text-center py-20">Contact not found.</p>

  const tags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(Boolean) : []
  const isOverdue = contact.next_follow_up_date && contact.next_follow_up_date < today()
  const isUpcoming = contact.next_follow_up_date && contact.next_follow_up_date >= today()

  return (
    <div className="pb-16">
      {/* Back nav */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 transition-colors mb-6"
      >
        ← All contacts
      </Link>

      {/* Summary card or Edit form */}
      {editing ? (
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 sm:p-8 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-semibold text-zinc-900">Edit Contact</h2>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </div>
          <ContactForm
            initial={contact}
            onSubmit={handleEdit}
            onCancel={() => setEditing(false)}
            submitLabel="Save Changes"
          />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6 sm:p-8 mb-6">
          {/* Name + actions row */}
          <div className="flex items-start justify-between gap-4 mb-1">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 leading-tight">
              {contact.name}
            </h1>
            <button
              onClick={() => setEditing(true)}
              className="shrink-0 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 active:scale-[0.97] transition-all"
            >
              Edit
            </button>
          </div>

          {/* Role + company */}
          {(contact.role || contact.company) && (
            <p className="text-sm text-zinc-500 mb-3">
              {[contact.role, contact.company].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* City */}
          {contact.city && (
            <p className="text-xs text-zinc-400 mb-3">{contact.city}</p>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {tags.map(tag => (
                <span key={tag} className="rounded-full bg-zinc-100 text-zinc-500 px-2.5 py-0.5 text-xs font-medium">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="border-t border-zinc-100 my-5" />

          {/* Fields grid */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4">
            {contact.email && <InfoField label="Email" value={contact.email} />}
            {contact.phone && <InfoField label="Phone" value={contact.phone} />}
            <FamiliarityField value={contact.familiarity} />

            {contact.next_follow_up_date && (
              <div>
                <dt className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">Next Follow-up</dt>
                <dd>
                  <span className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-2.5 py-1 ${
                    isOverdue
                      ? 'bg-red-50 text-red-600'
                      : 'bg-blue-50 text-blue-600'
                  }`}>
                    {isOverdue && <span className="text-xs">⚠</span>}
                    {isOverdue ? `Overdue · ${contact.next_follow_up_date}` : contact.next_follow_up_date}
                  </span>
                  {contact.follow_up_note && (
                    <p className="text-xs text-zinc-400 mt-1.5 italic leading-relaxed">
                      {contact.follow_up_note}
                    </p>
                  )}
                </dd>
              </div>
            )}

            {contact.last_interaction_date && (
              <InfoField label="Last Interaction" value={contact.last_interaction_date} />
            )}

            {(contact.origin_city || contact.origin_country) && (
              <InfoField
                label="From"
                value={[contact.origin_city, contact.origin_country].filter(Boolean).join(', ')}
              />
            )}

            {contact.how_we_met && (() => {
              const idx = contact.how_we_met!.indexOf(' — ')
              const where = idx !== -1 ? contact.how_we_met!.slice(0, idx) : null
              const how = idx !== -1 ? contact.how_we_met!.slice(idx + 3) : contact.how_we_met
              return (
                <>
                  {where && <InfoField label="Where We Met" value={where} />}
                  {how && <InfoField label="How We Met" value={how} />}
                </>
              )
            })()}
          </dl>
        </div>
      )}

      {/* Interactions */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          Interactions{notes.length > 0 && <span className="text-zinc-300 normal-case tracking-normal font-normal"> · {notes.length}</span>}
        </p>
        <NoteForm onAdd={handleAddNote} />
        <NoteList notes={notes} />
      </div>

      {/* Delete — visually deemphasized, at the bottom */}
      <div className="mt-14 pt-6 border-t border-zinc-100 flex justify-center">
        <button
          onClick={handleDelete}
          className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
        >
          Delete contact
        </button>
      </div>
    </div>
  )
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">{label}</dt>
      <dd className="text-sm text-zinc-800">{value}</dd>
    </div>
  )
}

function FamiliarityField({ value }: { value: number | null }) {
  const f = value ?? 2
  return (
    <div>
      <dt className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">Familiarity</dt>
      <dd className="flex items-center gap-2">
        <div className="flex gap-1" title={FAMILIARITY_LABEL[f]}>
          {[1, 2, 3].map(n => (
            <div key={n} className={`w-2 h-2 rounded-full ${f >= n ? 'bg-zinc-400' : 'bg-zinc-200'}`} />
          ))}
        </div>
        <span className="text-sm text-zinc-800">{FAMILIARITY_LABEL[f] ?? f}</span>
      </dd>
    </div>
  )
}
