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
