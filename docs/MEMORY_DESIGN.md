# MEMORY_DESIGN.md — Memory, Facts & Embeddings

Qurelium's memory is a replaceable adapter behind one interface. v1 is our own code on Supabase — no external memory service, no third-party memory framework, no self-hosted models. The design borrows specific, proven patterns from supermemory, mem0, and EmbeddingGemma (inspiration only; see DECISIONS.md #21 and the research report in the founder's files). This document is the only place those patterns enter the codebase.

## The interface

```ts
interface MemoryProvider {
  addFact(ownerId, text, shareRule, metadata?): Promise<Fact>;
  updateFact(ownerId, factId, changes): Promise<Fact>; // supersedes, never mutates history
  forgetFact(ownerId, factId): Promise<void>;
  search(ownerId, query, opts): Promise<ScoredFact[]>; // permitted facts only — see below
  getContext(ownerId, query): Promise<string>; // starter-agent prompt context block
}
```

v1 implementation: `SupabaseMemoryProvider` in `src/server/memory/`. A future provider (e.g. a hosted memory API) may be added behind this interface by a DECISIONS entry — call sites never know which provider is active.

## Storage (schema in DB_SCHEMA.md)

- One `facts` table. **The namespace is `owner_id`** — every read and write is scoped to exactly one owner, in SQL and in code (pattern adapted from supermemory's per-user containers and mem0's mandatory `user_id` scoping).
- `share_rule` lives on the fact. Retrieval helpers hard-filter `share_rule <> 'never'`; there is no code path that returns never-share facts to the agent pipeline.
- **Never-share facts are never embedded** (`embedding` stays NULL) and never leave the owner's own UI.
- Freshness: `valid_at` / `invalid_at` give every fact a validity window (bi-temporal pattern, adapted from Graphiti). Updates supersede: the old row gets `invalid_at = now()`, a new row is inserted. Retrieval only returns currently-valid facts; history is preserved for the owner's audit view.

## Writing facts: extraction and update decisions (pattern adapted from mem0)

- Facts enter three ways: owner types them in the UI; the starter agent extracts them from owner conversations; an agent proposes them and the owner confirms.
- Extraction (LLM step, our own prompts in `src/server/memory/prompts.ts`): extract **atomic, single-statement facts**; return structured JSON validated by Zod. Extraction runs as a background job, never inline.
- Update decision (deterministic flow around one LLM classification): for each extracted fact, search existing valid facts for near-duplicates/contradictions, then classify the pair as **ADD / UPDATE / DELETE / NONE** (mem0's decision set):
  - ADD → insert new fact.
  - UPDATE → supersede the old fact (validity window) and insert the new one. This is how "the travel limit changed" replaces the old limit instead of coexisting with it.
  - DELETE → set `invalid_at` on the old fact.
  - NONE → no-op.
- **Anti-hallucination guard (from mem0):** the classifier never sees or emits raw UUIDs. Candidate facts are presented with small integer indices (0, 1, 2…) and the response references indices; the server maps indices back to real ids. An out-of-range index fails the whole batch safely.
- **Normalize + dedup before any of this** (utility pattern from supermemory's `tools-shared.ts`, reimplemented in `src/server/memory/normalize.ts`): strip date/recency prefixes, lowercase, collapse whitespace → `content_hash`. Exact-hash matches among valid facts short-circuit the LLM entirely. LLM-supplied limits are always clamped server-side (search result caps 1–50).

## Embeddings (conventions adapted from EmbeddingGemma 2)

We write our own embedding helpers in `src/server/memory/embedding.ts` behind an `EmbeddingProvider` interface (default: the Gemini embeddings API on its free tier, called with the server key; the interface allows swapping providers without touching call sites). Adopted conventions:

- **768 dimensions** stored as `vector(768)` in pgvector.
- **Task steering:** documents are embedded with document semantics (RETRIEVAL_DOCUMENT) and queries with query semantics (RETRIEVAL_QUERY); when a provider uses text prefixes instead, use the EmbeddingGemma-style forms (`title: {title} | text:` for documents, `task: search result | query:` for queries). One helper per direction — call sites never hand-roll this.
- **L2-normalize every vector.** If a vector is ever truncated (MRL-style, e.g. 768 → 256 to save space later), it **must be re-normalized afterwards** — skipping this silently degrades search quality.
- Retrieval = cosine similarity over the pre-filtered permitted set only (filter first, rank second — never rank then filter).
- **Low-score threshold:** if the best match scores below the configured threshold, retrieval returns "no good match" and the agent says it doesn't know — it never answers from a weak match.
- Our own `cosineSimilarity`, `normalizeVector`, and `truncateVector` utilities live in `src/server/memory/vectors.ts` with unit tests (pattern reference: supermemory's similarity utility — reimplemented, not copied as a dependency).

## Retrieval flow (share box)

```
question → embedQuery() → facts search (owner_id = owner, share_rule <> 'never',
  invalid_at IS NULL, cosine rank, threshold) → rules engine classifies each fact
  → permitted set → agent drafts → outbound check → send
```

`getContext` (starter agent's own memory) follows the fetch → dedup → render-to-text pattern: retrieve the permitted facts, dedup against each other with `normalize`, format as a compact text block, inject into the agent's prompt. Timeouts/retries per RELIABILITY.md; on provider failure, context is empty rather than wrong.

## What we deliberately did NOT take

- supermemory's hosted API (metered, external dependency) — v2 candidate behind the interface only.
- mem0 as a package (its factories/telemetry and our stack don't mix) — patterns only, reimplemented in TypeScript.
- Self-hosting EmbeddingGemma (any version) — serverless-incompatible and against the no-hosting rule; conventions only.
- Any design where an LLM decides what is shareable — the rules engine owns that (RULES_ENGINE.md).
