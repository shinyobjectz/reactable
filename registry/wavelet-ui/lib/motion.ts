// wavelet-ui motion engine — turns Remocn-style motion specs (frames, bezier
// easings, staggers, springs) into deterministic CSS: dense @keyframes +
// animation-delay per split unit. Everything is 30fps frame-semantics like
// Remotion, emitted as seconds. No JS at render time — wavelet-safe.

export const FPS = 30;
export const sec = (frames: number, speed = 1) => +(frames / FPS / speed).toFixed(4);

export type Unit = "char" | "word" | "line" | "block";

export interface KF {
  at: number; // 0..1
  style: Record<string, string>;
  easing?: string; // easing leaving this stop
}

export interface Fragment {
  css: string;
  html: string;
}

let uid = 0;
export const freshId = (name: string) => `wl-${name}-${++uid}`;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Split text into animatable spans. Chars keep spaces via white-space:pre.
export function splitSpans(text: string, unit: Unit): string[] {
  // NBSP for char-mode spaces — blitz collapses lone-space inline-blocks
  if (unit === "char") return Array.from(text).map((c) => (c === " " ? "\u00A0" : c));
  if (unit === "word") return text.split(" ");
  if (unit === "line") return text.split("\n");
  return [text];
}

export function kfBlock(name: string, stops: KF[]): string {
  const body = stops
    .map((s) => {
      const decls = Object.entries(s.style).map(([k, v]) => `${k}:${v}`);
      if (s.easing) decls.push(`animation-timing-function:${s.easing}`);
      return `${(s.at * 100).toFixed(2)}% { ${decls.join("; ")} }`;
    })
    .join("\n  ");
  return `@keyframes ${name} {\n  ${body}\n}`;
}

// Remotion `spring({damping, stiffness, mass})` — closed-form damped harmonic
// oscillator sampled to keyframe stops (from=0 → to=1). Visual parity with
// Remotion's frame-integrated sim for the underdamped configs Remocn uses.
export function springStops(
  damping: number,
  stiffness: number,
  mass = 1,
  durationFrames = 30,
  samples = 24,
): { at: number; v: number }[] {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const out: { at: number; v: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const at = i / samples;
    const t = (at * durationFrames) / FPS;
    let v: number;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      v = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    } else {
      v = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    }
    out.push({ at, v });
  }
  out[out.length - 1].v = 1;
  return out;
}

// Interpolate a numeric channel across spring stops into keyframe styles.
export function springKF(
  channels: { prop: "opacity" | "transform" | "letter-spacing" | "filter"; render: (v: number) => string }[],
  damping: number,
  stiffness: number,
  durationFrames: number,
): KF[] {
  return springStops(damping, stiffness, 1, durationFrames).map(({ at, v }) => ({
    at,
    style: Object.fromEntries(channels.map((c) => [c.prop, c.render(v)])),
  }));
}

export interface StaggeredAnimSpec {
  name: string; // component slug — keyframe/class prefix
  unit: Unit;
  durationFrames: number;
  staggerFrames: number;
  easing: string; // cubic-bezier(...) — leaving-每-stop default
  stops: KF[]; // percentage-space; easing applied per stop unless overridden
  spanStyle?: string; // extra inline style per span
  wrapperStyle?: string; // style on the text wrapper
  holdFrames?: number; // extend total timeline so the settle is visible
}

// The uniform Remocn text-reveal shape: split → per-unit spans, each running
// ONE keyframe animation offset by `i * stagger` via animation-delay.
export function staggeredText(text: string, spec: StaggeredAnimSpec, speed = 1): Fragment {
  const id = freshId(spec.name);
  const spans = splitSpans(text, spec.unit);
  const stops = spec.stops.map((s) => ({ ...s, easing: s.easing ?? spec.easing }));
  const css = [
    kfBlock(id, stops),
    `.${id} > span { display:inline-block; white-space:pre; backface-visibility:hidden; animation:${id} ${sec(spec.durationFrames, speed)}s both; ${spec.spanStyle ?? ""} }`,
    `.${id} { ${spec.wrapperStyle ?? ""} }`,
  ].join("\n");
  const wordGap = spec.unit === "word" ? "margin-right:0.28em;" : "";
  const html =
    `<span class="${id}">` +
    spans
      .map((u, i) => {
        const delay = sec(i * spec.staggerFrames, speed);
        const gap = spec.unit === "word" && i < spans.length - 1 ? wordGap : "";
        return `<span style="animation-delay:${delay}s;${gap}">${escapeHtml(u)}</span>`;
      })
      .join("") +
    `</span>`;
  return { css, html };
}

// Standard Remocn stage wrapper: absolute-fill, centered, transparent.
export function centerFill(inner: Fragment, extra = ""): Fragment {
  return {
    css: inner.css,
    html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;${extra}">${inner.html}</div>`,
  };
}

// Full standalone demo page (dark stage) around a fragment — used for gate
// comps and previews. duration hint = seconds the comp needs to settle.
export function demoPage(frag: Fragment, opts: { bg?: string; title?: string } = {}): string {
  return `<!doctype html>
<!-- generated by wavelet-ui — ${opts.title ?? "demo"} (ported from Remocn) -->
<html><head><style>
  html, body { margin:0; width:100%; height:100%; background:${opts.bg ?? "#0c0c12"}; overflow:hidden; }
  ${frag.css}
</style></head>
<body>
${frag.html}
</body></html>
`;
}
