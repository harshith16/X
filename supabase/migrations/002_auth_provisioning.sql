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
