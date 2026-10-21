# MEMORY_DESIGN.md — Guard Entries & Owner Controls

**Corrected 2026-10-21 by the founder. This document replaces the old server-memory design in full.**

## The one rule this document exists to state

**Qurelium stores no agent knowledge.** An agent's memory and knowledge live inside the agent itself — the owner's own software, running on the owner's own setup with the owner's own model key. Qurelium is the pipe, not the brain: like WhatsApp, it delivers messages and enforces the owner's guardrails; it never composes answers and **the server makes zero LLM calls**.

So there is no server-side retrieval-for-answering, no extraction pipeline, no starter-agent context, and no memory provider interface. Any older text describing those is void.

## What the server DOES store, per owner

Only the owner's guardrails and the records of what happened:

| Store | Contents |
|---|---|
| **Guard entries** (`facts` table, repurposed) | Exact items the owner marked **never share** (the locked box) or **ask me first**. Short owner-typed entries — these are exceptions, not the agent's knowledge. |
| **Category modes** (`guard_categories`) | Owner toggles for the sensitive-category catalogue (see RULES_ENGINE.md): each category is `open`, `ask`, or `never`. |
| **Blocks** (`blocks`) | Audit of stopped sends + topics the owner marked never from an approval. |
| **Approvals** (`approvals`) | Held draft messages awaiting the owner's decision. |
| **Transcripts** (`conversations` / `messages`) | Every conversation the owner's agent takes part in — owners see all of them. |

## Guard entries

- Entered by the owner in the Guardrails UI (add/delete), or created when the owner resolves an approval with "Never".
- `content_hash` (normalised text: strip date/recency prefixes, lowercase, collapse whitespace — utility pattern adapted from supermemory's normalisation, reimplemented in `src/server/memory/normalize.ts`) dedups entries and feeds the send-path screen's matching.
- **Never-share entries are the locked box:** their text never appears in agent-facing API responses or error messages, never in logs, and never in another owner's data. They exist for exactly one purpose — matching against outgoing message text in the screen (RULES_ENGINE.md).
- The `embedding` column from migration 005 is **unused by the product path**: do not compute embeddings for guard entries, do not build retrieval on this table. pgvector stays installed and dormant.
- Entries carry `valid_at` / `invalid_at` (soft delete via `invalid_at`); screening only considers currently-valid entries.

## What the inspiration repos actually contributed (final)

supermemory / mem0 / EmbeddingGemma are inspiration only (DECISIONS.md #21) — no dependencies, no hosted APIs, no self-hosted models. What survives from that research is small and specific: text normalisation and content-hash dedup utilities, and the discipline that sharing enforcement is deterministic code, never a model. The retrieval/embeddings/extraction design from that research was **removed on 2026-10-21** when the founder confirmed Qurelium holds no agent knowledge (DECISIONS.md #27–#34).
