# TASKS.md — Phased Implementation Roadmap

Work top-down. Never start a phase before the previous phase's boxes are checked. Build prompts come from the CTO one at a time; each working step is committed to GitHub. Check boxes as you complete items and append decisions to DECISIONS.md.

## Phase 0 — Foundation

- [x] Install this context bundle (AGENTS.md at root, /docs, .agent/rules)
- [x] Scaffold Next.js (App Router) + TypeScript strict + Tailwind; ESLint + Prettier configs committed
- [x] Env parsing with Zod against `.env.example`; app refuses to boot on missing/invalid env
- [x] `/api/healthz` and `/api/readyz` endpoints; structured logger with request_id (RELIABILITY.md)
- [x] Vitest wired up with one passing sample unit + integration test

## Phase 1 — Data & identity

- [x] Supabase project connected via pooled (Supavisor) endpoint; migrations folder started
- [x] Migration 001: users, agents, claim_codes (+ all indexes and RLS from DB_SCHEMA.md)
- [ ] Supabase Auth: email magic link AND Google sign-in working end to end
- [ ] Owner sign-up → users row provisioning (auth hook/trigger), owner shell UI (empty contacts screen)

## Phase 2 — Claim & connect (agent becomes real)

- [ ] `POST /api/agents/claim-code` + claim UI (code shown once, 15-min expiry, rate-limited)
- [ ] `POST /agent/register` — atomic claim: code consumed, handle locked, credential issued (AGENT_PROTOCOL.md)
- [ ] `skill/` v1: SKILL.md + script implementing register + heartbeat + credential storage
- [ ] Owner UI shows agent connected + presence from heartbeats

## Phase 3 — Relay: agent-to-agent MVP ★ FIRST MILESTONE

- [ ] Migrations: conversations, participants, messages (+ seq, idempotency unique constraints, indexes)
- [ ] `POST /agent/conversations`, `POST /agent/send`, `GET /agent/inbox` (long-poll + cursors)
- [ ] Store-and-forward: offline recipient queues; ordered delivery on reconnect; at-least-once + dedup proven by tests
- [ ] Rate limiter (Postgres-backed) on all agent routes (SECURITY.md numbers)
- [ ] **Milestone test: founder's agent and a test agent hold a real conversation through the relay, with the founder's agent going offline mid-chat and receiving everything on reconnect**

## Phase 4 — Rules engine & memory

- [ ] Migrations: rules, facts (with pgvector + HNSW), approvals, jobs
- [ ] Rules engine module (pure, deterministic) + full decision-matrix unit tests (RULES_ENGINE.md invariants)
- [ ] MemoryProvider interface + SupabaseMemoryProvider (facts CRUD with supersede semantics)
- [ ] Normalize/dedup/hash utilities + embedding helpers (768-dim, task-steered, L2-normalized) per MEMORY_DESIGN.md
- [ ] Extraction + ADD/UPDATE/DELETE/NONE update-decision flow with integer-index mapping; background jobs wired
- [ ] Recipient pipeline: retrieve permitted → classify → draft → outbound check → send; never-share regression suite green

## Phase 5 — Contacts, invites, guests, starter agents

- [ ] Invites by email with unique links; Pending contacts; activation on friend sign-up + claim; revoke
- [ ] Guest links + guest chat through the same rules pipeline
- [ ] Starter-agent creation flow (owner's own model key) for friends without agents
- [ ] Contacts UI complete (active + pending states)

## Phase 6 — Approvals & owner experience

- [ ] Approvals service + owner prompts (online) with expiry; offline → deflection path live
- [ ] Full transcript views for owners (both sides), cursor-paginated
- [ ] Owner ↔ own agent chat (assistant mode) using getContext memory
- [ ] Facts & rules management UI (per-fact share/ask/never; topic + global defaults)

## Phase 7 — Production hardening

- [ ] Security regression suite (cross-owner access attempts) in CI; dependency + secrets audit
- [ ] k6 load scripts: 10k concurrent polling agents; relay p95 accept < 300 ms verified or bottlenecks fixed
- [ ] Free-tier monitors + upgrade triggers checked (ARCHITECTURE.md); keep-alive for Supabase inactivity
- [ ] Error tracking review; log audit (no content/secrets in logs); backup/restore drill on a staging project
- [ ] Launch checklist run; TASKS.md and DECISIONS.md fully current

## Later phases (designed for, not scheduled)

- [ ] Group chats (multi-agent conversations, group-specific memory boundaries)
- [ ] Agent actions (agents doing things, with owner-set limits and approvals)
- [ ] Alternate MemoryProvider implementations behind the interface
