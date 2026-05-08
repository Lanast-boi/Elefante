'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Contact } from '@/lib/types'
import ContactForm from '@/components/ContactForm'
import BusinessCardScanner from '@/components/BusinessCardScanner'

export default function NewContactPage() {
  const router = useRouter()

  // prefill holds the last scan result; formKey forces ContactForm to remount
  // with fresh initial values whenever a scan is applied.
  const [prefill, setPrefill] = useState<Partial<Contact>>({})
  const [formKey, setFormKey] = useState(0)
  const [scannedBanner, setScannedBanner] = useState(false)

  const handleExtract = (fields: Partial<Contact>) => {
    setPrefill(fields)
    setFormKey(k => k + 1)
    setScannedBanner(true)
  }

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
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors mb-8"
      >
        ← All contacts
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">New Contact</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2">
            Name is the only required field. Everything else can be added later.
          </p>
        </div>
      </div>

      {/* Scanner — sits between header and form */}
      <div className="mt-5 mb-6">
        <BusinessCardScanner onExtract={handleExtract} />
      </div>

      {/* Pre-fill banner — shows after a scan is applied */}
      {scannedBanner && (
        <div className="flex items-center justify-between rounded-xl bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 mb-5">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Pre-filled from business card — review and edit before saving.
          </p>
          <button
            type="button"
            onClick={() => {
              setPrefill({})
              setFormKey(k => k + 1)
              setScannedBanner(false)
            }}
            className="ml-3 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors shrink-0"
          >
            Clear
          </button>
        </div>
      )}

      {/* Form — key forces remount when scan is applied */}
      <ContactForm
        key={formKey}
        initial={prefill}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/')}
        submitLabel="Add Contact"
      />
    </div>
  )
}
