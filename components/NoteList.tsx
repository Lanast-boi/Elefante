import { Note } from '@/lib/types'

interface Props {
  notes: Note[]
}

type Group = { label: string; notes: Note[] }

function groupNotes(notes: Note[]): Group[] {
  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const weekAgoStr = weekAgo.toISOString().split('T')[0]

  const todayNotes = notes.filter(n => n.date === today)
  const weekNotes = notes.filter(n => n.date < today && n.date >= weekAgoStr)
  const earlierNotes = notes.filter(n => n.date < weekAgoStr)

  const groups: Group[] = []
  if (todayNotes.length) groups.push({ label: 'Today', notes: todayNotes })
  if (weekNotes.length) groups.push({ label: 'This week', notes: weekNotes })
  if (earlierNotes.length) groups.push({ label: 'Earlier', notes: earlierNotes })
  return groups
}

export default function NoteList({ notes }: Props) {
  if (notes.length === 0) {
    return (
      <div className="text-center py-14 rounded-2xl border border-dashed border-zinc-200">
        <p className="text-sm font-medium text-zinc-400">No interactions yet</p>
        <p className="text-xs text-zinc-300 mt-1">Start by logging your first conversation above.</p>
      </div>
    )
  }

  const groups = groupNotes(notes)

  return (
    <div>
      {groups.map(group => (
        <NoteGroup key={group.label} label={group.label} notes={group.notes} />
      ))}
    </div>
  )
}

function NoteGroup({ label, notes }: Group) {
  return (
    <div className="mb-6">
      {/* Group header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest shrink-0">
          {label}
        </span>
        <div className="flex-1 h-px bg-zinc-100" />
      </div>

      {/* Notes */}
      <div>
        {notes.map((note, i) => (
          <div key={note.id} className="flex gap-3">
            {/* Timeline dot + line */}
            <div className="flex flex-col items-center pt-1.5">
              <div className="w-2 h-2 rounded-full bg-zinc-300 shrink-0" />
              {i < notes.length - 1 && (
                <div className="w-px flex-1 bg-zinc-100 mt-1.5" />
              )}
            </div>

            {/* Note content */}
            <div className="flex-1 pb-4 min-w-0">
              <p className="text-xs text-zinc-400 mb-2">{note.date}</p>
              <div className="bg-zinc-50 rounded-xl px-4 py-3">
                <p className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed max-w-prose">
                  {note.text}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
