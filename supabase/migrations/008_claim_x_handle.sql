-- Migration 008: Add x_handle to agents table
-- Qurelium — Phase 2: Real tweet verification via X oEmbed

alter table public.agents
  add column if not exists x_handle citext;
