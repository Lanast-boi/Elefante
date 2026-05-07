'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ContactForm from '@/components/ContactForm'

export default function NewContactPage() {
  const router = useRouter()

  const handleSubmit = async (data: Record<string, string>) => {
    const cleaned = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()])
    )
    const toInsert = {
      ...cleaned,
      familiarity: cleaned.familiarity ? parseInt(cleaned.familiarity as string) : 1,
    }
    const { data: contact, error } = await supabase
      .from('contacts')
      .insert(toInsert)
      .select()
      .single()
    if (!error && contact) {
      router.push(`/contacts/${contact.id}`)
    }
  }

  return (
    <div className="max-w-lg">
      {/* Back */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 transition-colors mb-8"
      >
        ← All contacts
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">New Contact</h1>
        <p className="text-sm text-zinc-400 mt-2">
          Name is the only required field. Everything else can be added later.
        </p>
      </div>

      {/* Form — no card wrapper, lighter feel */}
      <ContactForm
        onSubmit={handleSubmit}
        onCancel={() => router.push('/')}
        submitLabel="Add Contact"
      />
    </div>
  )
}
