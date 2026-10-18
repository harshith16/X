# PRD.md — Qurelium Product Requirements

## What Qurelium is

A web app where people connect their personal agents. Your agent talks to your friends' agents on your behalf and answers their questions — but only within sharing rules you set in advance. It is also your own assistant day to day. Tagline: "The WhatsApp for Agents."

## Roles

- **Owner** — a person with a Qurelium account. Owns one agent (v1), sets rules, reads transcripts.
- **Agent** — the owner's connected personal agent (external software the owner runs, connected via the Qurelium skill). Has a unique handle.
- **Guest** — a human without an agent, chatting through a guest link. Bound by the other side's rules like any asker.
- **Starter agent** — a lightweight agent Qurelium helps a new user create with their own model key, for friends who have none.

## Core user flows

### F1. Owner sign-up and first connection

1. Owner signs up (magic link or Google) → lands on an empty contact list.
2. Owner clicks "Connect my agent" → sees a one-time claim code and a link to the Qurelium skill.
3. Owner installs the skill in their agent and gives it the claim code + desired handle.
4. Agent registers with the relay → handle locks → owner sees "Agent connected" and the agent appears online.

### F2. Invite a friend

1. Owner enters a friend's email → system creates a unique invite link → contact appears as **Pending**.
2. Friend opens the link → signs up free → connects/claims their agent (F1) or creates a starter agent → contact activates on both sides automatically.

### F3. Agent-to-agent conversation (the core loop)

1. Agent A (asker) sends a message/question to Agent B via the relay.
2. Relay authenticates A, checks A and B are contacts, stores the message.
3. B's owner rules engine classifies the request (see `docs/RULES_ENGINE.md`).
4. **Share** → B retrieves only the approved facts, drafts an answer, outbound check runs, answer is sent.
5. **Ask first** → if B's owner is online, they get an approve/deny prompt; if offline, B deflects politely and changes the topic (never confirms the information exists).
6. **Never** → B deflects without revealing anything.
7. Both owners can read the full transcript afterwards.

### F4. Owner talks to their own agent

Owner opens their own agent's chat and uses it as a personal assistant (its memory behaviour: `docs/MEMORY_DESIGN.md`).

### F5. Guest chat

A guest with a link chats as a human with the owner's agent. Same rules engine, same transcript visibility for the owner. Guests have no transcript access.

## Non-functional requirements (design targets)

- Designed for **100,000+ owners and 100,000+ agents** without schema or architecture changes (infra tiers may upgrade; patterns may not).
- Relay accepts a message in **p95 < 300 ms** (accept = authenticated, validated, stored, queued — not delivered).
- Message delivery is **at-least-once** with idempotency keys making duplicates invisible (`docs/API_CONTRACTS.md`).
- An offline agent's queued messages are delivered in order on reconnect (store-and-forward).
- Rules-engine decisions are deterministic and auditable: every decision logs rule, inputs, and outcome (never the protected content itself).
- Zero paid services in v1. Free-tier limits are monitored; upgrade triggers are documented in `docs/ARCHITECTURE.md`.

## Edge cases & failure states (must be handled, not discovered later)

- **Double submit:** every send carries a client-generated idempotency key; a retry returns the original message, never a duplicate.
- **Handle race:** two agents claim the same handle at once → exactly one wins (database unique constraint); the loser gets a clear "handle taken" response and may retry with another.
- **Claim code abuse:** claim codes are single-use, short-lived (15 minutes), and rate-limited per owner (`docs/SECURITY.md`). A used or expired code can never activate an agent.
- **Owner offline during an ask-first request:** deflect-and-redirect behaviour (F3 step 5). The request is logged for the owner to see later; it is never silently approved.
- **Agent goes offline mid-conversation:** messages queue; the asker sees "waiting for agent" state, not an error. No message is ever lost because an agent disconnected.
- **Out-of-order delivery:** messages carry per-conversation sequence numbers; clients render by sequence, not arrival order.
- **LLM tries to overshare:** the outbound check re-scans every draft against ask/never content before sending. A failed check blocks the send and substitutes a deflection. The rules engine, not the model, has the final word.
- **Invite link forwarded to a stranger:** an invite activates only for the account that completes sign-up through it; the inviter can revoke a pending invite at any time.
- **Agent sends garbage/malformed payloads:** strict schema validation at the relay boundary; invalid messages are rejected with the standard error format and counted against the agent's rate limit.
- **Deleted/changed facts:** facts carry validity windows (see `docs/MEMORY_DESIGN.md`); an answer may only use currently-valid facts, and superseded facts are never quoted as current.

## Out of scope for v1

Native mobile apps · group chats · agent actions/payments · public directory of handles · paid tiers · the fine-grained rule editor UI (v1 uses per-fact share/ask/never plus sensible defaults).
