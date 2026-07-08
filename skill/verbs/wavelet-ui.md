# wavelet-ui — animated components for decks and comps

Remocn ports (motion values 1:1) rendered by the deterministic wavelet lane.
Every component emits self-contained CSS keyframes — no JS at render time.

## Verbs
```
reactable ui list                 # all components (name · category · title)
reactable ui show <name>          # props + defaults + description
reactable ui demo <name> [out]    # write a standalone demo comp html
reactable ui add <name> --props '{...}' [out]   # emit a fragment/page with your props
```
Render any emitted page: `reactable-tools wavelet-render <page.html> out.mp4 --duration 2.5`.
Components marked *filter-dependent* use CSS `filter:` — full fidelity in the
Chrome/HyperFrames lane; wavelet-native paints them without the blur channel
until the render-core filter pass lands (tracked in the fidelity gate).

## text

### soft-blur-in *(filter-dependent)*
Per-character blur + rise reveal with a gentle overlapping stagger.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| blur | `12` | start blur px |

### per-character-rise
Characters rise and fade in one after another.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| distance | `32` | rise px |

### staggered-fade-up
Words fade up in sequence — the workhorse headline reveal.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| staggerDelay | `4` | frames between words |
| distance | `20` | rise px |

### spring-scale-in
Words pop in with a springy overshoot.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| staggerDelay | `3` | frames between words |
| scaleFrom | `0.7` | start scale |

### top-down-letters
Letters drop in from above, one at a time.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| staggerDelay | `3` | frames between chars |
| distance | `46` | drop px |

### bottom-up-letters
Letters rise in from below, one at a time.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| staggerDelay | `3` | frames between chars |
| distance | `46` | rise px |

### blur-out-up *(filter-dependent)*
Words blur-rise in, hold, then lift away upward — enter and exit in one component.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| staggerDelay | `1` | frames between words |
| holdFrames | `30` | hold before exit |

### tracking-in *(filter-dependent)*
Wide letter-spacing contracts into place while blur resolves.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| startTracking | `0.5` | em |
| startBlur | `12` | px |
| durationFrames | `30` | contraction length |

### mask-reveal-up
Lines slide up out of clipped masks — the classic title-card reveal.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| distance | `30` | rise px (also mask depth) |
| staggerDelay | `3` | frames between lines |

### typewriter
Monospaced typing reveal with a blinking caret.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| charsPerSecond | `22` | typing speed |
| caretColor | `"#f4f4f5"` | caret |

### shimmer-sweep
A light band sweeps across the text via animated background-position.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| sweepFrames | `45` | sweep length |
| base | `"#3f3f46"` | base color |
| highlight | `"#ffffff"` | sweep color |

### short-slide-right
The whole line glides rightward into place while words fade in sequence.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| distance | `24` | slide px |
| staggerDelay | `3` | frames between words |

### slot-machine-roll
Characters roll vertically into place like slot reels.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| staggerDelay | `2` | frames between chars |
| durationFrames | `14` | roll length |

### line-by-line-slide
Stacked lines slide up into place one after another.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| staggerDelay | `4` | frames between lines |

### inline-highlight
A phrase inside a sentence flips to an accent color.

| prop | default | doc |
|---|---|---|
| before | `"Ship features "` | text before |
| highlight | `"twice as fast"` | highlighted phrase |
| after | `" with confidence"` | text after |
| highlightColor | `"#ff5e3a"` | accent |
| highlightAtSeconds | `0.5` | when it flips |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

### marker-highlight
A marker stroke sweeps behind a phrase; the text dips to ink color.

| prop | default | doc |
|---|---|---|
| before | `"The "` | text before |
| highlight | `"one command"` | marked phrase |
| after | `" deploy"` | text after |
| markerColor | `"#fde047"` | marker |
| inkColor | `"#171717"` | text over marker |
| sweepAtSeconds | `0.4` | sweep start |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

### strikethrough-replace
A word gets struck through and its replacement rises in beside it.

| prop | default | doc |
|---|---|---|
| from | `"hours"` | struck word |
| to | `"minutes"` | replacement |
| accent | `"#f87171"` | strike color |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

### matrix-decode
Text resolves out of scramble noise, left to right (seeded, deterministic).

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| charset | `"!@#$%^&*()_+-=<>?/\\\\|"` | scramble glyphs |
| revealFrames | `60` | total decode length |
| seed | `"decode"` | scramble seed |

### rgb-glitch-text
Chromatic-split glitch burst — red/cyan copies jitter for a few frames (seeded).

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| glitchAtFrames | `20` | burst start frame |
| glitchFrames | `8` | burst length |
| magnitude | `5` | jitter px |
| seed | `"glitch"` | jitter seed |

### rolling-number
Digits roll up into their final value, odometer style.

| prop | default | doc |
|---|---|---|
| value | `"42,318"` | final number string |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

## reveal

### micro-scale-fade
Subtle whole-block scale + fade — the quiet reveal.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| scaleFrom | `0.96` | start scale |

### blur-in *(filter-dependent)*
Reveal any block with blur + directional offset + fade (18f ease-out).

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| blur | `8` | start blur px |
| direction | `"up"` | up|down|left|right |
| distance | `12` | offset px |

### focus-blur-resolve *(filter-dependent)*
A block resolves from heavy defocus into crisp focus.

| prop | default | doc |
|---|---|---|
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| blur | `18` | start defocus px |
| durationFrames | `26` | resolve length |

## transition

### fade-through
One block fades away as the next fades through it — two-phase swap.

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

### shared-axis-y
Material shared-axis vertical swap — outgoing words lift away, incoming rise in, per-word staggers.

| prop | default | doc |
|---|---|---|
| from | `"Before state"` | outgoing text |
| to | `"After state"` | incoming text |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

### shared-axis-z
Material shared-axis depth swap — outgoing grows and fades, incoming settles from slightly small.

| prop | default | doc |
|---|---|---|
| from | `"Before state"` | outgoing text |
| to | `"After state"` | incoming text |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

### per-word-crossfade
Old words fade out as new words fade in, word by word.

| prop | default | doc |
|---|---|---|
| from | `"Old headline"` | outgoing |
| to | `"New headline"` | incoming |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

### whip-pan *(filter-dependent)*
Camera whips sideways: outgoing smears off, incoming smears in.

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `36` | whole transition length |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| direction | `"left"` | left|right|up|down |

### push-through *(filter-dependent)*
Zoom straight through the outgoing scene; the next resolves behind it.

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `36` | whole transition length |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| zoom | `2.4` | punch-through scale |

### ripple-zoom
Expanding rings wash the old scene out; the new one scales up through them.

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `36` | whole transition length |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| accent | `"#818cf8"` | ring color |

### focus-pull *(filter-dependent)*
Rack-focus swap — the old scene falls out of focus as the new one resolves.

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `36` | whole transition length |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |
| blur | `16` | max defocus px |

### wave-wipe
The next scene surges up with a soft overshoot as the old one lifts off.

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `36` | whole transition length |
| text | `"Ship it today"` | content to animate |
| fontSize | `72` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `600` | font weight |
| speed | `1` | playback multiplier |

### dither-dissolve
Dot-field cover sweeps between scenes. CSS approximation of the WebGL shader (envelope curves exact; run the true shader in the HyperFrames lane).

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `45` | transition length |
| fontSize | `72` | panel text px |
| color | `"#f4f4f5"` | panel text color |
| seed | `""` | texture seed |
| speed | `1` | playback multiplier |

### grain-dissolve
Grainy gradient cover washes between scenes. CSS approximation of the WebGL shader (envelope curves exact; run the true shader in the HyperFrames lane).

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `45` | transition length |
| fontSize | `72` | panel text px |
| color | `"#f4f4f5"` | panel text color |
| seed | `""` | texture seed |
| speed | `1` | playback multiplier |

### smoke-dissolve
Soft smoke plumes drift up between scenes. CSS approximation of the WebGL shader (envelope curves exact; run the true shader in the HyperFrames lane).

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `45` | transition length |
| fontSize | `72` | panel text px |
| color | `"#f4f4f5"` | panel text color |
| seed | `""` | texture seed |
| speed | `1` | playback multiplier |

### swirl-dissolve
Rotating vortex cover spins between scenes. CSS approximation of the WebGL shader (envelope curves exact; run the true shader in the HyperFrames lane).

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `45` | transition length |
| fontSize | `72` | panel text px |
| color | `"#f4f4f5"` | panel text color |
| seed | `""` | texture seed |
| speed | `1` | playback multiplier |

### warp-dissolve
Stretching warp bands sweep between scenes. CSS approximation of the WebGL shader (envelope curves exact; run the true shader in the HyperFrames lane).

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `45` | transition length |
| fontSize | `72` | panel text px |
| color | `"#f4f4f5"` | panel text color |
| seed | `""` | texture seed |
| speed | `1` | playback multiplier |

### perlin-dissolve
Slow organic noise field morphs between scenes. CSS approximation of the WebGL shader (envelope curves exact; run the true shader in the HyperFrames lane).

| prop | default | doc |
|---|---|---|
| from | `"Before"` | outgoing text |
| to | `"After"` | incoming text |
| durationFrames | `45` | transition length |
| fontSize | `72` | panel text px |
| color | `"#f4f4f5"` | panel text color |
| seed | `""` | texture seed |
| speed | `1` | playback multiplier |

## ui

### spinner
Continuous rotating arc — the loading motion atom.

| prop | default | doc |
|---|---|---|
| size | `20` | px |
| color | `"#f4f4f5"` | arc color |
| strokeWidth | `2.5` | ring thickness px |
| speed | `1` | playback multiplier |

### typing-indicator
Dots bobbing in a phased sine wave — chat 'typing…'.

| prop | default | doc |
|---|---|---|
| dotCount | `3` | dots |
| color | `"#a1a1aa"` | dot color |
| size | `8` | dot px |
| gap | `5` | px between dots |
| amplitude | `6` | bob px |
| cyclesPerSecond | `1.2` | wave speed |
| speed | `1` | playback multiplier |

### caret
Blinking text caret block.

| prop | default | doc |
|---|---|---|
| height | `40` | px |
| color | `"#f4f4f5"` | caret color |
| blinkSeconds | `1` | blink cycle |
| speed | `1` | playback multiplier |

### skeleton-block
Loading placeholder with a sweeping highlight band.

| prop | default | doc |
|---|---|---|
| width | `320` | px |
| height | `20` | px |
| radius | `6` | px |
| base | `"#26262e"` | base color |
| highlight | `"#3f3f49"` | band color |
| sweepSeconds | `1.4` | sweep cycle |
| speed | `1` | playback multiplier |

### button
shadcn-style button state atom with an optional press-in enter.

| prop | default | doc |
|---|---|---|
| label | `"Continue"` | button text |
| variant | `"default"` | default|secondary|destructive|outline|ghost |
| size | `"default"` | sm|default|lg |
| state | `"idle"` | idle|hover|press |
| enter | `true` | spring-scale enter animation |
| mode | `"dark"` | light|dark theme |

### input
Text field that types its value with a live caret.

| prop | default | doc |
|---|---|---|
| value | `"hello@example.com"` | typed text |
| placeholder | `""` | shown before typing (static) |
| size | `"default"` | sm|default|lg |
| charsPerSecond | `18` | typing speed |
| width | `320` | field px |
| mode | `"dark"` | light|dark theme |

### checkbox
Checkbox that pops its check on at a chosen time.

| prop | default | doc |
|---|---|---|
| label | `"Accept terms"` | label text |
| size | `"default"` | sm|default|lg |
| checkAtSeconds | `0.6` | when the check lands |
| mode | `"dark"` | light|dark theme |

### switch
Toggle that flips on at a chosen time — thumb slide + track tint.

| prop | default | doc |
|---|---|---|
| size | `"default"` | sm|default|lg |
| toggleAtSeconds | `0.6` | when it flips |
| label | `""` | optional label |
| mode | `"dark"` | light|dark theme |

### tabs
Segmented tabs whose pill indicator glides to the next tab.

| prop | default | doc |
|---|---|---|
| labels | `["Overview","Metrics","Logs"]` | tab labels |
| from | `0` | starting tab index |
| to | `1` | destination tab index |
| switchAtSeconds | `0.7` | when the indicator glides |
| width | `360` | px |
| mode | `"dark"` | light|dark theme |

### tooltip
Tooltip that pops in above its anchor.

| prop | default | doc |
|---|---|---|
| text | `"Copied!"` | tooltip text |
| anchor | `"Hover me"` | anchor label |
| showAtSeconds | `0.5` | when it appears |
| mode | `"dark"` | light|dark theme |

### toast
Notification card that slides up and settles.

| prop | default | doc |
|---|---|---|
| title | `"Deploy complete"` | headline |
| body | `"Production is live on v2.4.0"` | supporting line |
| width | `340` | px |
| mode | `"dark"` | light|dark theme |

### message-bubble
Chat bubble that pops in — sent or received styling.

| prop | default | doc |
|---|---|---|
| text | `"Hey! The new build is ready 🎉"` | message |
| side | `"left"` | left (received) | right (sent) |
| maxWidth | `380` | px |
| mode | `"dark"` | light|dark theme |

### skeleton
Card-shaped multi-line loading skeleton with sweeping bands.

| prop | default | doc |
|---|---|---|
| lines | `3` | text lines |
| width | `360` | px |
| mode | `"dark"` | light|dark theme |

### spotlight-card
Feature card with a soft radial spotlight glow.

| prop | default | doc |
|---|---|---|
| title | `"Deterministic renders"` | headline |
| body | `"Same input, same pixels — every time."` | supporting line |
| glowX | `30` | % from left |
| glowY | `0` | % from top |
| width | `380` | px |
| mode | `"dark"` | light|dark theme |

### dialog
Modal dialog entering over a dimming backdrop.

| prop | default | doc |
|---|---|---|
| title | `"Rename project"` | headline |
| body | `"Give this project a name your team will recognize."` | copy |
| confirm | `"Save changes"` | primary label |
| cancel | `"Cancel"` | ghost label |
| mode | `"dark"` | light|dark theme |

### alert-dialog
Destructive confirmation dialog.

| prop | default | doc |
|---|---|---|
| title | `"Delete workspace?"` | headline |
| body | `"This permanently removes the workspace and all takes."` | copy |
| confirm | `"Delete"` | destructive label |
| cancel | `"Keep it"` | ghost label |
| mode | `"dark"` | light|dark theme |

### drawer
Bottom drawer sliding up over a dimmed backdrop.

| prop | default | doc |
|---|---|---|
| title | `"Filters"` | headline |
| body | `"Refine the take list by deck, status, and date."` | copy |
| mode | `"dark"` | light|dark theme |

### sheet
Right-side sheet sliding in over a dimmed backdrop.

| prop | default | doc |
|---|---|---|
| title | `"Take details"` | headline |
| body | `"Duration, events, anchors, and export lanes for this take."` | copy |
| mode | `"dark"` | light|dark theme |

### popover
Anchored popover card popping in below its trigger.

| prop | default | doc |
|---|---|---|
| trigger | `"Share"` | trigger label |
| title | `"Share this take"` | popover headline |
| body | `"Anyone with the link can watch the render."` | copy |
| width | `288` | popover px (source default) |
| mode | `"dark"` | light|dark theme |

### progress
Progress bar filling to a target percentage.

| prop | default | doc |
|---|---|---|
| value | `72` | target % |
| width | `320` | px |
| fillFrames | `24` | fill length |
| mode | `"dark"` | light|dark theme |

### progress-steps
Segmented progress — steps fill in sequence.

| prop | default | doc |
|---|---|---|
| steps | `4` | segments |
| completed | `3` | how many fill |
| width | `340` | px |
| mode | `"dark"` | light|dark theme |

### radio
Radio group whose selection dot pops in.

| prop | default | doc |
|---|---|---|
| options | `["Draft","Lossless","Delivery"]` | labels |
| selected | `1` | which pops |
| selectAtSeconds | `0.6` | when |
| mode | `"dark"` | light|dark theme |

### slider
Slider whose thumb glides to its value.

| prop | default | doc |
|---|---|---|
| value | `65` | target % |
| width | `320` | px |
| mode | `"dark"` | light|dark theme |

### stepper
Numeric stepper counting up through its values.

| prop | default | doc |
|---|---|---|
| fromValue | `1` | start |
| toValue | `4` | end |
| stepSeconds | `0.5` | per increment |
| mode | `"dark"` | light|dark theme |

### toggle-group
Segment group whose active pill hops to a new segment.

| prop | default | doc |
|---|---|---|
| labels | `["16:9","9:16","1:1"]` | segments |
| from | `0` | start index |
| to | `2` | end index |
| switchAtSeconds | `0.7` | when |
| mode | `"dark"` | light|dark theme |

### accordion
Accordion item expanding to reveal its content.

| prop | default | doc |
|---|---|---|
| question | `"Is every render deterministic?"` | header |
| answer | `"Yes — same take, same pixels. The CSS clock is stepped per frame, so re-renders are byte-identical."` | content |
| openAtSeconds | `0.5` | when it opens |
| mode | `"dark"` | light|dark theme |

### dropdown-menu
Menu panel popping from a trigger with a cascading item reveal and a highlighted row.

| prop | default | doc |
|---|---|---|
| trigger | `"Options"` | trigger label |
| items | `["Duplicate","Rename","Move to…","Delete"]` | rows |
| highlight | `1` | row that highlights |
| mode | `"dark"` | light|dark theme |

### context-menu
Right-click menu popping at a cursor position.

| prop | default | doc |
|---|---|---|
| items | `["Reveal in Finder","Add context note","Copy path"]` | rows |
| mode | `"dark"` | light|dark theme |

### command-menu
⌘K palette — query types in, results cascade, one row highlights.

| prop | default | doc |
|---|---|---|
| query | `"render"` | typed query |
| items | `["Render take (wavelet)","Render take (ffmpeg)","Open render folder"]` | results |
| highlight | `0` | highlighted row |
| mode | `"dark"` | light|dark theme |

### combobox
Searchable select — panel opens, options cascade, one gets the check.

| prop | default | doc |
|---|---|---|
| placeholder | `"Select deck…"` | field text |
| options | `["showcase","launch-teaser","weekly-update"]` | options |
| pick | `0` | picked option |
| mode | `"dark"` | light|dark theme |

### field
Label + input + helper text form row.

| prop | default | doc |
|---|---|---|
| label | `"Project name"` | label |
| value | `"wavelet-ui"` | field value |
| help | `"Lowercase, dashes allowed."` | helper line |
| mode | `"dark"` | light|dark theme |

### simulated-cursor
Cursor glides along a curve, clicks (scale dip), and fires a ripple.

| prop | default | doc |
|---|---|---|
| fromX | `200` | start x px |
| fromY | `480` | start y px |
| toX | `760` | click x px |
| toY | `300` | click y px |
| glideSeconds | `1.1` | travel time |
| size | `22` | cursor px |

### animated-bar-chart
Bars grow from the baseline in a stagger.

| prop | default | doc |
|---|---|---|
| data | `[35,60,45,80,55,70,90,65]` | values |
| width | `1000` | px |
| height | `500` | px |
| barColor | `"#0ea5e9"` | bar fill |
| gap | `16` | px between bars |
| staggerFrames | `6` | frames between bars |
| speed | `1` | playback multiplier |

### animated-line-chart
Line chart drawing itself point to point with a leading dot.

| prop | default | doc |
|---|---|---|
| data | `[12,19,8,15,22,18,28,25,32]` | values |
| width | `1000` | px |
| height | `500` | px |
| strokeColor | `"#22c55e"` | line |
| strokeWidth | `4` | px |
| gridColor | `"#27272a"` | grid lines |
| speed | `1` | playback multiplier |

## background

### infinite-marquee
Seamless looping text band (duplicated track, linear drift).

| prop | default | doc |
|---|---|---|
| text | `"ship · build · animate · "` | repeated segment |
| fontSize | `120` | px |
| color | `"#f4f4f5"` | text color |
| fontWeight | `900` | weight |
| pixelsPerFrame | `4` | drift speed |
| speed | `1` | playback multiplier |

### dynamic-grid
Slow-drifting line grid backdrop.

| prop | default | doc |
|---|---|---|
| cellSize | `40` | px |
| lineColor | `"#27272a"` | grid lines |
| background | `"#0a0a0a"` | backdrop |
| speed | `0.5` | px per frame drift |
| direction | `"diagonal"` | diagonal|horizontal|vertical |
| viewport | `[1280,800]` | [w,h] line coverage |

### backdrop
Rounded padded frame around content — the demo-video stage mat.

| prop | default | doc |
|---|---|---|
| padding | `4` | % of width |
| radius | `1` | % of width |
| outer | `"#050508"` | mat color |
| inner | `"#101018"` | stage color |
| label | `"Your app here"` | placeholder content |

### mesh-gradient-bg *(filter-dependent)*
Slow-breathing mesh of blurred color blobs.

| prop | default | doc |
|---|---|---|
| colors | `["#6366f1","#a855f7","#0ea5e9"]` | blob colors |
| background | `"#0a0a12"` | backdrop |
| blur | `80` | blob blur px |

### confetti
Celebration burst — seeded ballistic particles, fully deterministic.

| prop | default | doc |
|---|---|---|
| count | `36` | particles |
| originX | `50` | % from left |
| originY | `60` | % from top |
| seed | `"party"` | burst seed |
| durationSeconds | `2.2` | burst length |

## scene

### terminal-simulator
Terminal window: command types in, output lines land.

| prop | default | doc |
|---|---|---|
| command | `"reactable takes render take-01 --engine wavelet"` | typed command |
| output | `["rendered 240 frames in 1.02s","encoded out/wavelet.mp4","✓ done"]` | result lines |
| title | `"reactable — zsh"` | window title |
| charsPerSecond | `28` | typing speed |

### terminal-cursor-zoom
Terminal types a command while the camera zooms toward the caret (zoom 2.8, source constants).

| prop | default | doc |
|---|---|---|
| command | `"npx shadcn add @remocn/terminal-cursor-zoom"` | typed command |
| zoom | `2.8` | punch-in scale |
| title | `"terminal"` | window title |

### glass-code-block *(filter-dependent)*
Frosted glass code card with line-by-line reveal.

| prop | default | doc |
|---|---|---|
| lines | `["const take = await record(deck);","const comp = compile(take);","await render(comp, { lossless: true });"]` | code lines |
| accent | `"#818cf8"` | keyword tint |

### glass-code-walk *(filter-dependent)*
Camera walks down a glass code card line by line.

| prop | default | doc |
|---|---|---|
| lines | `["deck showcase {","  slide prose {","    # Authored in .work","  }","}","","render --lossless"]` | code lines |

### chat-flow
Generic chat conversation — typing dots, bubble cascade.

| prop | default | doc |
|---|---|---|
| messages | `null` | [{side:'in'|'out', text}] — null = skin demo script |

### imessage-chat-flow
iMessage-styled phone conversation.

| prop | default | doc |
|---|---|---|
| messages | `null` | [{side:'in'|'out', text}] — null = skin demo script |

### telegram-chat-flow
Telegram-styled phone conversation.

| prop | default | doc |
|---|---|---|
| messages | `null` | [{side:'in'|'out', text}] — null = skin demo script |

### claude-chat
Claude-styled assistant exchange.

| prop | default | doc |
|---|---|---|
| messages | `null` | [{side:'in'|'out', text}] — null = skin demo script |

### chat-gpt
ChatGPT-styled assistant exchange.

| prop | default | doc |
|---|---|---|
| messages | `null` | [{side:'in'|'out', text}] — null = skin demo script |

### claude-code
Claude Code terminal session — prompt, tool call, diff-ish output.

| prop | default | doc |
|---|---|---|
| prompt | `"add a --lossless flag to the render verb"` | user ask |
| steps | `["● Reading tools/src/wavelet.rs","● Editing wavelet.rs — qp 0 + yuv444p lane","✓ Built. 72f@1080p30 in 297ms"]` | agent lines |

### opencode
OpenCode TUI session panel.

| prop | default | doc |
|---|---|---|
| prompt | `"port the registry build to bun"` | user ask |
| steps | `["bash · bun registry/build.ts","edit · package.json","done · 2 files changed"]` | tool lines |

### v0
v0-style prompt → generating → preview card swap.

| prop | default | doc |
|---|---|---|
| prompt | `"a pricing page with three tiers"` | typed prompt |

