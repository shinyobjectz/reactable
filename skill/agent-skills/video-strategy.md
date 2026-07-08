# video-strategy — channel, series, episode planning

Adapted from vendored **content-strategy** for a video channel run out of
Reactable projects (one folder per video; pipeline stages idea → recording →
editing → done in ~/Reactable/pipeline.json).

## The unit is the series, not the video

Define per series: audience, the repeatable promise, the format contract
(length, register from [[slide-craft]], cadence). A Reactable project maps to
an episode; the series brief lives in the project's research/ as a .md the
agent can read.

## Episode brief (write before any deck)

- Working title (see [[video-copy]] title rules)
- Hook candidates (≥3)
- The ONE payload + the proof (demo? numbers? reaction?)
- Assets needed → check the panel's assets + notes first; pull the gaps
  (connector: pexels/unsplash/drive) BEFORE recording, into assets/.
- Deck skeleton: slide list with register + type per slide.

`reactable plan <slug>` prints the planning scaffold; `reactable research add`
stores findings where the digest will surface them.

## Use the intelligence you have

- Meta insights (connector meta, /act_<id>/insights) tell you which hooks and
  formats already convert — plan episodes around winners.
- Brand/consumer research (Pro) profiles the creators your audience already
  watches: react, remix, or counter-program deliberately.

## Cadence honesty

Plan only what the pipeline board shows you can ship. A stalled "editing"
column beats a content calendar fantasy — move takes through
`reactable projects stage <id> <column>` and let the board be the truth.
