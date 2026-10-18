# SECURITY.md — Auth, Rate Limiting & Abuse Prevention

## Threat model (what we are actually defending)

1. An agent (or a fake agent) trying to extract another owner's never-share or ask-first information.
2. Handle squatting and impersonation (claiming to be someone else's agent).
3. Spam/abuse: fake agents, message floods, invite spam, claim-code brute force.
4. Credential theft: agent credentials and claim codes are bearer secrets — treat them like passwords.
5. Prompt injection: a malicious asker trying to talk a victim's agent into oversharing. **The defence is architectural: the LLM never sees protected data and never makes the sharing decision (see RULES_ENGINE.md).**

## Authentication & authorization

- **Owners:** Supabase Auth — email magic link + Google OAuth. Sessions validated server-side on every owner API call. No custom auth code.
- **Agents:** at claim time the relay issues a long-lived credential (random 256-bit, shown once, stored only as a hash in `agents.credential_hash`). Every agent request must present it (`Authorization: Bearer …`). The relay resolves credential → agent → owner; payload identity claims are ignored.
- **Claim codes:** random, single-use, 15-minute expiry, stored as HMAC hashes (`CLAIM_CODE_SECRET`). Creating a new code invalidates the owner's previous unused code.
- **Authorization rule of thumb:** an agent may act only in conversations where it is a participant, and only toward contacts of its owner. Every relay operation re-checks participation + contact status; there is no "trusted agent" fast path.
- **Guests:** guest links carry an unguessable token (stored hashed), are revocable and expiring, and grant access to exactly one guest conversation.

## The never-share boundary (hard requirements)

- Facts with `share_rule = 'never'` are excluded from **every** retrieval query in code (`docs/DB_SCHEMA.md` rule 4), are **never embedded** (`embedding` stays NULL), never appear in prompts, logs, approval summaries, error messages, or analytics.
- Approval summaries describe _what kind of thing_ is being asked ("your work schedule") without quoting protected content.
- Deflections never confirm or deny the existence of protected information — the same deflection is used whether the fact exists or not.
- Transcript access: only the two owners of a conversation. Admin/service access is server-side only and audit-logged by request id (never by content).

## Rate limiting (enforced at the relay/API boundary, per identity)

| Scope                               | Limit                                                       | Key                     |
| ----------------------------------- | ----------------------------------------------------------- | ----------------------- |
| Auth endpoints (magic link request) | 5 / min / IP                                                | `ip:<ip>:auth`          |
| Claim-code creation                 | 5 / hour / owner                                            | `owner:<id>:claim`      |
| Agent registration attempts         | 10 / hour / IP                                              | `ip:<ip>:register`      |
| Agent message sends                 | 60 / min / agent, burst 20                                  | `agent:<id>:send`       |
| Agent inbox polls                   | long-poll ≤ 25 s, min interval enforced by cursor semantics | `agent:<id>:poll`       |
| Invite creation                     | 20 / day / owner                                            | `owner:<id>:invite`     |
| Fact writes                         | 120 / min / owner                                           | `owner:<id>:facts`      |
| Guest messages                      | 20 / min / guest token                                      | `guest:<token_id>:send` |

- Implementation: `RateLimiter` interface (`src/server/relay/rate-limit.ts`), v1 backed by the `rate_limits` table with atomic increments. Over-limit → `429` + `Retry-After`, standard error format, code `RATE_LIMITED`.
- Rate-limit counters must never be bypassable by changing payload fields — keys derive from authenticated identity + route class only.

## Input handling & platform security

- Zod-validate everything at the boundary; reject unknown fields on agent-protocol payloads.
- Body size caps (see API_CONTRACTS.md). Content is data, never instructions: text from askers is passed to agents clearly delimited as untrusted content.
- SQL injection is prevented by parameterized queries only (Supabase client); string-built SQL is banned.
- XSS: React escaping is the default; `dangerouslySetInnerHTML` is banned. Message bodies render as plain text, links are not auto-anchored in transcripts.
- CORS: same-origin only for the owner API; the agent API accepts no browser CORS at all.
- Security headers via Next.js config: `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` (except none needed), strict CSP for the app shell.
- Secrets only in env vars (`.env.example`); service-role key never reaches the browser; claim codes and credentials never appear in logs or analytics.
- Dependency hygiene: lockfile committed; no postinstall surprises; new packages require an ARCHITECTURE.md check (AGENTS.md rule).

## Abuse response

- Repeated validation failures or limit breaches from one agent → automatic temporary suspension (`agents.status = 'suspended'`), owner notified in the UI. Reinstatement is an owner action.
- Invite abuse (bulk pending invites) is capped by the daily limit above; revoked invites die immediately.
