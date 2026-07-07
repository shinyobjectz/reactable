import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEvents, readTakeManifest } from "./take.ts";
import { takePath } from "./paths.ts";
import { trackOffsets } from "./speech.ts";

export function hfDir(id: string, root?: string) {
  return join(takePath(id, root), "hyperframes");
}

export function scaffoldHyperframes(id: string, root?: string) {
  const takeDir = takePath(id, root);
  if (!existsSync(takeDir)) throw new Error(`no such take: ${id}`);

  const out = hfDir(id, root);
  const comps = join(out, "compositions");
  mkdirSync(comps, { recursive: true });

  const manifest = readTakeManifest(id, root);
  const events = readEvents(id, root);
  const slides = events.filter((e: { type: string }) => e.type === "slide");
  const duration =
    events.reduce((m: number, e: { t?: number }) => Math.max(m, e.t || 0), 0) + 2;

  const media = ["stage.mov", "cam.mov", "mic-clean.wav", "mic.wav"];
  for (const f of media) {
    const src = join(takeDir, f);
    const dst = join(out, "media", f);
    if (existsSync(src)) {
      mkdirSync(join(out, "media"), { recursive: true });
      try {
        symlinkSync(src, dst);
      } catch {
        // already linked
      }
    }
  }
  const captionsSrc = join(takeDir, "out", "captions.vtt");
  if (existsSync(captionsSrc)) {
    mkdirSync(join(out, "media"), { recursive: true });
    try {
      symlinkSync(captionsSrc, join(out, "media", "captions.vtt"));
    } catch {}
  }

  // Sync anchors from events.jsonl — every track's true first-media time on
  // the take clock. Offsets below shift cam/mic onto the stage clock.
  const offsets = trackOffsets(id);
  const tStage = offsets.stage ?? 0;
  const camDelay = Math.max(0, (offsets.cam ?? tStage) - tStage);
  const micDelay = Math.max(0, (offsets.mic ?? tStage) - tStage);
  const micFile = existsSync(join(takeDir, "mic-clean.wav"))
    ? "mic-clean.wav"
    : existsSync(join(takeDir, "mic.wav"))
      ? "mic.wav"
      : null;

  // Marker times shift onto the stage-file clock (slide events are take-clock;
  // stage.mov's first frame is tStage on that clock).
  const markers = slides
    .map((s: { t?: number; id?: string; idx?: number }) => ({
      t: s.t != null ? Math.max(0, s.t - tStage) : s.t,
      id: s.id,
      idx: s.idx,
    }))
    .filter((s: { t?: number }) => s.t != null);

  // Stage-aligned word timings (transcript.json words are already shifted
  // onto the stage clock by transcribeTake).
  let words: unknown[] = [];
  const transcriptPath = join(takeDir, "transcript.json");
  if (existsSync(transcriptPath)) {
    try {
      words = JSON.parse(readFileSync(transcriptPath, "utf8")).words ?? [];
    } catch {}
  }

  // Cursor track + clicks, normalized 0..1 within the captured region via
  // capture_window (global points → capture-relative), on the stage clock.
  const win = (manifest as Record<string, any>).capture_window;
  const normPoint = (x: number, y: number) =>
    win
      ? { x: (x - win.x) / win.w, y: (y - win.yTop) / win.h }
      : { x: 0.5, y: 0.5 };
  const cursorTrack: { t: number; x: number; y: number }[] = [];
  const clickTrack: { t: number; x: number; y: number }[] = [];
  for (const e of events as { type?: string; t?: number; x?: number; y?: number }[]) {
    if (e.t == null || e.x == null || e.y == null) continue;
    const t = Math.max(0, e.t - tStage);
    if (e.type === "cursor") cursorTrack.push({ t, ...normPoint(e.x, e.y) });
    if (e.type === "click") clickTrack.push({ t, ...normPoint(e.x, e.y) });
  }
  // Keep the composition light — ~10 cursor samples/sec is smooth with tweens.
  const cursor = cursorTrack.filter(
    (s, i, arr) => i === 0 || s.t - arr[i - 1].t >= 0.1,
  );

  writeFileSync(
    join(out, "reactable-events.json"),
    JSON.stringify(
      { take: id, deck: manifest.deck, sync: { stage: 0, cam: camDelay, mic: micDelay }, markers, words, events },
      null,
      2,
    ),
  );

  writeFileSync(
    join(out, "hyperframes.json"),
    JSON.stringify(
      {
        name: `reactable-${id}`,
        description: "HyperFrames edit lane for a Reactable take",
        source: "reactable-cli take hf init",
      },
      null,
      2,
    ),
  );

  const composition = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Reactable take — ${id}</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { background: #0e0e12; color: #f2f2f2; font: 14px/1.4 ui-monospace, monospace; }
    .scene-content { width: 100%; height: 100%; position: relative; overflow: hidden; }
    #stage-vid { width: 100%; height: 100%; object-fit: contain; background: #000; }
    #cam-pip {
      position: absolute; right: 3%; top: 6%; width: 18%; border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,.45); object-fit: cover;
    }
    .marker { position: absolute; left: 12px; bottom: 12px; padding: 6px 10px;
      background: rgba(0,0,0,.55); border-radius: 8px; }
    .caption { position: absolute; left: 50%; bottom: 7%; transform: translateX(-50%);
      font: 600 28px/1.2 ui-sans-serif, system-ui, sans-serif; color: #fff;
      text-shadow: 0 2px 12px rgba(0,0,0,.8); }
    /* Screen-Studio-style cursor: soft halo that follows the recorded cursor. */
    #cursor { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px;
      border-radius: 50%; background: rgba(255,255,255,.25);
      border: 2px solid rgba(255,255,255,.85); box-shadow: 0 2px 14px rgba(0,0,0,.5);
      pointer-events: none; opacity: 0; }
    .ripple { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px;
      border-radius: 50%; border: 2px solid #fff; pointer-events: none; }
  </style>
</head>
<body>
  <div data-composition-id="reactable-take" data-duration="${duration.toFixed(2)}">
    <section class="scene" data-scene-id="main" data-start="0" data-duration="${duration.toFixed(2)}">
      <div class="scene-content">
        <video id="stage-vid" data-start="0" data-track="video" src="../media/stage.mov" muted playsinline></video>
        <video id="cam-pip" data-start="${camDelay.toFixed(3)}" data-track="video" src="../media/cam.mov" muted playsinline></video>${
          micFile
            ? `\n        <audio id="voice" data-start="${micDelay.toFixed(3)}" data-track="audio" src="../media/${micFile}"></audio>`
            : ""
        }
        <div class="marker" id="slide-marker" data-start="0">slide —</div>
        <div class="caption" id="caption" data-start="0"></div>
        <div id="cursor"></div>
      </div>
    </section>
  </div>
  <script>
    // markers/words/cursor are STAGE-clock times; cam/mic elements carry their
    // sync offsets in data-start (from events.jsonl first-media anchors).
    const markers = ${JSON.stringify(markers)};
    const words = ${JSON.stringify(words)};
    const cursor = ${JSON.stringify(cursor)};
    const clicks = ${JSON.stringify(clickTrack)};
    const tl = gsap.timeline({ paused: true });
    const label = document.getElementById('slide-marker');
    markers.forEach((m) => {
      tl.call(() => { label.textContent = 'slide ' + (m.id || m.idx) + ' @ ' + m.t.toFixed(1) + 's'; }, null, m.t);
    });
    const cap = document.getElementById('caption');
    words.forEach((w) => {
      tl.call(() => { cap.textContent = w.word; }, null, w.start);
      tl.call(() => { if (cap.textContent === w.word) cap.textContent = ''; }, null, w.end);
    });
    // Superimposed cursor: tween through the recorded track (normalized 0..1
    // within the captured deck region).
    const cur = document.getElementById('cursor');
    const scene = document.querySelector('.scene-content');
    if (cursor.length) {
      tl.set(cur, { opacity: 1 }, cursor[0].t);
      cursor.forEach((s, i) => {
        const prev = cursor[i - 1];
        tl.to(cur, {
          left: (s.x * 100) + '%',
          top: (s.y * 100) + '%',
          duration: prev ? Math.max(0.01, s.t - prev.t) : 0.01,
          ease: 'power1.out',
        }, prev ? prev.t : s.t);
      });
    }
    clicks.forEach((c) => {
      tl.call(() => {
        const r = document.createElement('span');
        r.className = 'ripple';
        r.style.left = (c.x * 100) + '%';
        r.style.top = (c.y * 100) + '%';
        scene.appendChild(r);
        gsap.fromTo(r, { scale: 0.6, opacity: 0.9 }, {
          scale: 3.2, opacity: 0, duration: 0.55, ease: 'power2.out',
          onComplete: () => r.remove(),
        });
      }, null, c.t);
    });
    window.__reactableHF = { markers, words, cursor, clicks, timeline: tl };
  </script>
</body>
</html>`;

  writeFileSync(join(comps, "take-edit.html"), composition);

  writeFileSync(
    join(out, "index.html"),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${id} — HyperFrames</title>
  <script src="https://cdn.jsdelivr.net/npm/hyperframes@0.7.21/dist/hyperframes-player.global.js"></script>
</head>
<body>
  <hyperframes-player src="compositions/take-edit.html"></hyperframes-player>
</body>
</html>`,
  );

  writeFileSync(
    join(out, "README.md"),
    `# HyperFrames lane — ${id}

Agent-authored post edit for a Reactable take.

- **Source media**: symlinks in \`media/\` → take tracks
- **Event map**: \`reactable-events.json\` (slide/click clock from \`events.jsonl\`)
- **Composition**: \`compositions/take-edit.html\` — extend with HyperFrames \`data-*\` timing

## Commands

\`\`\`bash
reactable take hf init ${id}    # re-scaffold
npx hyperframes lint .
npx hyperframes preview
npx hyperframes render --output ../out/hyperframes-final.mp4
reactable take hf render ${id}
\`\`\`

Load the \`hyperframes\` and \`hyperframes-cli\` skills before editing HTML.
`,
  );

  return out;
}
