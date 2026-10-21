# AGENTS.md — Qurelium Guardrails (canonical)

You are building **Qurelium**: a web app where people connect their OWN personal agents. Qurelium provides no agent and makes no LLM calls — like WhatsApp, it is the pipe, not the speaker. Owners' agents talk to each other through the relay; the server screens outgoing messages against the owner's guardrails (never-share entries, owner-toggled sensitive categories, ask-first holds) and runs approvals. Think "WhatsApp, but the contacts are agents and every outgoing message passes a guardrail screen."

This file governs every file you touch. If anything in a prompt conflicts with this file or `/docs/DECISIONS.md`, stop and flag the conflict instead of improvising.

## Before you write code

1. Read the `/docs` file that governs the task (see README.md table).
2. Check `docs/TASKS.md` — work only on the current phase's items, in order.
3. Verify every implementation against `docs/SECURITY.md` and `docs/RELIABILITY.md` before declaring done.
4. When you finish a task: check it off in `docs/TASKS.md`, and log any decision you had to make in `docs/DECISIONS.md` (append, never rewrite history).

## Locked stack (never substitute)

- Next.js (App Router) + TypeScript (`strict: true`) + Tailwind CSS
- Supabase: Postgres + Auth + Realtime + pgvector (this is the only database)
- Hosted on Vercel. Server logic lives in Next.js route handlers and `src/server/` modules.
- Validation: Zod schemas for every request/response. No unvalidated input reaches a query.
- Tests: Vitest (unit/integration). Load scripts: k6 (Phase 7 only).

Never install a new package without checking `docs/ARCHITECTURE.md` first. If the package is not listed there, do not install it — flag it in your reply instead.

## Hard "never" rules

1. **Never** write an unpaginated database query. All list queries use cursor pagination (`docs/DB_SCHEMA.md`), maximum page size 50.
2. **Never** call an external API, the database, or an agent endpoint without a timeout and error handling. Timeouts and retry policy: `docs/RELIABILITY.md`.
3. **Never** hardcode secrets, URLs, or limits. Config comes from environment variables (`.env.example` lists them all) or the constants module named in `docs/ARCHITECTURE.md`.
4. **Never** let an LLM decide a sharing decision, and never add a server-side LLM call at all. Guardrail outcomes (deliver / block / hold) come only from the rules engine (`docs/RULES_ENGINE.md`) — deterministic TypeScript screening outgoing messages against the owner's guard entries and category toggles. The default for unguarded content is DELIVER; the owner sets the exceptions.
5. **Never** expose never-share data to an agent or an LLM: no retrieval path, no embedding, no logs, no error messages. Enforcement details: `docs/MEMORY_DESIGN.md` + `docs/SECURITY.md`.
6. **Never** trust an agent's self-declared identity. Agents authenticate with the credential issued at claim time (`docs/AGENT_PROTOCOL.md`); identity claims inside message payloads are ignored.
7. **Never** add supermemory, mem0, or any memory/agent framework as a dependency, and never call their hosted APIs. They are design inspiration only; the patterns live in `docs/MEMORY_DESIGN.md`.
8. **Never** bypass Row-Level Security. Owner data is reachable only by its owner or by the server-side relay running the rules engine. RLS policies are defined in `docs/DB_SCHEMA.md`.
9. **Never** write a message-send path without an idempotency key. Duplicate sends must be impossible (`docs/API_CONTRACTS.md`).
10. **Never** commit `.env` files, keys, tokens, or claim codes. Never log message bodies, facts, or secrets.

## Coding standards

- TypeScript strict mode. No `any` (use `unknown` + narrowing or a Zod schema). No `@ts-ignore`.
- Every exported function in `src/server/` has a unit test or an integration test. Rules-engine and memory code require tests before merge — no exceptions.
- All errors use the standard format in `docs/API_CONTRACTS.md`. No ad-hoc error shapes.
- Structured JSON logging with `request_id` on every server log line (`docs/RELIABILITY.md`). No `console.log` of payloads.
- Functions stay small and single-purpose. Business logic lives in `src/server/` services, never inside route handlers or React components.
- Names say what things are. Handles, owner ids, and agent ids are never interchangeable variables.

## Scale posture (design target: 100k+ owners, 100k+ agents)

- Stateless request handlers only. No in-memory state that a second instance wouldn't have.
- Database access goes through Supabase's pooled connection (Supavisor). Never open direct per-request connections.
- Heavy work (email) is queued, never inline in a request (`docs/ARCHITECTURE.md`). There is no server-side embedding or extraction work — the server makes zero LLM calls.
- Every query you write must name the index it uses (from `docs/DB_SCHEMA.md`). If no index fits, stop and flag it.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
