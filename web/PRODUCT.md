# PRODUCT.md — reactable.app

## Product
Reactable: a Mac studio app that records interactive decks on a real stage
(apps, clips, prose, camera) while a built-in agent researches, edits,
assembles, and posts the video. Free tier = full recorder + local agent.
Pro ($20/mo, Polar) = connected accounts (YouTube posting, Meta campaign
intelligence, Google Drive import), creator/brand/consumer research, and
included gateway credits (hosted MiniMax-class inference, atomic ledger).

## Users
Solo creators and small DTC/brand teams who ship product videos, reactions,
and ad creative weekly. Technical enough to live in a Mac menu bar, allergic
to enterprise dashboards. They decide fast; they've seen every SaaS page.

## Brand voice
Studio confidence. Calm, specific, a little cinematic. Say what the thing
does ("Post a take to YouTube by asking the agent") — never "unlock your
potential." The metaphor family: stage, take, cut, ship.

## Visual system (matches the shipped app)
- Surfaces #101010–#171716, hairline #232220 borders, film-grain + spotlight.
- Type: Fraunces (display, italic emphasis) + Spline Sans Mono (body/UI).
- The brand mark: brushed-silver coin with letterpressed ✦ (metal gradient
  #b9b9bd→#f2f2f4→#97979d, inset bevels). PRO is a coin, not a badge word.
- Accent discipline: monochrome first; one warm metal glint; green dots only
  for live/connected states.
- Motion: eased, settles, never bounces. Shine sweeps, staggered rises,
  marquee tickers (the app's own idiom).

## Anti-references
Purple gradients, glassmorphism, identical card grids, Inter-by-reflex,
emoji-as-icons, "Boost your productivity", generic SaaS hero screenshots.
Never name Scrape Creators — sell "brand intelligence / consumer research".

## Pages
- / landing: free download is the hook (Apple mark, "Download free").
- /pro: the membership LP — needs depth: visual aids (mock UI vignettes of
  the agent posting, a campaign-spend mini-table, Drive import chips),
  line-art icons in the app's stroke style, specific outcome copy.
- /dashboard: session-gated true dashboard (plan/credits/connections/app).

## Connections model (locked 2026-07-08)
Multi-account per provider — a user may have several YouTube channels, Meta
ad accounts, Drive accounts. Design:
- KV: `conns:<email>:<provider>` → array of {id (uuid), label (channel
  title / ad-account name / drive email — fetched at callback), sealed
  (AES-GCM tokens), addedAt}. Callback APPENDS (Google:
  prompt=select_account+consent; Meta: auth_type=reauthenticate).
- Status: {connections:[{id,label}]} arrays, never booleans.
- Routes: /api/<p>/connect (always add-another), /api/<p>/disconnect?id=,
  proxy routes take ?conn=<id> (default: first).
- Dashboard: provider row expands to labeled account list, per-account
  disconnect ✕, persistent "+ Add" button with the real brand mark.
- Nexus connector args gain "account": label-or-id matcher.

## Dashboard IA (locked 2026-07-08) — each section is a PAGE
Shared shell: sidebar (real routes, not anchors) + session gate. Pages:
- /dashboard — Overview: account pulse. Plan card, credit meter (compact),
  connection health dots, last 5 published/scheduled takes, quick actions.
- /dashboard/usage — the meter in full: balance, burn-rate sparkline,
  itemized ledger w/ filters (chat/render/research), per-feature breakdown,
  pack top-ups; later mirrors into Polar usage-based meters.
- /dashboard/connections — per-provider panels: labeled accounts, GRANTED
  SCOPES as chips per connection (captured from OAuth token response
  `scope` at callback, stored on the Connection), token health/expiry,
  "expand access" = incremental re-auth requesting more scopes, per-account
  disconnect, + Add. This page IS scope management.
- /dashboard/publishing — the queue: uploads with state
  (draft/scheduled/unlisted/public), edit title/description, reschedule or
  cancel (YouTube videos.update / publishAt), per-video link + thumbnail.
  Worker store: pub:<email> list {videoId, connId, title, state, publishAt}.
  Written by the agent's youtube.upload verb; managed here.
- /dashboard/analytics — the "know what works" promise: YouTube Analytics
  (views/watch-time per published take) + Meta insights (spend/CPM/winners)
  side by side; date-preset switcher; agent-suggested next take.
- /dashboard/billing — plan, Polar invoices/portal, packs, payment state.
Implementation: worker serves /dashboard/* static pages sharing one layout
(header/sidebar partial duplicated; no framework), each page fetches its own
APIs. New APIs needed: /api/publishing/list|update|cancel,
/api/analytics/youtube|meta, scopes stored on Connection at callback.
