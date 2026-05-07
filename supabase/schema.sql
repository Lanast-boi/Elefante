create table contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  company text,
  role text,
  city text,
  how_we_met text,
  tags text,
  next_follow_up_date date,
  last_interaction_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  date date default current_date,
  text text not null,
  created_at timestamptz default now()
);

alter table contacts enable row level security;
alter table notes enable row level security;

create policy "auth_only" on contacts for all using (auth.role() = 'authenticated');
create policy "auth_only" on notes for all using (auth.role() = 'authenticated');
