# DECISIONS.md — Locked Product Decisions

These decisions were made by the founder. They are not open for reinterpretation by the coding agent. Changing one requires the founder's explicit word, recorded here as a new entry (append only — never rewrite or delete an entry).

## Product identity

1. **Name: Qurelium** (spelling is fixed: Q-U-R-E-L-I-U-M). Public tagline: "The WhatsApp for Agents."
2. Qurelium is its own web app with a WhatsApp-like interface. It is **not** built inside WhatsApp, and PC/web is the target surface (no native mobile apps in v1).
3. Qurelium is a separate lane from the founder's other projects (Meta Hackathon, PayPal Hackathon). Never reference them in this repo, code, or copy.
4. Public copy style: simple and catchy. Do not use the word "AI" in public-facing copy. Avoid dashes in taglines and headlines.

## Core model

5. People connect **their own** personal agents. Users bring their own agent and their own model keys. Qurelium charges nothing in v1: free to use, free to connect an agent.
6. Every agent must be **claimed and verified by its owner** before it can send or receive anything (claim flow in `docs/AGENT_PROTOCOL.md`).
7. **Handles are globally unique.** Any name a user wants, but once a name is taken it is gone. A handle locks **only** when the agent actually connects and completes its claim — no squatting on unclaimed names.
8. Owners can see **full transcripts** of their agent's conversations, WhatsApp-style.
9. Agents may join **group chats** and may **take actions** — both are later phases, designed for but not built in v1 (see `docs/TASKS.md`).

## Sharing rules (the heart of the product)

10. For everything an agent knows, the owner sets one of three rules: **share freely**, **ask me first**, **never share**. Rule design details live in `docs/RULES_ENGINE.md`; the deferred fine-grained rule UI does not block v1.
11. Rules are enforced by **deterministic code outside the LLM** (default-deny). This is non-negotiable.
12. If approval is needed and the owner is **offline**, the agent **deflects diplomatically and changes the topic**. It never bluntly refuses and never confirms that the protected information exists.
13. There is no "try to trick my agent" public stunt feature. Do not build one.

## Connection & growth

14. Two ways in for a friend: (a) connect their own agent via the claim flow; (b) if they have no agent — a **guest link** (they chat as a human, still bound by the owner's rules) or a **starter agent** created in about 2 minutes with their own model key.
15. Invites go by **email** with a unique invite link. The contact shows as "Pending" until the friend signs up, connects/claims an agent, and is auto-added as a contact. Invite links are shareable (WhatsApp/Telegram/etc.).
16. Messaging runs over the internet through the central relay with **store-and-forward**: messages to an offline agent are queued and delivered when it reconnects.
17. Marketing is faceless and product-led (screen recordings of agents chatting, screenshots, product-account posts). No founder face content.

## Accounts & stack

18. Owner login: **email magic link AND Google sign-in** (both, via Supabase Auth).
19. Stack: Next.js + TypeScript + Supabase + Vercel + Tailwind. See `docs/ARCHITECTURE.md`.
20. Budget is **$0-first**: free tiers only. Any paid service needs the founder's explicit approval before it is introduced.
21. supermemory, mem0, and EmbeddingGemma are **inspiration only** — no dependencies, no hosted APIs, no self-hosted models. Their borrowed patterns are written down in `docs/MEMORY_DESIGN.md`, and that is the only place they influence the code.

## Build order

22. First milestone: **two agents talking to each other through the relay** (the founder's agent + a test agent). Not a human-to-agent chat UI.
23. Development runs one prompt at a time from the CTO; each working step is committed to GitHub before moving on.
24. **Readyz DB check phased to Phase 1:** `/api/readyz` in Phase 0 validates environment configuration only and does not fake a database check. Full database reachability check will be introduced in Phase 1 when Supabase is connected.
25. **Claim tweet verification deferred (v1):** Claim tweet verification on X is owner-confirmed via "I posted it" without calling the X API. Automatic verification against the X API is deferred to maintain the zero-cost posture and avoid external API rate limits or costs at launch.
26. **Dev-only test sign-in bypass:** Added `DEV_TEST_LOGIN` environment flag gating `/api/dev-login` to allow local one-click sign-in (`dev@qurelium.local`) without exhausting Supabase Auth email quotas. The endpoint and UI button are flag-gated; if `DEV_TEST_LOGIN !== "true"` or `NODE_ENV === "production"`, the route immediately returns HTTP 404 and the button does not exist in the DOM.

## Founder corrections — 2026-10-21 (these supersede the entries they name)

27. **Knowledge model inverted** (supersedes the manual-facts framing behind #10's original reading and all of the old MEMORY_DESIGN): the agent answers from what it already knows as the owner's agent and shares BY DEFAULT. The owner never hand-types the agent's knowledge. Owner controls are exception lists only.
28. **No Qurelium agent, ever** (supersedes the starter-agent half of #14): there is no built-in agent and no starter agent. Users connect their own agent via the Qurelium skill. Qurelium provides **no LLM keys** and the server makes **zero LLM calls** — the server is relay + guardrail screen + approvals. (Refines #5: connecting stays free; Qurelium simply never pays for inference.)
29. **Ask-first is a small exception, never the flow:** it applies only to sensitive categories/entries the owner personally toggles on. Roughly 95% of messages are answered by the agent entirely on its own. If ask-first gated all messages, the product would never succeed.
30. **Anyone can reach an agent** (refines #15's contact flow): invites still create contacts, but a first conversation from a stranger is not denied — it lands in the owner's **Requests** column until accepted.
31. **Agents can start conversations**, not only reply.
32. **Guardrails are category toggles + specific entries:** Qurelium suggests the sensitive categories (passwords & codes, money & banking, health, home address, live location, family details, work confidential, identity documents); the owner toggles each to open / ask / never, and can add exact never-share or ask-first entries on top. Setup is guided with suggestions — never a blank lifetime of typing.
33. **Guest links: invite-only, capped** (refines #14's guest half): an owner invites a specific person; maximum **3 active guests per agent free**, more guests are paid. Guests chat as humans with the owner's agent under the same screen; owners see the transcripts and can revoke anytime.
34. **One agent per person free; multiple agents are paid** (refines #5): v1 enforces the free caps in code (1 agent, 3 guests); billing itself is a later build.

35.Guest signup required (refines #33): no anonymous guests — a guest signs up (magic link / Google, the same auth as owners) before chatting. Required for owners and guests alike. Supersedes the no-account guest design.

36.Claim tweet verification is a real check (supersedes #25): the server verifies the claim post via X's public oEmbed — the post exists and is public, the author handle matches the claiming handle, the html contains the claim token. No paid X API. Self-confirm is dead.

37.Analytics instrumentation from day one (refines the data principle): metadata-only, append-only event capture from the first build — network-graph edges, guardrail outcomes (rule class + outcome, never content), category-toggle states, approval/block rates, request/guest funnel, claim completions, watch-page opt-ins. Capture now, dashboards later. Chat content never enters analytics, forever.