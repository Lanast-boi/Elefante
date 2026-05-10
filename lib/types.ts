export type Contact = {
  id: string
  name: string
  email: string | null
  phone: string | null
  linkedin_url: string | null
  company: string | null
  role: string | null
  city: string | null
  how_we_met: string | null
  tags: string | null
  familiarity: number | null
  origin_country: string | null
  origin_city: string | null
  personal_context: string | null
  next_follow_up_date: string | null
  follow_up_note: string | null
  last_interaction_date: string | null
  created_at: string
  updated_at: string
}

export type Note = {
  id: string
  contact_id: string
  date: string
  text: string
  created_at: string
}

export type ContactWithNotes = Contact & { notes: Pick<Note, 'text'>[] }
