-- ZINE Mind Forest backend schema.
--
-- growth_events is the source of truth: the forest is reconstructed by
-- summing/replaying it, never by trusting a mutable "current state" column.
-- Every other aggregate (total GP, streaks, leaderboard) is derived from it.

-- ---------- profiles ----------
-- One row per authenticated user. Created automatically by a trigger on
-- auth.users, never inserted directly by clients.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- documents ----------
-- Each PDF/text file a user has opened. file_key is a stable identity for
-- "the same file reopened" (name+size), not a storage path — files stay on
-- the reader's own device, only their reading history is tracked here.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  file_key text not null,
  mode text not null check (mode in ('pdf', 'text')),
  num_pages integer not null check (num_pages > 0),
  created_at timestamptz not null default now(),
  unique (user_id, file_key)
);

create index documents_user_id_idx on public.documents(user_id);

-- ---------- reading_sessions ----------
-- One row per "opened this book" session.
create table public.reading_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  pages_read integer not null default 0,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

create index reading_sessions_user_id_idx on public.reading_sessions(user_id);
create index reading_sessions_document_id_idx on public.reading_sessions(document_id);

-- ---------- growth_events ----------
-- Append-only ledger. growth_type is either a source category
-- ('pages' | 'milestone' | 'focus' | 'streak' | 'daily-open') describing why
-- GP was earned, or a specific forest element kind ('sprout', 'sapling',
-- 'mature-oak', ...) marking the moment that GP crossed into a new unlock.
-- Left unconstrained (not a fixed enum) since the client's unlock catalog
-- grows over time without needing a migration for every new kind.
create table public.growth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  file_name text,
  session_id uuid references public.reading_sessions(id) on delete set null,
  pages_read integer not null default 0,
  time_spent_seconds integer not null default 0,
  growth_type text not null,
  growth_value numeric not null check (growth_value >= 0),
  created_at timestamptz not null default now()
);

create index growth_events_user_id_idx on public.growth_events(user_id);
create index growth_events_user_id_created_at_idx on public.growth_events(user_id, created_at);
create index growth_events_document_id_idx on public.growth_events(document_id);
create index growth_events_session_id_idx on public.growth_events(session_id);

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.growth_events enable row level security;

create policy "profiles are viewable by owner" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles are updatable by owner" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "documents are managed by owner" on public.documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "reading sessions are managed by owner" on public.reading_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "growth events are viewable by owner" on public.growth_events
  for select using (auth.uid() = user_id);
create policy "growth events are insertable by owner" on public.growth_events
  for insert with check (auth.uid() = user_id);
-- deliberately no update/delete policy: growth_events is an append-only ledger.

-- ---------- leaderboard ----------
-- Exposes only aggregate GP + display name (never raw events) to any signed-in
-- user, via a SECURITY DEFINER function rather than relaxing RLS on the base
-- tables. Supports the "leaderboards" feature without a new mutable table to
-- keep in sync.
create or replace function public.get_leaderboard(limit_count integer default 20)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  total_gp numeric,
  total_events bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as user_id,
    p.display_name,
    p.avatar_url,
    coalesce(sum(g.growth_value), 0) as total_gp,
    count(g.id) as total_events
  from public.profiles p
  left join public.growth_events g on g.user_id = p.id
  group by p.id, p.display_name, p.avatar_url
  order by total_gp desc
  limit limit_count;
$$;

grant execute on function public.get_leaderboard(integer) to authenticated;
