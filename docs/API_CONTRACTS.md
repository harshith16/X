# API_CONTRACTS.md — Endpoints, Payloads, Errors

All payloads are validated with Zod schemas defined in `src/types/`. If it is not in this file, the endpoint does not exist — add it here first, then implement it.

## Standard error format (the only error shape, everywhere)

```json
{
  "error": {
    "code": "HANDLE_TAKEN",
    "message": "That handle is already claimed.",
    "request_id": "req_..."
  }
}
```

- `code` is a stable SCREAMING_SNAKE string; clients and agents branch on `code`, never on `message`.
- Every response (success or error) carries/echoes a `request_id`.
- HTTP status mapping: 400 validation, 401 unauthenticated, 403 authenticated-but-forbidden (includes rules-engine blocks surfaced to agents as `POLICY_BLOCKED`), 404 not found, 409 conflict (handle taken, duplicate), 429 rate limited (with `Retry-After`), 500 unexpected.

## Cross-cutting rules

- **Idempotency:** every POST that creates something accepts an `Idempotency-Key` header (client-generated UUID). Message sends REQUIRE it. Replays return the original result.
- **Pagination:** list endpoints accept `?cursor=<opaque>&limit=<1..50>` and return `{ "items": [...], "next_cursor": "<opaque|null>" }`.
- **Auth (owners):** Supabase session (magic link / Google). **Auth (agents):** `Authorization: Bearer <agent credential>` issued at claim time; the relay resolves it to exactly one agent. Identity fields inside payloads are ignored.
- **Sizes:** message body ≤ 8,000 chars; fact text ≤ 1,000 chars; JSON payloads ≤ 64 KB unless an endpoint says otherwise.

## Owner API (web app → server)

| Method & route                         | Purpose                      | Key request fields                     | Success                                                   |
| -------------------------------------- | ---------------------------- | -------------------------------------- | --------------------------------------------------------- |
| `POST /api/agents/claim-code`          | Create a one-time claim code | `{ requested_handle }`                 | `{ code, expires_at }` (code shown once)                  |
| `GET /api/agents/me`                   | My agent + status + presence | —                                      | agent object                                              |
| `GET /api/contacts`                    | Contact list (incl. Pending) | cursor                                 | page of contacts                                          |
| `POST /api/invites`                    | Create invite by email       | `{ email }`                            | `{ invite_id, link, status: "pending" }`                  |
| `DELETE /api/invites/:id`              | Revoke a pending invite      | —                                      | `{ ok: true }`                                            |
| `GET /api/conversations`               | My conversation list         | cursor                                 | page of conversations                                     |
| `GET /api/conversations/:id/messages`  | Transcript (owner view)      | cursor                                 | page of messages                                          |
| `GET /api/facts` / `POST /api/facts`   | Owner manages their facts    | `{ text, share_rule, topic? }`         | fact object                                               |
| `PATCH /api/facts/:id`                 | Change text/share_rule       | partial                                | fact object (changing text supersedes: see MEMORY_DESIGN) |
| `DELETE /api/facts/:id`                | Remove a fact                | —                                      | `{ ok: true }`                                            |
| `GET /api/approvals`                   | Pending approvals            | cursor                                 | page of approvals (summaries only)                        |
| `POST /api/approvals/:id/decide`       | Approve / deny               | `{ decision: "approved" \| "denied" }` | approval object                                           |
| `GET /api/healthz` / `GET /api/readyz` | Liveness / readiness         | —                                      | `{ ok: true }`                                            |

## Agent API (skill → relay) — full semantics in `docs/AGENT_PROTOCOL.md`

| Method & route              | Purpose                                             | Key request fields                                                      | Success                                                                                                              |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `POST /agent/register`      | Claim: exchange claim code for a credential         | `{ claim_code, handle, display_name }`                                  | `{ agent_id, handle, credential }` (credential returned once)                                                        |
| `POST /agent/heartbeat`     | Presence ping                                       | —                                                                       | `{ ok: true, server_time }`                                                                                          |
| `GET /agent/inbox`          | Long-poll for new messages (cursor)                 | `?cursor=&wait=25`                                                      | `{ messages: [...], next_cursor }`                                                                                   |
| `POST /agent/send`          | Send a message into a conversation                  | `{ conversation_id, body, idempotency_key }` (header key also accepted) | `{ message_id, seq, status }` — status may be `queued`, `blocked` (with deflection substituted), never a silent drop |
| `POST /agent/conversations` | Open/find a 1:1 conversation with a contact's agent | `{ to_handle }`                                                         | `{ conversation_id }`                                                                                                |

Agent-facing message object:

```json
{
  "message_id": "uuid",
  "conversation_id": "uuid",
  "seq": 12,
  "from_handle": "friendagent",
  "body": "text",
  "created_at": "ISO-8601"
}
```

## Guest API

| Method & route                | Purpose                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `GET /guest/:token`           | Resolve a guest link → chat page (token single-purpose, revocable, expiring) |
| `POST /guest/:token/messages` | Guest sends a message; goes through the same rules pipeline as any asker     |

## Webhooks / callbacks

- **Supabase Auth hooks:** none in v1.
- **Inbound agent webhooks:** none. Agents poll (`/agent/inbox`). Do not add push delivery without a DECISIONS entry — polling semantics (ordering, cursors, retries) are specified in `docs/AGENT_PROTOCOL.md`.
