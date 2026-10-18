# Qurelium — Agent Context Bundle

This bundle is the shared brain for Qurelium development. It is used by:

- **Harshith** (founder) — owns product decisions.
- **Muse** (CTO) — issues step-by-step build prompts that reference these files by name.
- **The IDE coding agent** (Antigravity / Gemini) — writes the code, bound by these files.

## How to install into the repo

1. Copy this entire bundle into the root of the `qurelium` repository.
2. `AGENTS.md` stays at the repo root. `GEMINI.md` stays at the repo root. `.agent/rules/guardrails.md` stays where it is — Antigravity loads it automatically.
3. Everything else lives in `/docs`. Do not rename files; prompts refer to them by exact path.

## Reading order (for the coding agent)

Before writing ANY code: read `AGENTS.md`, then the `/docs` file that governs your task:

| Task touches…                  | Read first                                                      |
| ------------------------------ | --------------------------------------------------------------- |
| Anything                       | `docs/DECISIONS.md` (locked product decisions — never override) |
| Features, flows, scope         | `docs/PRD.md`                                                   |
| Structure, stack, folders      | `docs/ARCHITECTURE.md`                                          |
| Tables, queries, indexes       | `docs/DB_SCHEMA.md`                                             |
| Endpoints, payloads, errors    | `docs/API_CONTRACTS.md`                                         |
| Auth, limits, abuse            | `docs/SECURITY.md`                                              |
| Retries, logging, tests        | `docs/RELIABILITY.md`                                           |
| Sharing rules behaviour        | `docs/RULES_ENGINE.md`                                          |
| Memory, facts, embeddings      | `docs/MEMORY_DESIGN.md`                                         |
| Agent connection, skill, relay | `docs/AGENT_PROTOCOL.md`                                        |
| What to build next             | `docs/TASKS.md` (work top-down, check items off)                |

## Ground rules that never change

- Production-grade from day one: this system is designed for hundreds of thousands of agents. No throwaway code, no "fix it later" shortcuts. See `AGENTS.md` for the hard rules.
- The three reference projects (supermemory, mem0, EmbeddingGemma) are **inspiration only**. Their logic patterns are documented in `docs/MEMORY_DESIGN.md`. Never add them as dependencies, never call their hosted services, never self-host their models.
- Qurelium is one product in one lane. The Meta Hackathon and PayPal Hackathon projects are separate and are never referenced in this repo, its code, or its copy.
- Budget is $0-first: free tiers only (Vercel, Supabase, Gemini free tier). Any change that introduces a paid service requires the founder's explicit approval first.
