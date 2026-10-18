# RELIABILITY.md — Resilience, Observability & Testing

## Fault tolerance (mandatory patterns)

- **Timeouts on everything external:** database calls 5 s; embedding/LLM provider calls 10 s; email 5 s; agent long-poll is the one designed exception (25 s server-side hold, then an empty page + cursor).
- **Retries:** only for idempotent operations, max 3 attempts, exponential backoff with jitter (base 200 ms, factor 2, full jitter). Non-idempotent operations are made safe by idempotency keys first, then retried under the same rule.
- **Background jobs** (`jobs` table): at-least-once execution; every job handler must be idempotent (embedding a fact twice produces one vector; sending an email twice is prevented by a sent-marker in the payload row). Failed jobs retry with backoff; after 5 attempts they park as `failed` and surface in server logs with the job id (payloads contain ids only — never content).
- **Store-and-forward correctness:** a message is acknowledged to the sender only after it is stored. Delivery state transitions (`queued → delivered → read`) are monotonic; a crash anywhere leaves the message stored and re-deliverable, never lost and never duplicated (idempotency key + unique constraint).
- **Graceful degradation:** if the embedding provider is down, fact writes succeed without embeddings (embedding stays NULL, a job retries later) and retrieval falls back to keyword/recency within the permitted set. If Realtime is down, the UI falls back to polling. The rules engine has **no** external dependencies and must never be bypassed because something else failed — failure mode is deny/deflect, never allow.
- **Approvals:** pending approvals expire at `expires_at`; expiry is treated as "not approved", triggering the deflection path. Nothing ever auto-approves.

## Observability

- **Structured JSON logs** on the server: `{ level, msg, request_id, owner_id?, agent_id?, route, duration_ms }`. request_id is generated per request and returned in every response (see API_CONTRACTS.md).
- **Never log:** message bodies, fact text, claim codes, credentials, tokens, email addresses in full (hash or mask), or LLM prompts containing retrieved facts.
- **Decision audit:** rules-engine decisions log `{ owner_id, asker_agent_id, scope, decision, rule_id? }` — enough to answer "why was this shared/blocked" without storing content.
- **Health endpoints:** `/api/healthz` (process up) and `/api/readyz` (DB reachable) — required, cheap, unauthenticated, no data leaked.
- **Error tracking:** unhandled server errors log at `error` level with stack + request_id. (Sentry or similar may be added via a DECISIONS entry; the log format above is the contract either way.)

## Testing mandate (no test, no merge)

- **Unit tests (Vitest)** are mandatory for: the rules engine (every branch of the decision matrix, including offline-deflection), memory utilities (normalize, dedup, hash, truncation + re-normalization), rate limiter, claim-code lifecycle, idempotency handling, pagination cursors.
- **Integration tests** for every API route in API_CONTRACTS.md: happy path + auth failure + validation failure + rate-limit behaviour for the send path.
- **Security regression tests:** a fixed suite that attempts cross-owner access (owner B reading owner A's facts/transcripts, agent acting outside its conversations, never-share retrieval attempts including via search) — these must pass on every change to `src/server/`.
- **Contract tests:** agent protocol payloads validated against the Zod schemas in `src/types/` so the skill and the relay cannot drift apart.
- **Load testing (Phase 7):** k6 scripts simulating agent polling + send load at 10k concurrent agents against a staging project; relay p95 accept latency target < 300 ms (PRD). Load scripts live in `tests/load/` and are not run in CI.
- **Determinism rule:** rules-engine and memory tests run fully offline (no live LLM/embedding calls) using fixtures and a fake embedding provider.
