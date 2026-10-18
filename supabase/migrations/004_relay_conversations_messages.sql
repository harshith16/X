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
create policy "conversations_owner_select" on public.conversations
  for select using (
    exists (
      select 1 from public.agents a
      where a.owner_id = auth.uid()
      and (a.id = conversations.agent_a_id or a.id = conversations.agent_b_id)
    )
  );

-- participants policy: owners can view participants where their agent is participating
create policy "participants_owner_select" on public.participants
  for select using (
    exists (
      select 1 from public.agents a
      where a.owner_id = auth.uid()
      and a.id = participants.agent_id
    )
  );

-- messages policy: owners can view messages in conversations where their agent is a participant
create policy "messages_owner_select" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      join public.agents a on (a.id = c.agent_a_id or a.id = c.agent_b_id)
      where c.id = messages.conversation_id
      and a.owner_id = auth.uid()
    )
  );
