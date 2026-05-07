'use client'
import { useEffect, useRef, useState } from 'react'
import { COUNTRIES } from '@/lib/countries'

interface Props {
  value: string
  onChange: (value: string) => void
}

export default function CountrySelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close when clicking outside
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const filtered = query
    ? COUNTRIES.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : COUNTRIES

  const handleSelect = (country: string) => {
    onChange(country)
    setOpen(false)
    setQuery('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          value={open ? query : value}
          placeholder={open ? 'Search country…' : (value || 'Search country…')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 pr-8 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition"
        />
        {value && !open && (
          <button
            type="button"
            onClick={handleClear}
            tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors text-lg leading-none"
            aria-label="Clear"
          >
            ×
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 top-full mt-1 w-full max-h-56 overflow-y-auto bg-white rounded-xl border border-zinc-200 shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400">No match</p>
          ) : (
            filtered.map(country => (
              <button
                key={country}
                type="button"
                onMouseDown={e => { e.preventDefault(); handleSelect(country) }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-zinc-50 ${
                  country === value ? 'font-medium text-zinc-900 bg-zinc-50' : 'text-zinc-700'
                }`}
              >
                {country}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
