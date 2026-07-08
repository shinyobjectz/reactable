# gen-media — when to generate, when to edit, when the pipeline already wins

The decision layer for the `videogen` connector (omni-flash / veo-3 /
veo-3-fast) and image generation (FAL connector today; nano-banana routing
planned). Generation is the EXPENSIVE last resort — the studio's
deterministic pipeline does most jobs free, exactly, and re-renderable.

## The decision tree (walk it in order)

1. **Is it text, timing, zoom, layout, or emphasis on real footage?**
   → PIPELINE, never generation. Captions (`reactable edit captions`),
   auto-zoom/cursor (`takes render`), callouts/lower-thirds/title cards
   (client islands + [[slide-motion]]), speed/trim/filler
   (`edit remove-filler|trim-silence`). These are OCR/keyframe-exact and
   free; a model will misspell, drift, and cost credits.
2. **Is it a graphic, thumbnail, diagram, or still?**
   → IMAGE lane: FAL connector now (see skill/connectors/fal reference in
   the prompt appendix); nano-banana models when routed. Never ask a VIDEO
   model for a still.
3. **Is it altering the CONTENT of real footage?** (background swap,
   object removal/addition, weather, relight, sky, "make the mirror
   ripple") → **omni-flash EDIT** — the only tool that does this. ≤10s
   segments; edit the segment, composite back via [[takes-post]].
4. **Is it net-new footage that doesn't exist?** (b-roll, establishing
   shots, product-in-scene) → **veo-3-fast by default** (150cr/s),
   **veo-3 only for hero shots** the audience will linger on (400cr/s).
5. **Is it really a COMPOSITE?** Most "can you make the video do X" asks
   decompose: generate one element (a 4s loop, a still) + assemble in the
   pipeline (island overlay, HF layer, PIP). Composites are cheaper,
   editable later, and keep the real footage real.

Budget etiquette: the approval widget guards every generation; still ask
before chains >500cr total, generate SHORT (4–6s) and extend only if the
take needs it, and reuse — a generated clip in assets/ is free forever.

## Prompting Veo (3 / 3.1 / fast) — the five-part formula

`[Cinematography] + [Subject] + [Action] + [Context] + [Style & Audio]`
Lead with the camera, one scene per prompt, one subject per shot, concrete
verbs, state duration + aspect up front.

- Camera: dolly / tracking / crane / aerial / POV / macro; for stillness
  SAY IT: "locked tripod shot, no camera movement" (missing stability cue
  = drift).
- Audio is promptable: dialogue with a COLON, never quotes —
  `The barista says: welcome back` (quotation marks get RENDERED as
  burned-in subtitles — the classic anti-pattern). `SFX: espresso machine
  hiss.` `Ambient noise: quiet morning café.` Add `(no subtitles)` when
  dialogue matters.
- Negatives as a concrete list: "no logos, no on-screen text, no crowds" —
  and prefer positive phrasing ("empty desolate highway" over "no cars").
- Dialogue budget ≈ 8 seconds of speech; write what fits.
- Consistency across shots: reference images ("ingredients") or
  first/last-frame anchoring; transcribe a good implicit line and reuse it
  explicitly in later shots.

Anti-patterns: chatbot phrasing ("please create a nice video of…"), multi-
scene prompts, vague verbs ("experiences a moment"), quoting dialogue,
forgetting aspect ratio (pick 16:9/9:16 BEFORE generating, don't crop).

## Prompting Omni Flash (generate + EDIT)

Generation: same five-part formula, ≤10s, conversational refinement works —
iterate on the same interaction rather than re-rolling from scratch.

EDITS are delta instructions with an explicit preservation clause:
`When the person touches the mirror, make it ripple like liquid — keep the
person, framing, lighting, and everything else unchanged.`
- One delta per edit pass; chain passes for compound changes.
- Name what must NOT change (the preservation list) — models preserve what
  you name and drift on what you don't.
- Feed the SOURCE segment (videoUrl), not the whole take: cut the ≤10s
  window first (`ffmpeg -ss … -t …`), edit, splice back.

## Prompting images (nano-banana family, when routed; FAL today)

From the vendored skills (skill/vendored/nano-banana-image-skill,
nano-banana-prompt-generator): narrative prompts over keyword soup; model
routing — flash-image for volume/iteration, pro-image for dense TEXT
rendering, layouts, and multi-character consistency (text in images is the
#1 reason to pick Pro); edit-preservation deltas exactly as above;
reference images with role assignment for continuity; brand consistency =
explicit hex codes + anti-instructions in every prompt.

## Wiring into the pipeline

Generated media lands in `assets/` (panel thumbnails it). B-roll enters a
deck as a `video` slide or an HF overlay layer. Edited segments splice via
[[takes-post]] lane 1. Always cite the generation in the take's notes
(model, seconds, credits) — renders must be reproducible.
