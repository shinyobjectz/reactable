# content-intel — trends, radar, breakouts, receipts

The research engine behind Reactable Pro. Two layers: `reactable intel …`
verbs (tracked, graded, stored in the project) and the raw `research`
connector (anything the verbs don't wrap — see skill/connectors/research.md).
Never name the underlying data vendor. Always cite pulls (video ids, handles,
endpoints) in answers — an uncited metric is worth nothing.

## When to reach for what

- Planning an episode → `reactable intel trends --json` (graded topics:
  watching/rising/exploding/peaked/evergreen) then
  `reactable intel radar "<topic>" --json` for the top content right now.
- Before scripting → `reactable intel breakouts --json`: competitor videos
  running ≥3× their own channel baseline; those are the formats to study.
- Before an ad take → `reactable intel ads "<company>"`: what competitors
  PAY to run is the strongest what-converts signal.
- New niche or client → `intel track topic "<q>"` + `intel track competitor
  <handle> --platform youtube|tiktok`, then `intel snapshot`.
- One-off question the verbs don't cover → the `research` connector, raw.

## Budget etiquette (costs the user credits)

snapshot once per day (it no-ops if already ran; --force to override);
radar before deconstructing anything; never more than 2 deep pulls per ask
unless the user asked for depth. Failed pulls cost nothing.

## Honesty rules (hard)

If a topic isn't tracked: say so and give the exact verb — never invent a
number. If sources disagree, show both. If the series has gaps, mention it.
Every metric in your answer traces to a pull you actually made this turn or
to stored series/`intel list` data — name which.

## Feeding the pipeline

trends/radar/breakouts findings become episode briefs per
[[video-strategy]]; a chosen reference video goes through deconstruction
(P2: `intel deconstruct <url>`) into a remix brief that [[video-copy]] and
[[slide-craft]] turn into a deck.
