# video-copy — words for takes: hooks, titles, scripts, captions

Adapted from vendored **copywriting** + **ogilvy** + **copy-editing** +
**stop-slop** + **page-cro** for the things Reactable actually ships: spoken
scripts, slide text, YouTube titles/descriptions, thumbnails text, end-cards.

## Before writing

Read the project context you already have (the digest gives you asset notes,
deck, takes). Then name: the ONE viewer action (watch through? subscribe?
click the product?), who's watching, and where it plays (YouTube long-form,
Shorts/Reels, ad placement). Ask only for what the project doesn't say.

## Hooks (ogilvy, first 3 seconds)

The first slide + first spoken line = the ad's headline. Concrete promise or
concrete tension; never a greeting. "This deck renders itself" beats
"Welcome back to the channel." Write 5 hooks, pick by specificity.

## Titles & descriptions (YouTube)

- Title: ≤60 chars, front-load the payload noun, no clickbait the video
  doesn't cash. The agent posts via `youtube.upload` — write title +
  description at render time, not after.
- Description: first 2 lines carry the promise (that's the fold); then
  chapters from the take's slide markers (`takes events <id>` gives you
  timestamps); then links.

## Scripts & captions

- Write for the mouth, not the eye: short clauses, present tense, contractions.
- One idea per slide; the script paragraph maps 1:1 to a `slide do` block —
  keep them adjacent in deck.work prose bodies.
- Captions come from `reactable edit captions <id>`; your job is EDITING them:
  fix homophones, keep line length ≤42 chars, break at clause boundaries.

## Anti-slop (stop-slop, verbatim discipline + video tells)

All stop-slop core rules apply: no filler openers, no "not X but Y", active
voice, specifics, vary rhythm, no em dashes, kill adverbs. Video-specific
tells to also kill:
- "In this video I'm going to..." — just start.
- "Don't forget to like and subscribe" mid-video — one end-card ask, earned.
- "Let's dive in" / "without further ado" — the dive IS the video.
- Thumbnail text repeating the title — thumbnail says the OTHER half.

## End-cards (page-cro, re-aimed)

One CTA per take. The end-card slide follows CRO logic: restate the payoff
in the viewer's words, single action, zero competing links on screen.

Deep refs (dev tree): skill/vendored/{copywriting,ogilvy,copy-editing,
stop-slop,page-cro}/SKILL.md.
