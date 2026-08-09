-- Trufill — Supabase schema.
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run.

-- One row per user. `data` is the growing set of canonical facts —
-- the "profile that learns", per the architecture we agreed on earlier.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- These three policies are what actually make "your memory is yours" true,
-- not just a design principle: Postgres itself refuses cross-user reads,
-- even if a future bug in application code forgets to filter by user.
create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- Storage bucket for in-progress PDF uploads (between "upload" and "fill").
-- Create this in Dashboard -> Storage -> New bucket -> name it "uploads",
-- set Public = OFF. Then run the two policies below in the SQL editor.
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

create policy "Users can manage their own uploaded files"
  on storage.objects for all
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
