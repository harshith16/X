# GEMINI.md — Qurelium

This project is governed by `AGENTS.md` at the repo root — read it in full before writing any code. The complete specifications live in `/docs` (start with `docs/DECISIONS.md`, then the file governing your task, per the table in `README.md`).

The five rules that matter most, even if you read nothing else:

1. Sharing decisions come only from the deterministic rules engine (default-deny). An LLM never decides what may be shared.
2. Never-share data is invisible to agents and LLMs: no retrieval, no embedding, no logs.
3. Every list query is cursor-paginated (max 50) and uses a named index from `docs/DB_SCHEMA.md`.
4. Every external call has a timeout and error handling; every message send has an idempotency key.
5. No new packages, no new services, no stack changes without checking `docs/ARCHITECTURE.md` — and supermemory / mem0 / EmbeddingGemma are inspiration only, never dependencies.
