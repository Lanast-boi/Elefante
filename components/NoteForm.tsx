'use client'
import { useRef, useState } from 'react'

const QUICK = [
  { label: 'Coffee', prefix: 'Had a coffee — ' },
  { label: 'Call', prefix: 'Call — ' },
  { label: 'Meeting', prefix: 'Meeting — ' },
  { label: 'Event', prefix: 'Event — ' },
]

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

interface Props {
  onAdd: (text: string, date: string) => Promise<void>
}

export default function NoteForm({ onAdd }: Props) {
  const [text, setText] = useState('')
  const [date, setDate] = useState(todayStr)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const handleQuick = (prefix: string) => {
    setText(prefix)
    ref.current?.focus()
    // place cursor at end after state update
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.selectionStart = ref.current.selectionEnd = prefix.length
      }
    })
  }

  const submit = async () => {
    if (!text.trim() || saving) return
    setSaving(true)
    await onAdd(text.trim(), date)
    setText('')
    setDate(todayStr())
    setSaving(false)
    ref.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5 mb-6">
      {/* Quick action chips */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {QUICK.map(q => (
          <button
            key={q.label}
            type="button"
            onClick={() => handleQuick(q.prefix)}
            className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 active:scale-[0.97] transition-all"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What happened? What should you remember? (Enter to save)"
        rows={3}
        autoFocus
        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition resize-none leading-relaxed"
      />

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-300 hidden sm:block">Shift+Enter for new line</span>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !text.trim()}
            className="rounded-xl bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 active:scale-[0.98] transition-all disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Log'}
          </button>
        </div>
      </div>
    </div>
  )
}
