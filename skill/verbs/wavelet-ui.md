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

