-- Migration 001: Initial Identity Schema (users, agents, claim_codes)
-- Qurelium — Phase 1: Data & Identity

-- Enable case-insensitive text extension
create extension if not exists citext;

-- 1. users table (mirrors auth.users)
create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

-- 2. agents table
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  handle citext not null,
  display_name text,
  status text not null default 'pending_claim' check (status in ('pending_claim', 'active', 'suspended', 'revoked')),
  credential_hash text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists agents_handle_idx on agents (handle);
create index if not exists agents_owner_id_idx on agents (owner_id);
create index if not exists agents_status_last_seen_at_idx on agents (status, last_seen_at);

-- 3. claim_codes table
create table if not exists claim_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  code_hash text not null,
  requested_handle citext,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists claim_codes_owner_id_expires_at_idx on claim_codes (owner_id, expires_at);

-- Row-Level Security (RLS)
alter table users enable row level security;
alter table agents enable row level security;
alter table claim_codes enable row level security;

-- users policies: select, insert, update only own row
drop policy if exists "users_select_own" on users;
create policy "users_select_own" on users
  for select using (id = auth.uid());

drop policy if exists "users_insert_own" on users;
create policy "users_insert_own" on users
  for insert with check (id = auth.uid());

drop policy if exists "users_update_own" on users;
create policy "users_update_own" on users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- agents policy: all operations only own rows
drop policy if exists "agents_all_own" on agents;
create policy "agents_all_own" on agents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- claim_codes policy: select only own rows
drop policy if exists "claim_codes_select_own" on claim_codes;
create policy "claim_codes_select_own" on claim_codes
  for select using (owner_id = auth.uid());
-- Migration 002: Auth provisioning trigger
-- Qurelium — Phase 1: Auth + Owner Shell
--
-- When Supabase Auth creates a new user, automatically provision a row
-- in public.users so the app can FK to it immediately.
-- Uses SECURITY DEFINER with a locked search_path to prevent privilege escalation.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Drop trigger if it already exists (idempotent re-run safety)
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();
-- Migration 003: Add tweet_claimed_at and support pending_post status in agents table
-- Qurelium — Phase 2: Claim flow

-- 1. Add tweet_claimed_at column if not exists
alter table public.agents
  add column if not exists tweet_claimed_at timestamptz;

-- 2. Update status check constraint to include 'pending_post'
alter table public.agents
  drop constraint if exists agents_status_check;

alter table public.agents
  add constraint agents_status_check
  check (status in ('pending_claim', 'pending_post', 'active', 'suspended', 'revoked'));
-- Migration 004: Relay schema — conversations, participants, messages, agent credentials & heartbeats
-- Qurelium — Phase 3: Relay

-- 1. Add last_heartbeat_at to agents
alter table public.agents
  add column if not exists last_heartbeat_at timestamptz;

-- 2. Add agent_id to claim_codes for connect codes
alter table public.claim_codes
  add column if not exists agent_id uuid references public.agents(id) on delete cascade;

-- 3. conversations table (one row per agent pair)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'agent_agent' check (kind in ('agent_agent', 'owner_agent', 'guest')),
  agent_a_id uuid references public.agents(id) on delete cascade,
  agent_b_id uuid references public.agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_pair_unique unique (agent_a_id, agent_b_id)
);

create index if not exists conversations_agent_a_idx on public.conversations(agent_a_id);
create index if not exists conversations_agent_b_idx on public.conversations(agent_b_id);

-- 4. participants table (from DB_SCHEMA.md)
create table if not exists public.participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  guest_invite_id uuid,
  created_at timestamptz not null default now(),
  primary key (conversation_id, agent_id)
);

create index if not exists participants_agent_id_idx on public.participants(agent_id);

-- 5. messages table
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  seq bigint not null,
  sender_agent_id uuid references public.agents(id) on delete set null,
  sender_owner_id uuid references public.users(id) on delete set null,
  body text not null,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'delivered', 'read', 'blocked', 'deflected')),
  created_at timestamptz not null default now(),
  constraint messages_conversation_seq_unique unique (conversation_id, seq),
  constraint messages_sender_idempotency_unique unique (sender_agent_id, idempotency_key)
);

create index if not exists messages_conversation_pagination_idx on public.messages(conversation_id, created_at desc, id desc);
create index if not exists messages_sender_idempotency_idx on public.messages(sender_agent_id, idempotency_key);
create index if not exists messages_conversation_seq_idx on public.messages(conversation_id, seq);

-- 6. Row-Level Security (RLS)
alter table public.conversations enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;

-- conversations policy: owners can view conversations their agent is participating in
drop policy if exists "conversations_owner_select" on public.conversations;
create policy "conversations_owner_select" on public.conversations
  for select using (
    exists (
      select 1 from public.agents a
      where a.owner_id = auth.uid()
      and (a.id = conversations.agent_a_id or a.id = conversations.agent_b_id)
    )
  );

-- participants policy: owners can view participants where their agent is participating
drop policy if exists "participants_owner_select" on public.participants;
create policy "participants_owner_select" on public.participants
  for select using (
    exists (
      select 1 from public.agents a
      where a.owner_id = auth.uid()
      and a.id = participants.agent_id
    )
  );

-- messages policy: owners can view messages in conversations where their agent is a participant
drop policy if exists "messages_owner_select" on public.messages;
create policy "messages_owner_select" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      join public.agents a on (a.id = c.agent_a_id or a.id = c.agent_b_id)
      where c.id = messages.conversation_id
      and a.owner_id = auth.uid()
    )
  );
-- Migration 005: Brain schema — facts, approvals, blocks, pgvector extension
-- Qurelium — Phase 4: Brain

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. facts table (owner_id is the primary namespace, never-share facts are never embedded)
create table if not exists public.facts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  text text not null,
  share_rule text not null default 'ask' check (share_rule in ('share', 'ask', 'never')),
  embedding vector(768),
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  valid_at timestamptz not null default now(),
  invalid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists facts_owner_id_idx on public.facts(owner_id);
create index if not exists facts_owner_share_rule_valid_idx on public.facts(owner_id, share_rule) where invalid_at is null;
create unique index if not exists facts_owner_content_hash_idx on public.facts(owner_id, content_hash) where invalid_at is null;
create index if not exists facts_embedding_hnsw_idx on public.facts using hnsw (embedding vector_cosine_ops);

-- 3. approvals table (pending approvals for ask-first facts)
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  fact_id uuid references public.facts(id) on delete cascade,
  question text not null,
  status text not null default 'pending' check (status in ('pending', 'shared', 'denied', 'never')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists approvals_owner_status_idx on public.approvals(owner_id, status);
create index if not exists approvals_fact_id_idx on public.approvals(fact_id);
create index if not exists approvals_conversation_idx on public.approvals(conversation_id);

-- 4. blocks table (facts marked never to be shared after owner decision)
create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  fact_id uuid not null references public.facts(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocks_owner_fact_unique unique (owner_id, fact_id)
);

create index if not exists blocks_owner_fact_idx on public.blocks(owner_id, fact_id);

-- 5. Row-Level Security (RLS)
alter table public.facts enable row level security;
alter table public.approvals enable row level security;
alter table public.blocks enable row level security;

-- Owner-only SELECT policies (writes are server-mediated via the service client)
drop policy if exists "facts_owner_select" on public.facts;
create policy "facts_owner_select" on public.facts
  for select using (owner_id = auth.uid());

drop policy if exists "approvals_owner_select" on public.approvals;
create policy "approvals_owner_select" on public.approvals
  for select using (owner_id = auth.uid());

drop policy if exists "blocks_owner_select" on public.blocks;
create policy "blocks_owner_select" on public.blocks
  for select using (owner_id = auth.uid());
-- Migration 006: Guardrails schema — guard_categories, conversations.is_request, blocks.fact_id nullable
-- Qurelium — Phase 4: Guardrails (model rework 2026-10-21)

-- 1. guard_categories table (owner-toggled category modes: open, ask, never)
create table if not exists public.guard_categories (
  owner_id uuid not null references public.users(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  category text not null,
  mode text not null check (mode in ('open', 'ask', 'never')),
  updated_at timestamptz not null default now(),
  primary key (owner_id, category)
);

create index if not exists guard_categories_owner_id_idx on public.guard_categories(owner_id);

-- 2. Add is_request flag to conversations table
alter table public.conversations
  add column if not exists is_request boolean not null default false;

create index if not exists conversations_is_request_idx on public.conversations(is_request);

-- 3. Make blocks.fact_id nullable for category-level block audit rows
alter table public.blocks
  alter column fact_id drop not null;

-- 4. Extend approvals status check to support 'blocked' on re-screening
alter table public.approvals
  drop constraint if exists approvals_status_check;

alter table public.approvals
  add constraint approvals_status_check
  check (status in ('pending', 'shared', 'denied', 'never', 'blocked'));

-- 5. Row-Level Security (RLS)
alter table public.guard_categories enable row level security;

-- Owner-only SELECT policy (writes are server-mediated via the service client)
drop policy if exists "guard_categories_owner_select" on public.guard_categories;
create policy "guard_categories_owner_select" on public.guard_categories
  for select using (owner_id = auth.uid());

-- Migration 007: Guardrails specifics remodel
-- Qurelium — Phase 4: Guardrails (model remodel 2026-10-21)
-- Replaces topic categories with specifics keys, resets rows, constrains keys and modes

-- 1. Reset guard_categories table to new key set (pre-launch, test owners only)
delete from public.guard_categories;

-- 2. Constrain category to the 8 specifics keys
alter table public.guard_categories
  drop constraint if exists guard_categories_category_check;

alter table public.guard_categories
  add constraint guard_categories_category_check
  check (category in (
    'secrets',
    'home_address',
    'phone_number',
    'personal_email',
    'live_location',
    'money_figures',
    'health_specifics',
    'family_specifics'
  ));

-- 3. Constrain 'secrets' key to accept only 'ask' or 'never' (mode 'open' rejected)
alter table public.guard_categories
  drop constraint if exists guard_categories_secrets_mode_check;

alter table public.guard_categories
  add constraint guard_categories_secrets_mode_check
  check (not (category = 'secrets' and mode = 'open'));

-- 4. Audit columns in blocks table for category-level blocks
alter table public.blocks
  add column if not exists category text,
  add column if not exists text text;
-- Migration 008: Add x_handle to agents table
-- Qurelium — Phase 2: Real tweet verification via X oEmbed

alter table public.agents
  add column if not exists x_handle citext;
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

