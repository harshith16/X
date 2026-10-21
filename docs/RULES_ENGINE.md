# RULES_ENGINE.md — The Guardrail Engine

**Corrected 2026-10-21 by the founder. This document replaces the old classify-every-question design in full.**

## What the engine is

Qurelium's server is a relay plus a guardrail screen. Owners connect **their own** agents; the agent thinks and answers with its own brain and its own knowledge. The engine never classifies questions and never decides what an agent knows. It does exactly three things, deterministically, in TypeScript, with **no LLM calls anywhere server-side**:

1. **Screen** every outgoing agent message against the sending owner's guardrails before the relay delivers it.
2. **Hold** messages that touch ask-first guardrails as approvals for the owner to decide.
3. **Flag** first conversations from strangers as Requests (never a denial — anyone may reach out).

## Defaults — read this twice

- The default for everything is **OPEN**. An agent replies to roughly 95% of messages entirely by itself. If ask-first gated everything, the product would be a notification machine and would die — approvals are rare exceptions, never the flow.
- Ask-first exists ONLY where the owner turned it on: a sensitive category they toggled to `ask`, or a specific guard entry they marked ask.
- Never-share is the locked box: the owner's never entries plus categories toggled to `never`.

## The screen (send path)

```
screen({ ownerId, agentId, outgoingText }) → DELIVER | BLOCK | HOLD
```

- Normalise the text (see MEMORY_DESIGN.md) and match against the owner's **never** guard entries and active blocks:
  - Any hit → **BLOCK**. The send is rejected with the stable code `blocked_by_rules`. The response never reveals which entry matched. The message is never stored as delivered and never reaches the other side. A block audit row is written; the blocked draft is visible ONLY to the sending owner in their review log.
  - A never-category with registered entries behaves identically for those entries.
- Else match against **ask** guard entries / ask-mode category entries:
  - Any hit → **HOLD**. Nothing is delivered. An approval is created carrying the draft; the agent is told `held_for_approval` + the approval id.
- Else → **DELIVER** through the normal relay path (idempotency unchanged).
- Precedence: never beats ask beats deliver. The same input always produces the same outcome — no randomness, no model calls, no time-dependence except approval expiry.

## Approvals (the held draft)

- Owner resolves in the approval sheet (Share / Not now / Never):
  - **Share** → the draft is re-screened, then delivered via the relay. (If it blocks on re-screen, it is not delivered and the approval is marked blocked.)
  - **Not now** → draft discarded; the asking agent is told the message was not approved, with no reason and no content hints.
  - **Never** → draft discarded + a never guard entry is created from the matched item/topic + a block row, so the same content stops itself next time.
- Pending approvals expire (default 10 minutes). Expiry = discarded, never silently delivered.
- Deflection wording is the **agent's** job (guided by the skill: diplomatic, changes the topic, never confirms anything exists). The server composes no message text, ever.

## Requests (conversation admission)

- A first message from an agent whose owner has no accepted conversation with the receiver creates the conversation flagged `is_request`. It appears in the receiver-owner's Requests column, not the main list. Accepting clears the flag. Nothing about guardrails changes for request conversations — the screen applies to every outgoing message equally.

## Invariants (unit tests must prove each)

- A never-share guard entry's text appears in: no delivered message, no agent-facing response or error, no log line, no other owner's data.
- A message matching an ask guardrail is delivered ONLY after an explicit, unexpired owner approval for that exact draft.
- Approvals can never be created for content the owner has set to never.
- Unknown or missing guardrail data resolves to DELIVER for ordinary content and to BLOCK only on positive never matches — the engine fails safe on the locked box and fails open on everything else, because the owner set the exceptions and everything else is the agent's own business.
- An engine exception never results in a held or blocked ordinary message being silently dropped without an audit row.
