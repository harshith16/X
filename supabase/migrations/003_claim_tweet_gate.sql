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
