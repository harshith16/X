# DB_SCHEMA.md — Database Schema & Query Rules

Postgres (Supabase) is the only database. All schema changes are numbered migrations in `supabase/migrations/`. Never edit a merged migration — write a new one.

## Conventions

- Primary keys: `uuid` default `gen_random_uuid()`. Every table has `created_at timestamptz not null default now()`.
- All timestamps are stored in UTC. The UI converts to the owner's timezone.
- Lists are always ordered by `(created_at, id)` and paginated by cursor (see Query rules).
- Enums are Postgres enums or `text` + `check` constraints — pick one style per table and stay consistent within it.

## Tables

### users (owners) — mirrors Supabase Auth

| Column       | Type          | Notes             |
| ------------ | ------------- | ----------------- |
| id           | uuid PK       | = `auth.users.id` |
| email        | text not null | unique            |
| display_name | text          |                   |
| created_at   | timestamptz   |                   |

### agents

| Column          | Type                                                           | Notes                                                                            |
| --------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| id              | uuid PK                                                        |                                                                                  |
| owner_id        | uuid FK → users                                                | one agent per owner in v1                                                        |
| handle          | citext not null                                                | **UNIQUE**. Stored lowercase. Locks only when status becomes `active`            |
| display_name    | text                                                           |                                                                                  |
| status          | text check in (`pending_claim`,`active`,`suspended`,`revoked`) |                                                                                  |
| credential_hash | text                                                           | hash of the agent credential issued at claim; the raw credential is never stored |
| last_seen_at    | timestamptz                                                    | heartbeat                                                                        |
| created_at      | timestamptz                                                    |                                                                                  |

### claim_codes

| Column           | Type                 | Notes                                              |
| ---------------- | -------------------- | -------------------------------------------------- |
| id               | uuid PK              |                                                    |
| owner_id         | uuid FK → users      |                                                    |
| code_hash        | text not null        | HMAC of the code; raw code shown once to the owner |
| requested_handle | citext               | the handle the owner intends to claim              |
| expires_at       | timestamptz not null | 15 minutes from creation                           |
| used_at          | timestamptz          | set exactly once, at successful claim              |

### contacts

| Column           | Type                                         | Notes                              |
| ---------------- | -------------------------------------------- | ---------------------------------- |
| id               | uuid PK                                      |                                    |
| owner_id         | uuid FK → users                              | whose contact list                 |
| contact_owner_id | uuid FK → users                              | the other owner                    |
| status           | text check in (`pending`,`active`,`blocked`) | pending until the invite completes |
| invite_id        | uuid FK → invites                            | nullable                           |
| created_at       | timestamptz                                  | unique(owner_id, contact_owner_id) |

### invites

| Column           | Type                                                     | Notes                      |
| ---------------- | -------------------------------------------------------- | -------------------------- |
| id               | uuid PK                                                  |                            |
| inviter_owner_id | uuid FK → users                                          |                            |
| email            | text not null                                            | invited address            |
| token_hash       | text not null unique                                     | raw token only in the link |
| status           | text check in (`pending`,`accepted`,`revoked`,`expired`) |                            |
| expires_at       | timestamptz                                              |                            |
| created_at       | timestamptz                                              |                            |

### conversations

| Column     | Type                                                | Notes                         |
| ---------- | --------------------------------------------------- | ----------------------------- |
| id         | uuid PK                                             |                               |
| kind       | text check in (`agent_agent`,`owner_agent`,`guest`) | group chats are a later phase |
| created_at | timestamptz                                         |                               |

### participants

| Column          | Type                    | Notes                                                     |
| --------------- | ----------------------- | --------------------------------------------------------- |
| conversation_id | uuid FK → conversations |                                                           |
| agent_id        | uuid FK → agents        | nullable for guest participants                           |
| guest_invite_id | uuid FK → invites       | nullable, for guest chats                                 |
|                 |                         | PK (conversation_id, agent_id) where agent_id is not null |

### messages

| Column          | Type                                                              | Notes                                                                  |
| --------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| id              | uuid PK                                                           |                                                                        |
| conversation_id | uuid FK → conversations                                           |                                                                        |
| seq             | bigint not null                                                   | per-conversation sequence, assigned by the relay inside a transaction  |
| sender_agent_id | uuid FK → agents                                                  | nullable for owner/guest-sent                                          |
| sender_owner_id | uuid FK → users                                                   | nullable                                                               |
| body            | text not null                                                     | max length enforced at the API (see SECURITY.md)                       |
| idempotency_key | text not null                                                     | client-generated UUID; **unique per sender**                           |
| status          | text check in (`queued`,`delivered`,`read`,`blocked`,`deflected`) |                                                                        |
| created_at      | timestamptz                                                       | unique(conversation_id, seq); unique(sender_agent_id, idempotency_key) |

### rules

| Column                  | Type                                    | Notes                                                         |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------- |
| id                      | uuid PK                                 |                                                               |
| owner_id                | uuid FK → users                         |                                                               |
| scope                   | text check in (`fact`,`topic`,`global`) | v1 primarily per-fact (via facts.share_rule) + global default |
| topic                   | text                                    | nullable; used when scope = `topic`                           |
| fact_id                 | uuid FK → facts                         | nullable; used when scope = `fact`                            |
| decision                | text check in (`share`,`ask`,`never`)   |                                                               |
| created_at / updated_at | timestamptz                             | unique(owner_id, scope, topic, fact_id)                       |

### facts (guard entries — full design in `docs/MEMORY_DESIGN.md`)

| Column                  | Type                                                         | Notes                                                                                      |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| id                      | uuid PK                                                      |                                                                                            |
| owner_id                | uuid FK → users                                              | the only namespace: every query filters by owner_id in code AND RLS                        |
| text                    | text not null                                                | the fact, one statement                                                                    |
| share_rule              | text check in (`share`,`ask`,`never`) not null — guard semantics 2026-10-21: `never` = locked box, `ask` = hold for approval, `share` = legacy/ignored by the screen |                                                                                            |
| embedding               | vector(768)                                                  | **Unused by the product path since 2026-10-21** — guard entries are never embedded; column dormant                  |
| content_hash            | text not null                                                | normalized-text hash for dedup; unique(owner_id, content_hash) among currently-valid facts |
| metadata                | jsonb not null default '{}'                                  | source, topic tags; never contains identity keys                                           |
| valid_at                | timestamptz not null default now()                           | when this fact became true                                                                 |
| invalid_at              | timestamptz                                                  | when superseded; NULL = currently valid                                                    |
| created_at / updated_at | timestamptz                                                  |                                                                                            |

### approvals

| Column                  | Type                                                                        | Notes                                              |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| id                      | uuid PK                                                                     |                                                    |
| owner_id                | uuid FK → users                                                             | who must decide                                    |
| conversation_id         | uuid FK → conversations                                                     |                                                    |
| requesting_agent_id     | uuid FK → agents                                                            | the asker                                          |
| summary                 | text not null                                                               | what is being asked, WITHOUT the protected content |
| status                  | text check in (`pending`,`approved`,`denied`,`expired`,`deflected_offline`) |                                                    |
| expires_at              | timestamptz not null                                                        | pending approvals expire; expiry = not approved    |
| created_at / decided_at | timestamptz                                                                 |                                                    |

### jobs (background work)

| Column          | Type                                                      | Notes                                        |
| --------------- | --------------------------------------------------------- | -------------------------------------------- |
| id              | uuid PK                                                   |                                              |
| kind            | text check in (`embed_fact`,`extract_facts`,`send_email`) |                                              |
| payload         | jsonb not null                                            | ids only — never fact text or message bodies |
| status          | text check in (`queued`,`running`,`done`,`failed`)        |                                              |
| attempts        | int not null default 0                                    |                                              |
| next_attempt_at | timestamptz not null default now()                        |                                              |
| created_at      | timestamptz                                               |                                              |

### rate_limits (v1 limiter backing store)

| Column       | Type                   | Notes                                  |
| ------------ | ---------------------- | -------------------------------------- |
| key          | text PK                | e.g. `agent:<id>:send`, `ip:<ip>:auth` |
| window_start | timestamptz not null   |                                        |
| count        | int not null default 0 |                                        |

## Indexing strategy (every query must name its index)

- `agents (handle)` — unique index (the handle lock).
- `agents (owner_id)`, `agents (status, last_seen_at)` — presence sweeps.
- `messages (conversation_id, created_at DESC, id DESC)` — transcript + inbox cursor pagination.
- `messages (sender_agent_id, idempotency_key)` — unique; send dedup.
- `contacts (owner_id, status)`, `contacts (contact_owner_id)`.
- `facts (owner_id, share_rule) where invalid_at is null` — retrieval pre-filter.
- `facts (owner_id, content_hash)` — unique partial index where `invalid_at is null`.
- `facts embedding` — HNSW index (`vector_cosine_ops`) for semantic search, always combined with the owner + share_rule pre-filter.
- `approvals (owner_id, status, expires_at)` — pending-approval lists and expiry sweeps.
- `jobs (status, next_attempt_at)` — worker pickup.
- `claim_codes (owner_id, expires_at)`, `invites (token_hash)` unique.

## Query rules

1. **Cursor pagination only.** `WHERE (created_at, id) < (:cursor_created_at, :cursor_id) ORDER BY created_at DESC, id DESC LIMIT :n` with `n ≤ 50`. OFFSET is banned.
2. **No N+1.** Batch-fetch related rows (joins or `IN` queries). One request = a bounded, constant number of queries.
3. **Select only needed columns.** `select *` is banned outside tests.
4. **Every facts query carries `owner_id = :owner` AND `share_rule <> 'never'`** in the WHERE clause, enforced in `src/server/db/` helper functions — raw facts queries elsewhere are banned. (The owner browsing their own facts in the UI is the one exception, and it uses a separate, explicitly-named owner-only helper.)
5. **Writes that must not duplicate** rely on unique constraints + `ON CONFLICT DO NOTHING`/upsert semantics, never on check-then-insert races.

## Row-Level Security (RLS)

- RLS is **enabled on every table**, no exceptions.
- Owner-facing policies: a user may read/write only rows where `owner_id = auth.uid()` (or the table's equivalent ownership column). Transcripts: an owner may read messages of conversations where they own a participating agent.
- The relay/rules/memory services run server-side with the service role, and **must** re-implement the same ownership filters in code — service role bypasses RLS, so code filters are the real boundary and are unit-tested.
- Agents never connect to the database. Ever. They only speak the agent protocol to the relay.
