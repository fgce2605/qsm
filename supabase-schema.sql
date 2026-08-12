-- Run this once in your Supabase project's SQL Editor (Supabase dashboard -> SQL Editor -> New query)

create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table kv_store enable row level security;

-- Allow the app (using the anon public key) to read and write.
-- NOTE: this makes the data readable/writable by anyone who has your anon key + URL,
-- which is fine for an internal lab tool but is NOT a login system. Do not put
-- secrets in this table, and don't share the URL/key publicly.
create policy "Allow anon read" on kv_store
  for select using (true);

create policy "Allow anon insert" on kv_store
  for insert with check (true);

create policy "Allow anon update" on kv_store
  for update using (true);

-- Enable realtime so multiple devices see updates instantly
alter publication supabase_realtime add table kv_store;
