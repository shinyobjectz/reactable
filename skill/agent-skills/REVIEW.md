# Vendored-skill review — ruling per skill, in catalog order

Source: skill/vendored/ (boraoztunc/skills, 38). Target: the in-app Reactable
agent, whose surfaces are decks/slides/client-islands on the stage, takes,
and the video pipeline — NOT landing pages. Rulings: **ADAPT** (rewritten
Reactable-native under skill/agent-skills/), **REF** (kept as deep reference
loaded on demand from skill/vendored/), **DROP** (wrong surface for the
in-app agent; still available to us humans in the repo).

| # | skill | ruling | destination / why |
|---|-------|--------|-------------------|
| 1 | adversarial-review | DROP | code-review workflow; the app agent ships videos, not PRs |
| 2 | analytics-tracking | DROP | web analytics instrumentation — wrong surface |
| 3 | animejs | REF | motion option inside [[slide-motion]] |
| 4 | app-store-screenshots | DROP | not our pipeline |
| 5 | competitor-alternatives | DROP | SEO comparison pages |
| 6 | conductor-rewrite-performance | DROP | tool-specific |
| 7 | content-strategy | ADAPT | → video-strategy: channel/series/episode planning |
| 8 | copy-editing | ADAPT | folded into [[video-copy]]: scripts, captions, titles |
| 9 | copywriting | ADAPT | core of [[video-copy]] — hooks, promises, specificity |
| 10 | css-animations | ADAPT | core of [[slide-motion]] — record-safe CSS motion |
| 11 | emil-design-eng | REF | design-engineering taste; referenced by [[island-design]] |
| 12 | frontend-design | ADAPT | → island-design: `client :unit` HTML islands on stage |
| 13 | gsap | REF | timeline motion in islands + HyperFrames; [[slide-motion]] |
| 14 | hyperframes | ADAPT | → takes-post: our `takes hf` pipeline is the real subject |
| 15 | hyperframes-cli | ADAPT | folded into [[takes-post]] verb table |
| 16 | hyperframes-media | ADAPT | folded into [[takes-post]] (media/assets handling) |
| 17 | hyperframes-registry | REF | component registry lookups from [[takes-post]] |
| 18 | impeccable | ADAPT | → slide-craft: the design vocabulary, re-registered for stage surfaces; deep refs loaded from vendored |
| 19 | linear-local-first-architecture | DROP | app-architecture essay |
| 20 | lottie | REF | vector motion option; [[slide-motion]] |
| 21 | make-interfaces-feel-better | REF | micro-interaction taste; [[island-design]] |
| 22 | ogilvy | ADAPT | ad discipline → [[video-copy]] (hooks, thumbnails, ad takes) |
| 23 | page-cro | REF | conversion thinking, re-aimed at end-cards/CTAs in [[video-copy]] |
| 24 | programmatic-seo | DROP | web SEO at scale — not the app agent's job |
| 25 | schema-markup | DROP | structured data for websites |
| 26 | seo-audit | DROP | website audits |
| 27 | stop-slop | ADAPT | → applies verbatim to video copy + slide text; folded into [[video-copy]] with video tells added |
| 28 | tailwind | REF | islands may use utility CSS; [[island-design]] |
| 29 | three | REF | 3D slides; [[slide-motion]] overdrive lane |
| 30 | typegpu | DROP | niche GPU compute — revisit if wasm-video lands |
| 31 | vercel-react-best-practices | REF | HyperFrames comps are React; [[takes-post]] |
| 32 | waapi | REF | scripted motion without deps; [[slide-motion]] |
| 33 | web-design-guidelines | DROP | fetches web-app rules; stage isn't a web app |
| 34 | remotion-to-hyperframes | ADAPT | folded into [[takes-post]] migration section |
| 35 | website-to-hyperframes | REF | capture path already exists as `har` verbs; noted in [[takes-post]] |

Net: 6 native skills — slide-craft, island-design, slide-motion, video-copy,
video-strategy, takes-post. DROPs remain in skill/vendored/ for human use.
Bundling: agent-skills/ ships in dist; vendored/ deep refs resolve only in
the dev-tree project (documented in each skill).
