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
create policy "facts_owner_select" on public.facts
  for select using (owner_id = auth.uid());

create policy "approvals_owner_select" on public.approvals
  for select using (owner_id = auth.uid());

create policy "blocks_owner_select" on public.blocks
  for select using (owner_id = auth.uid());
