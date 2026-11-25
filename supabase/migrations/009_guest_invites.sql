-- Migration 009: Guest invites, guest conversations, and analytics events
-- Qurelium — Phase 5: Guest links (invite-only, signed-up guests)

-- 1. guest_invites table
create table if not exists public.guest_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  owner_id uuid not null references public.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  accepted_user_id uuid references public.users(id) on delete set null
);

create index if not exists guest_invites_owner_id_idx on public.guest_invites(owner_id);
create index if not exists guest_invites_agent_id_idx on public.guest_invites(agent_id);
create index if not exists guest_invites_token_hash_idx on public.guest_invites(token_hash);
create index if not exists guest_invites_accepted_user_id_idx on public.guest_invites(accepted_user_id);

-- 2. Add guest columns to conversations table
alter table public.conversations
  add column if not exists is_guest boolean not null default false;

alter table public.conversations
  add column if not exists guest_user_id uuid references public.users(id) on delete set null;

alter table public.conversations
  add column if not exists guest_invite_id uuid references public.guest_invites(id) on delete set null;

create index if not exists conversations_guest_user_id_idx on public.conversations(guest_user_id);
create index if not exists conversations_is_guest_idx on public.conversations(is_guest);

-- 3. analytics_events table (metadata-only)
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_event_created_idx on public.analytics_events(event, created_at desc);

-- 4. Row-Level Security (RLS)
alter table public.guest_invites enable row level security;
alter table public.analytics_events enable row level security;

-- guest_invites: owner-only SELECT policy (writes are server-mediated via service client)
drop policy if exists "guest_invites_owner_select" on public.guest_invites;
create policy "guest_invites_owner_select" on public.guest_invites
  for select using (owner_id = auth.uid());

-- analytics_events: server-mediated only

