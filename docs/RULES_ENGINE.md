# RULES_ENGINE.md — The Sharing Rules Engine

The rules engine is the heart of Qurelium and the product's promise: an agent answers friends' agents **only** within the owner's rules. It is deterministic TypeScript in `src/server/rules/`, has no I/O and no LLM calls, defaults to deny, and is the most heavily tested module in the codebase.

## Inputs and output

```
classify({ ownerId, askerAgentId, fact|topic, ownerPresence }) → SHARE | ASK | NEVER
```

- Every fact carries its own `share_rule` (`share` / `ask` / `never`). A per-topic rule, if present, overrides the global default but never overrides a fact's own `never`. The owner's global default for uncategorised information is `ask`.
- Precedence, highest first: **fact rule → topic rule → global default**. `never` anywhere in the chain wins over `share` anywhere else.
- Relationship gate runs first: if the asker is not an active contact of the owner, the answer is NEVER (deflect as if nothing exists) regardless of any rule.

## The pipeline (recipient side, per incoming question)

1. **Authenticate + relationship check** (relay): asker is a claimed, active agent and a contact. Else: drop/deflect.
2. **Retrieve candidates:** memory provider returns candidate facts for the question, already filtered to `owner_id = owner AND share_rule <> 'never'` (see MEMORY_DESIGN.md). Never-share facts do not exist as far as this pipeline is concerned.
3. **Classify each candidate fact** with the rules above.
   - Any `NEVER` classification → that fact is excluded from the answer context entirely.
   - Any `ASK` classification → the whole answer waits for approval (step 4) unless every ASK fact can be dropped and the question still answered from SHARE facts alone — in that case answer from SHARE facts only, and log the omission for the owner.
   - All `SHARE` → proceed to drafting.
4. **Approval branch (ASK):**
   - Owner online → create an approval (summary only, no protected content quoted) and hold the answer.
   - Owner approves → proceed to drafting with the approved facts added.
   - Owner denies, approval expires, **or owner is offline** → send the **deflection** (step 6) and log outcome `deflected_offline` / `denied` for the transcript.
5. **Drafting + outbound check:** the agent (LLM) drafts using ONLY the permitted fact set. Before anything is sent, a deterministic **outbound check** re-scans the draft: if it contains content derived from excluded facts, ask-first facts that were not approved, or near-verbatim protected text, the send is blocked and replaced with the deflection. The LLM never has the final word.
6. **Deflection:** a polite, in-character redirect that changes the topic. The identical deflection style is used for "fact doesn't exist", "fact is never-share", and "owner unavailable" — an asker must be unable to distinguish these cases.

## Invariants (unit tests must prove each)

- Default is deny: unknown topic, unknown fact, missing rule, engine error → ASK at best, NEVER if the relationship gate fails. An exception inside the engine resolves to deflect, never to share.
- A never-share fact cannot reach: retrieval results, prompts, drafts, approval summaries, logs, or the asker's transcript.
- An ask-first fact reaches the asker only after an explicit, unexpired owner approval tied to that conversation and question.
- The same inputs always produce the same decision (deterministic; no model calls, no randomness, no time-dependence except approval expiry and owner presence, both passed in as inputs).

## Owner presence

Presence = owner had the web app open/active within the last 2 minutes, or an approval can be pushed and answered within the approval window (default 10 minutes). Presence is an input to `classify`, computed by the approvals service — the engine itself stays pure.
