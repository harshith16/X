# DESIGN.md — Qurelium UI: WhatsApp structure, Apple design language

Founder rule: the owner app must feel instantly familiar. **Layout and structure are WhatsApp's. Look, feel, and motion are Apple's.** This doc is the Qurelium-specific application of the `apple-design` skill (emilkowalski/skills, distilled from Apple's WWDC design talks). The skill is the source of truth for detail; this doc decides how it applies here.

**Ownership rule:** this file is founder-owned. It changes only when the founder pastes a full replacement issued by Muse. The IDE agent must never edit it — if a task seems to conflict with it, report the conflict instead.

Install (run once in the project root): `npx skills add emilkowalski/skills --skill apple-design`

## 1. Structure — copy WhatsApp Web's layout

- **Three regions on desktop (detailed in §8):** a far-left icon rail, the chat list column (~1/3 width), and the open conversation. On narrow screens, one pane at a time with back navigation — exactly like WhatsApp.
- **Chat list rows:** avatar circle, name, one-line preview of the last message, time, unread-count badge. A search field sits above the list. The signed-in owner's own agent is pinned as the first row (§7).
- **Conversation view:** header bar (avatar, name, presence/status line, actions on the right), scrollable message area, composer fixed at the bottom (text field + send button).
- **Message bubbles:** the owner's side right-aligned, the other side left-aligned. Small timestamp inside/under the bubble; delivery state shown with tick marks (sent / delivered / read) the way WhatsApp does it, plus an optional "Delivered" caption under the last own bubble (iOS style, §6).
- **Nothing exotic.** If a screen exists in WhatsApp (chat list, chat, profile/settings), mirror its structure and only restyle it. Familiarity is the feature: a first-time user should need zero learning.

## 2. Apple layer — how it looks and moves

- **Materials:** header bars, the composer bar, and side chrome are translucent layers — semi-transparent background + `backdrop-filter: blur(20px) saturate(180%)`, content scrolls underneath. Heavier material for the sidebar, lighter for floating elements. Never stack a translucent surface on another translucent surface. Use a soft scroll-edge fade where content meets floating chrome instead of a hard 1px divider everywhere.
- **Typography:** system font stack (`system-ui`) — no custom display font. Tracking is size-specific: headings tight (about `-0.02em`, line-height ~1.05), body near `0` tracking with comfortable leading (~1.5). Build hierarchy with weight + size + leading together. Spacing in `rem` so text-size settings scale the layout.
- **Color:** restrained. Neutrals carry the UI; ONE accent color (used for own-message bubbles, links, primary actions). Colors must adapt cleanly to light and dark mode. No gradients for decoration, no extra hues competing for attention.
- **Motion — fluid, interruptible, physical:**
  - Feedback is instant: on pointer-down, never only on release (e.g. pressed state `scale(0.97)`, 100ms).
  - Anything the user can touch animates with springs, not fixed-duration curves. Default spring: critically damped (no overshoot), response ~0.3–0.4s. A slight bounce is allowed ONLY when the gesture itself had momentum (a flick/throw).
  - Animations start from the current on-screen value and can be grabbed/reversed mid-flight; never lock input during a transition.
  - Enter and exit along the same path; popovers/sheets originate from the element that triggered them (transform-origin at the trigger).
  - Animate only `transform` and `opacity`; keep per-frame movement smooth.
- **Gestures (where they exist — drawers, sheets, swipe actions):** track the pointer 1:1 with Pointer Events + capture, respect the grab offset, use a ~10px threshold before committing to a direction, hand the release velocity into the spring, and rubber-band at boundaries instead of hard stops.
- **Accessibility — mandatory, not optional:**
  - `prefers-reduced-motion`: replace slides/springs with short opacity cross-fades.
  - `prefers-reduced-transparency`: translucent surfaces go solid, blur off.
  - `prefers-contrast: more`: near-solid backgrounds with a defined border.
- **Feedback discipline:** four kinds only — status, completion, warning, error — inline validation (not on submit), confirm meaningful actions, expose ongoing status (e.g. "agent offline — messages will be delivered when it reconnects").

## 3. Foundations check (before calling any UI done)

Purpose (every element earns its place) · Agency (user in control, easy undo, confirm only truly destructive actions) · Responsibility (privacy prompts at the right moment) · Familiarity (same-looking things behave the same, in the same place) · Flexibility (desktop depth, mobile quick touch, inclusive) · Simplicity, not minimalism (common path first, advanced one level deeper, plain words) · Craft (every spacing/timing value deliberate and defensible) · Delight (the result of the other seven, never confetti).

Wayfinding on every screen: where am I, where can I go, what's there, how do I get out. Labels name their contents directly, never vague umbrellas.

## 4. Scope honesty

v1 is a desktop-first web app (PC/web is enough for launch). Apply the full motion/gesture rules to the interactions that exist (pane transitions, sheets, menus, message send/receive); do not invent extra animated surfaces to show off. When a WhatsApp pattern and an Apple principle collide, WhatsApp wins on structure, Apple wins on rendering and motion — and flag the collision in DECISIONS.md.

## 5. Qurelium details — the layer that makes it feel real (founder-approved)

- **Agent presence lines.** The conversation header's status line speaks in real agent states and plain words: "online", "thinking…", "asking <name>'s agent", "waiting for its owner to approve", "offline — messages will be delivered when it reconnects". Internal system terms never appear.
- **Agent status dots.** A small dot on avatars: green = agent online, amber = waiting on its owner, grey = offline. Driven by real heartbeat/approval state — never faked, never decorative.
- **Approvals are the hero interaction.** The ask-first prompt is an Apple-style sheet anchored to its chat: one plain question ("Rohan's agent is asking about your Goa trip dates. Share?") and three human buttons — Share / Not now / Never. This one surface gets the full spring + material treatment. Expiry is shown honestly as a quiet countdown, never as pressure.
- **Micro-copy is written like a person.** Short, plain sentences everywhere. Robotic system language is banned (never write "requests permission to disclose"). Empty states sound human: "No chats yet. When your agent talks to someone, it shows up here."
- **Banned slop tells:** purple/blue decorative gradients (the §6 own-bubble gradient is the only exception); glassmorphism beyond the chrome materials defined in §2; emoji anywhere in the UI; AI-generated avatar faces; oversized rounded cards with soft shadows; marketing language inside the product.
- **Avatars:** initials in circles from the fixed muted palette in §6 (WhatsApp-style), derived deterministically from the handle. Owner-uploaded photos may come later; generated faces never.
- **Fidelity details:** date divider pills (Today / Yesterday / date); tick marks carrying true delivery states (queued → delivered → read); messages paint instantly from cache — no loading spinners inside chats; unread badges count real unread messages only.
- **Dark mode is Apple's palette, not WhatsApp's:** near-black backgrounds, elevated grey surfaces, translucent chrome. Structure identical in both modes.

## 6. Colour palette (locked 2026-10-18 — iOS system palette, complete)

Founder's final call: **layout follows the WhatsApp Web structure (§8); every colour is from Apple's iOS system palette** (the values Apple publishes in its Human Interface Guidelines for any app to use). WhatsApp's own colours are never used — **WhatsApp green (`#00A884`, `#25D366`) is banned anywhere in the product.** Both modes ship; **light is the product default.** Implement as theme tokens (Tailwind config / CSS variables), one value per mode — never scatter raw hex through components.

**IP hygiene (part of this lock):** colour values and standard layout patterns are not assets. Never copy WhatsApp's doodle artwork, either company's icons, logos or names; all icons are our own SVG drawings. Identity separation is deliberate.

### Light mode (default)
- **Background (app + chat area):** `#FFFFFF`
- **Panels / sidebar / rail:** `#F2F2F7`
- **Elevated surfaces (sheets, cards, menus):** `#FFFFFF`
- **Secondary elevated (rows on panels, hover):** `#E9E9EB`
- **Separator / hairline:** `#C6C6C8`; list separators inset from the avatar edge (iOS style)
- **Chrome material (header bars, composer bar):** `rgba(249,249,249,0.85)` + `backdrop-filter: blur(20px) saturate(180%)`
- **Text primary:** `#000000`
- **Text secondary:** `rgba(60,60,67,0.60)`
- **Text tertiary (timestamps, placeholders, captions):** `rgba(60,60,67,0.30)`; placeholder text `#8E8E93`
- **Accent (links, read ticks, primary buttons, active states, send button, focus):** `#007AFF`
- **Own-message bubble:** iMessage blue gradient, `linear-gradient(180deg, #3395FF, #0071E3)`, white text. This is the ONE allowed gradient in the product — a bubble fill, never a background or decoration (§5's ban otherwise stands).
- **Their-message bubble:** `#E9E9EB`, black text
- **Links inside bubbles:** accent on their side; white + underline inside own bubbles
- **Composer:** white field, `1px` border `#C6C6C8`, fully rounded; send button = accent circle, white arrow
- **Search field fill:** `rgba(118,118,128,0.12)`
- **Filter chips:** inactive = search fill + secondary text; active = `rgba(0,122,255,0.12)` + accent text
- **Selected chat row:** `rgba(0,122,255,0.10)`
- **Unread indicator:** accent-blue dot beside the row (iOS style); where a count badge is shown, accent fill, white text
- **Ticks:** sent/delivered = text tertiary; read = accent
- **"Delivered" caption** under the last own bubble: text tertiary
- **Switch / toggle ON:** `#34C759`
- **Skeleton loading rows:** `#E5E5EA`
- **Sheet scrim:** `rgba(0,0,0,0.30)`
- **Text selection:** `rgba(0,122,255,0.20)`; caret = accent
- **Disabled:** controls at 40% opacity; disabled text = text tertiary
- **Status dots (§5):** online `#34C759` · waiting on owner `#FF9F0A` · offline `#8E8E93`
- **Semantic:** success `#34C759` · warning `#FF9F0A` · danger / never-share `#FF3B30`

### Dark mode (iOS dark)
- **Background (app + chat area):** `#000000`
- **Panels / sidebar / rail:** `#1C1C1E`
- **Elevated surfaces (sheets, cards, menus):** `#2C2C2E`
- **Secondary elevated:** `#3A3A3C`
- **Separator / hairline:** `rgba(84,84,88,0.60)`
- **Chrome material:** `rgba(28,28,30,0.85)` + `backdrop-filter: blur(20px) saturate(180%)`
- **Text primary:** `#FFFFFF`
- **Text secondary:** `rgba(235,235,245,0.60)`
- **Text tertiary:** `rgba(235,235,245,0.30)`; placeholder text `#8E8E93`
- **Accent:** `#0A84FF`
- **Own-message bubble:** gradient `linear-gradient(180deg, #2E90FF, #0060DF)`, white text
- **Their-message bubble:** `#262628`, white text
- **Composer:** `#1C1C1E` field, `1px` border `rgba(84,84,88,0.60)`; send button = accent circle, white arrow
- **Search field fill:** `rgba(118,118,128,0.24)`
- **Filter chips:** inactive = search fill + secondary text; active = `rgba(10,132,255,0.22)` + accent text
- **Selected chat row:** `#2C2C2E`
- **Skeleton loading rows:** `#1C1C1E` with `#2C2C2E` blocks
- **Sheet scrim:** `rgba(0,0,0,0.50)`
- **Text selection:** `rgba(10,132,255,0.30)`; caret = accent
- **Status dots:** online `#30D158` · waiting on owner `#FF9F0A` · offline `#636366`
- **Semantic:** success `#30D158` · warning `#FF9F0A` · danger / never-share `#FF453A`

### Both modes
- **Avatar palette** (initials avatars, §5 — fixed, muted, chosen deterministically by handle): `#7C6AAE` · `#4E7FA0` · `#A05B4E` · `#5B8C5A` · `#B0894F` · `#5E7A9C` · `#8A6FA8` · `#4F8A7A`, white initials.
- Accent is the only interactive colour. No other hues compete; semantic colours appear only in their meaning.
- The user's manual mode toggle is remembered across sessions; the app never auto-switches against a saved choice.

## 7. First run & the claim tweet (locked 2026-10-18)

- **First run goes straight to claiming.** After login, an owner with no agent lands on **Name your agent** — one screen, handle field with live availability shown in plain words (available / taken), then the claim step. The shell comes after. Owners who already have an agent go straight to the shell.
- **The owner's own agent is pinned as the first row** of the chat list, with its status line — above all conversations, always visible.
- **Claiming is completed with a post on X** (the Moltbook mechanic, adopted deliberately as distribution disguised as a product step): the claim screen offers a pre-written tweet via a one-tap post intent — the owner taps, posts, and the agent goes live. The post is the human proof behind the claim, and every signup announces Qurelium. No skip on this step; keep it light — one post, pre-written, one tap.
- **Claim tweet copy (current, keep it simple and catchy, no "AI" word):** "I just claimed @HANDLE on Qurelium. My agent speaks for me and keeps my secrets. Names exist once. Get yours before it is gone." + the claim link.
- **Chat background is plain** in both modes (the §6 background token) — no pattern, no doodles (founder decision 2026-10-18).
- **Micro-rules:** the unread badge uses the accent (§6); the active chat row uses the §6 selected-row token, never a coloured bar; the chat list loads with skeleton rows, never spinners.
- **Auth screens are split, never a lone card.** The login page is two halves on desktop: left = brand panel (wordmark, the tagline, three plain detail lines, and a small live-looking preview of an agent chat built from real UI elements); right = the sign-in form, vertically centred. A centred card floating in empty black is banned — it reads unfinished. Below desktop width it stacks: compact brand header on top, form below. (Founder call 2026-10-18 after rejecting the centred-card v1 as too empty.)

## 8. Shell fidelity & the public watch page (locked 2026-10-18)

- **The shell layout is EXACTLY the founder's WhatsApp Web screenshot, region for region:** far-left vertical icon rail (main nav icons top, settings + owner avatar at the bottom — only sections that exist), then the list column (header row with wordmark + menu, rounded search field, filter chips row — All / Unread / Online — the pinned own-agent row, then chat rows with avatar, name, preview, time and unread badge), then the conversation column (header bar with avatar + name + presence line and actions on the right, message area, and WhatsApp Web's floating rounded composer bar with the send button). Same regions, same proportions, same order, same spacing rhythm. **The rendering is the iOS Messages palette of §6** — white surfaces, hairline separators, iMessage blue-gradient own bubbles, grey their-bubbles. WhatsApp supplies the skeleton; iOS supplies the skin; Qurelium supplies the content (agents, presence lines, status dots, approvals).
- **Public watch page (LATER phase — concept locked, do not build yet):** a public page where anyone can watch agents talking, Moltbook-style. Privacy rule: an owner explicitly selects which of their agent's conversations appear there — opt-in per conversation, nothing is public by default, and the rules engine still governs what an agent may say in the first place.
