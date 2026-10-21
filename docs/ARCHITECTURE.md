# ARCHITECTURE.md — System Design & Locked Stack

## Stack (locked — see AGENTS.md)

| Layer         | Choice                                                | Notes                                                    |
| ------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| Web app       | Next.js (App Router), TypeScript strict, Tailwind CSS | Owner UI + API route handlers in one repo                |
| Database      | Supabase Postgres                                     | The only database. RLS on every table                    |
| Auth          | Supabase Auth                                         | Email magic link + Google OAuth                          |
| Realtime      | Supabase Realtime                                     | Owner UI live updates (transcripts, presence, approvals) |
| Vector search | pgvector (in the same Postgres)                       | Dormant — guard entries are not embedded (founder correction 2026-10-21) (`docs/MEMORY_DESIGN.md`)     |
| Email         | Supabase/Resend free tier                             | Invites and magic links                                  |
| Hosting       | Vercel                                                | Stateless route handlers only                            |
| Validation    | Zod                                                   | Every boundary: API in/out, agent protocol, env          |
| Tests         | Vitest; k6 for load (Phase 7)                         | —                                                        |

No other database, queue server, cache server, or framework may be introduced without a `docs/DECISIONS.md` entry approved by the founder. The "queue" is a Postgres table; "cache" is Postgres + CDN until a DECISIONS entry says otherwise.

## Components

1. **Owner web app** (Next.js UI) — contacts, chats/transcripts, guardrails, approvals, requests, settings.
2. **Qurelium Core** (Next.js route handlers + `src/server/` services):
   - **Identity service** — owners, agents, handles, claim codes.
   - **Relay service** — authenticates agents, accepts/stores/routes messages, store-and-forward queues, presence.
   - **Rules engine** — deterministic guardrail screen on outgoing messages: DELIVER / BLOCK / HOLD (`docs/RULES_ENGINE.md`). Pure functions, no I/O, fully unit-tested.
   - **Guardrails service** — owners' guard entries + category toggles (`docs/MEMORY_DESIGN.md`). There is no memory provider: agents keep their own knowledge; the server stores no agent knowledge and makes zero LLM calls.
   - **Approvals service** — ask-first prompts to owners, approve/deny, expiry.
   - **Invites service** — invite links, pending contacts, activation.
3. **Qurelium skill** (`skill/` folder in this repo) — `SKILL.md` + a small script the owner installs in their agent. It speaks the agent protocol (`docs/AGENT_PROTOCOL.md`) to the relay: register/claim, heartbeat, poll inbox, send messages. It is deliberately dumb: no rules logic, no memory logic — the server enforces everything.

## Data flow (agent-to-agent message)

```
Asker agent → (agent protocol, authenticated) → Relay accepts + stores message (status: queued)
  → recipient agent polls inbox → recipient agent composes its reply with its OWN brain and knowledge
  → agent submits the reply via the send path → guardrail screen (rules engine: owner's guard entries + category modes)
      → DELIVER: relay stores + routes · BLOCK: send rejected `blocked_by_rules`, owner review-log entry · HOLD: approval created carrying the draft
  → asker agent polls inbox → answer delivered → both owners see transcript (Realtime)
```

Ask-first branch: screen returns HOLD → approval → owner UI (Realtime) → share: draft is re-screened, then delivered; not now / never / expiry: draft discarded (never → a guard entry is created). The server composes no message text at any point and makes zero LLM calls.

## Folder structure (strict — do not invent new top-level folders)

```
/
  AGENTS.md  GEMINI.md  README.md  .env.example
  docs/                      ← this documentation set
  skill/                     ← SKILL.md + agent-side script(s)
  src/
    app/                     ← Next.js routes (pages + api route handlers, thin)
    components/              ← UI components (no business logic)
    lib/                     ← shared utilities, constants, env parsing
    server/
      identity/  relay/  rules/  memory/  approvals/  invites/
      db/                    ← Supabase clients, query helpers (the ONLY db access layer)
    types/                   ← shared TypeScript types + Zod schemas
  supabase/
    migrations/              ← all schema changes, numbered, never edited after merge
    seed.sql
  tests/
    unit/  integration/
```

Route handlers call services in `src/server/`; services call `src/server/db/`; nothing else touches the database. UI components never import from `src/server/`.

## Scale & concurrency design

- **Stateless handlers:** any Vercel instance can serve any request. No in-memory sessions, caches, or counters that matter.
- **Connections:** all DB access via Supabase's pooled endpoint (Supavisor, transaction mode). The service-role client is server-only.
- **Agent connections:** agents do not hold permanent sockets to our servers. They poll their inbox with a cursor (long-poll up to 25 s) and send heartbeats — this survives serverless limits and agent restarts (`docs/AGENT_PROTOCOL.md`).
- **Queues:** outbound messages and background jobs (embedding, extraction, email) are Postgres tables with `status` + `attempts` + `next_attempt_at`, processed by short-lived workers invoked from route handlers/cron. At-least-once processing + idempotent handlers.
- **Pagination everywhere:** cursor-based on `(created_at, id)`; see `docs/DB_SCHEMA.md`.
- **Rate limiting:** `RateLimiter` interface in `src/server/relay/`; v1 implementation is Postgres-backed counters; the interface allows a Redis-compatible swap later without touching call sites (`docs/SECURITY.md`).

## Free-tier reality and upgrade triggers ($0-first)

- Supabase free: fine for launch and early growth; projects pause after ~1 week of total inactivity (keep-alive ping in the worker schedule prevents surprise pauses during active development).
- Upgrade triggers (founder approval required): sustained DB > 400 MB, egress near the free cap, or relay p95 accept latency > 300 ms at load test → Supabase Pro; Vercel function limits hit → Vercel Pro. Record the trigger event in `docs/DECISIONS.md`.
