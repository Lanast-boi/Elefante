'use client'

export type ElefeKey = 'name' | 'company' | 'role' | 'city' | 'origin_country' | 'origin_city' | 'how_we_met' | 'tags' | 'email' | 'phone' | 'linkedin_url'
export type Mapping = Partial<Record<ElefeKey, string>>
export interface Defaults { how_we_met: string }

const FIELDS: { key: ElefeKey; label: string; required?: boolean }[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'company', label: 'Company' },
  { key: 'role', label: 'Role / Title' },
  { key: 'city', label: 'City' },
  { key: 'origin_country', label: 'Country of Origin' },
  { key: 'origin_city', label: 'City of Origin' },
  { key: 'how_we_met', label: 'How We Met' },
  { key: 'tags', label: 'Tags' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'linkedin_url', label: 'LinkedIn URL' },
]

interface Props {
  headers: string[]
  mapping: Mapping
  onChange: (mapping: Mapping) => void
  defaults: Defaults
  onDefaultsChange: (defaults: Defaults) => void
}

export default function FieldMapper({ headers, mapping, onChange, defaults, onDefaultsChange }: Props) {
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              {f.label}
              {f.required && <span className="ml-1 text-red-400">*</span>}
            </label>
            <select
              value={mapping[f.key] ?? ''}
              onChange={e => {
                const val = e.target.value
                const next = { ...mapping }
                if (val) next[f.key] = val
                else delete next[f.key]
                onChange(next)
              }}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition"
            >
              <option value="">— Not mapped</option>
              {headers.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Defaults */}
      <div className="border-t border-zinc-100 pt-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-1">Defaults</p>
        <p className="text-xs text-zinc-400 mb-4">Applied when a field is empty or not mapped.</p>
        <div className="max-w-xs">
          <label className="block text-xs font-medium text-zinc-500 mb-1.5">How We Met</label>
          <input
            type="text"
            value={defaults.how_we_met}
            onChange={e => onDefaultsChange({ ...defaults, how_we_met: e.target.value })}
            placeholder="e.g. LinkedIn"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition"
          />
        </div>
      </div>
    </div>
  )
}
