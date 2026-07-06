import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEvents, readTakeManifest } from "./take.ts";
import { takePath } from "./paths.ts";

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

  const media = ["stage.mov", "cam.mov"];
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

  const markers = slides
    .map((s: { t?: number; id?: string; idx?: number }) => ({
      t: s.t,
      id: s.id,
      idx: s.idx,
    }))
    .filter((s: { t?: number }) => s.t != null);

  writeFileSync(
    join(out, "reactable-events.json"),
    JSON.stringify({ take: id, deck: manifest.deck, markers, events }, null, 2),
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
  </style>
</head>
<body>
  <div data-composition-id="reactable-take" data-duration="${duration.toFixed(2)}">
    <section class="scene" data-scene-id="main" data-start="0" data-duration="${duration.toFixed(2)}">
      <div class="scene-content">
        <video id="stage-vid" data-start="0" data-track="video" src="../media/stage.mov" muted playsinline></video>
        <video id="cam-pip" data-start="0" data-track="video" src="../media/cam.mov" muted playsinline></video>
        <div class="marker" id="slide-marker" data-start="0">slide —</div>
      </div>
    </section>
  </div>
  <script>
    const markers = ${JSON.stringify(markers)};
    const tl = gsap.timeline({ paused: true });
    const label = document.getElementById('slide-marker');
    markers.forEach((m) => {
      tl.call(() => { label.textContent = 'slide ' + (m.id || m.idx) + ' @ ' + m.t.toFixed(1) + 's'; }, null, m.t);
    });
    window.__reactableHF = { markers, timeline: tl };
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
