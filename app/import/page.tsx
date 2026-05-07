import Link from 'next/link'
import ImportFlow from '@/components/import/ImportFlow'

export default function ImportPage() {
  return (
    <div className="pb-16">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 transition-colors mb-6"
      >
        ← All contacts
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Import Contacts</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Upload a .csv or .xlsx file. You'll preview the data and map fields before anything is saved.
        </p>
      </div>

      <ImportFlow />
    </div>
  )
}
