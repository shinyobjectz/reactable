# MiniMax gateway exploration — Reactable as the model vendor

Status: exploration, no decision. 2026-07-07.
Key for local experiments: `~/.reactable/minimax.key` (0600; **rotate it** — it
transited a chat log).

## The idea

Replace/augment the local Gemma agent with MiniMax served through **our**
gateway: users top up credits on the Reactable dashboard, their desktop nexus
calls `gateway.reactable.app` with a Reactable key, we proxy to MiniMax and
surcharge tokens. The full MiniMax line (LLM + video + image + speech + music)
becomes native generative tools inside the nexus sandbox. BYO connectors
(ElevenLabs, FAL, Higgsfield, YouTube) stay local with the user's own keys;
vendored data (Scrape Creators, Pexels/stock) rides the same credit meter.

## Why MiniMax fits Reactable specifically

Their line maps 1:1 onto the take pipeline we already built:

| MiniMax capability | Reactable slot |
|---|---|
| M-series LLM (M2 today; track M3) | the agent brain (replaces/augments Gemma in `agent chat`) |
| Hailuo video (t2v/i2v) | **generated b-roll as lineup scenes** and HF timeline assets |
| image gen | thumbnails, title cards, `client :unit` slide art |
| speech (TTS voices) | alt voiceover lane next to `tts speak` (kokoro) |
| music gen | bed tracks for the composite/HF mix |

That last mile is the differentiator: nobody else drops generated b-roll
directly into a recording rundown with sync anchors.

## Technical shape (nothing hosted except the gateway)

```
desktop nexus ──REACTABLE_KEY──► gateway (CF Worker)
                                   ├─ auth: reactable.app account (auth login exists)
                                   ├─ meter: per-key credits, streaming token count
                                   ├─ price table: per-model in/out + per-clip
                                   └─ proxy → MiniMax API (our master key)
                                            → Scrape Creators (our key)
                                            → Pexels/stock (our keys)
local-only:
  gemma (reactable-tools MLX)      ← free tier / offline fallback
  BYO keys (11labs, FAL, Higgsfield) ← keychain, never touch the gateway
```

- **Gateway**: one CF Worker (same muscle as brandnana/adalign workers):
  `/v1/chat` (OpenAI-compatible passthrough, streaming), `/v1/video`,
  `/v1/image`, `/v1/speech`, `/v1/data/{scrape,stock}`. Meter on the way
  through; 402 when credits run out; Stripe top-ups on the dashboard.
- **Desktop**: agent provider setting `gemma | minimax` (bar gear / settings).
  `agent chat` routes accordingly. New CLI verbs land as `gen video|image|
  speech|music` writing into the active project's `assets/`, so takes and
  decks can reference them immediately.
- **Sandboxing**: generated-tool calls run in the nexus sandbox like existing
  toolkits; the gateway key lives in `~/.reactable/` (not in projects, never
  committed — same pattern as `auth login`).
- **Metering integrity**: count tokens server-side from the provider response
  (not client-reported); per-key rate limits; per-model price table versioned
  so provider price changes don't silently eat margin.

## Business read

**Model A — credits + surcharge (the MiniMax direction)**
- Pay-as-you-go, zero fixed price objection; margin scales with usage.
- Typical resale surcharge that survives scrutiny: 25–40% on tokens, more on
  video/clip units (verify current MiniMax list prices before modeling —
  don't trust cached numbers).
- Cost basis only exists when revenue exists. No idle burn: the only fixed
  cost is one Worker.
- Risks: master-key abuse (mitigate: per-user keys, quotas, anomaly cutoffs),
  MiniMax ToS on resale (**open question — read their commercial terms; the
  partnership conversation you want is exactly this**), price volatility.

**Model B — $20/mo flat, Gemma + connectors + vendored search**
- Predictable revenue, dead-simple pitch; local Gemma costs us nothing per
  token, so gross margin is ~everything minus vendored API usage.
- But: Gemma quality gap vs frontier models is the churn engine; "unlimited"
  pressure lands on the vendored data APIs (the only metered cost) — needs
  fair-use caps anyway, which erodes the simplicity.

**Recommended hybrid (paper position)**
- Free/local: Gemma agent, all BYO connectors, full recorder. This is the
  demo and the dogfood, and it works offline.
- Credits: MiniMax suite + vendored data through the gateway, 30%-ish
  surcharge, $5 starter grant.
- Optional $20/mo "Creator" plan = $15 credits included + priority + stock
  bundle. The subscription is a credits wrapper, not a separate system.
- Sequence: gateway with chat-only first (agent swap is one provider flag),
  then video/image/speech tools, then vendored data. Partnership pitch to
  MiniMax once there's usage to show.

## Open questions to resolve before any build

1. MiniMax commercial/reseller terms + international (minimax.io) vs CN API.
2. Current price sheet per model (chat in/out, video per second/clip, TTS per
   1k chars) → margin table.
3. Stripe credits UX on the existing reactable.app auth (creator-vault has
   the billing patterns to steal).
4. Does M-series streaming latency from their intl endpoint feel acceptable
   inside `agent chat`? (Bench with the stored key.)
5. Pexels ToS: free API forbids commercial *resale* of the API itself —
   vendoring may need their partner tier or a paid alternative (Shutterstock
   API, Storyblocks).

## Verdict on paper

The credits+surcharge gateway is the better first move: it monetizes from the
first token, keeps the desktop fully local except one Worker, maps MiniMax's
whole catalog onto pipeline slots we already dug, and creates the usage story
a partnership needs. Keep Gemma as the free tier rather than a competing $20
plan — one billing system, two tiers.
