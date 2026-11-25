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

