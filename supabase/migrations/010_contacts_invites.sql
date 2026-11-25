-- Migration 010: Contacts, contact invites, and reciprocal relationships
-- Qurelium — Address book & Contacts view

-- 1. contacts table
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  contact_owner_id uuid not null references public.users(id) on delete cascade,
  state text not null check (state in ('pending', 'accepted')),
  source text not null check (source in ('handle', 'link')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint contacts_owner_pair_unique unique (owner_id, contact_owner_id)
);

create index if not exists contacts_owner_id_idx on public.contacts(owner_id);
create index if not exists contacts_contact_owner_id_idx on public.contacts(contact_owner_id);
create index if not exists contacts_owner_state_idx on public.contacts(owner_id, state);
create index if not exists contacts_contact_owner_state_idx on public.contacts(contact_owner_id, state);

-- 2. contact_invites table
create table if not exists public.contact_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  owner_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references public.users(id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists contact_invites_owner_id_idx on public.contact_invites(owner_id);
create index if not exists contact_invites_token_hash_idx on public.contact_invites(token_hash);
create index if not exists contact_invites_used_by_idx on public.contact_invites(used_by);

-- 3. Row-Level Security
alter table public.contacts enable row level security;
alter table public.contact_invites enable row level security;

-- Owner-only SELECT on their own rows (requester or recipient)
drop policy if exists "contacts_select_owner" on public.contacts;
create policy "contacts_select_owner" on public.contacts
  for select
  using (owner_id = auth.uid() or contact_owner_id = auth.uid());

drop policy if exists "contact_invites_select_owner" on public.contact_invites;
create policy "contact_invites_select_owner" on public.contact_invites
  for select
  using (owner_id = auth.uid());

-- Writes are server-mediated only (via service role client)

