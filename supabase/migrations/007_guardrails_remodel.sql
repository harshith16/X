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
