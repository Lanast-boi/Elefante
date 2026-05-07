import { ContactWithNotes } from './types'

function baseScore(c: ContactWithNotes, q: string): number {
  let s = 0
  if (c.name.toLowerCase().includes(q)) s += 4
  if ((c.company ?? '').toLowerCase().includes(q)) s += 3
  if ((c.role ?? '').toLowerCase().includes(q)) s += 3
  if ((c.tags ?? '').toLowerCase().includes(q)) s += 2
  if ((c.city ?? '').toLowerCase().includes(q)) s += 2
  if ((c.origin_country ?? '').toLowerCase().includes(q)) s += 2
  if ((c.origin_city ?? '').toLowerCase().includes(q)) s += 2
  if ((c.how_we_met ?? '').toLowerCase().includes(q)) s += 1
  if (c.notes.some(n => n.text.toLowerCase().includes(q))) s += 1
  return s
}

// More familiar contacts rank slightly higher; relevance still dominates.
function familiarityWeight(familiarity: number | null): number {
  if (familiarity === 3) return 1.2
  if (familiarity === 2) return 1.0
  if (familiarity === 1) return 0.85
  return 1.0 // null → neutral
}

export function searchContacts(contacts: ContactWithNotes[], query: string): ContactWithNotes[] {
  const q = query.trim().toLowerCase()
  if (!q) return contacts
  return contacts
    .filter(c => baseScore(c, q) > 0)
    .sort((a, b) => {
      const sa = baseScore(a, q) * familiarityWeight(a.familiarity)
      const sb = baseScore(b, q) * familiarityWeight(b.familiarity)
      return sb - sa
    })
}

export function getMatchedNoteSnippet(notes: { text: string }[], query: string): string | null {
  const q = query.toLowerCase()
  const note = notes.find(n => n.text.toLowerCase().includes(q))
  if (!note) return null
  const idx = note.text.toLowerCase().indexOf(q)
  const start = Math.max(0, idx - 30)
  const end = Math.min(note.text.length, idx + q.length + 60)
  return (start > 0 ? '…' : '') + note.text.slice(start, end) + (end < note.text.length ? '…' : '')
}
