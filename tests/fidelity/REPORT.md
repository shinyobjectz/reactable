# Fidelity gate report

Generated 2026-07-08 · viewport 1280×800 · fonts normalized to bundled Geist on both engines

| comp | SSIM vs Chrome | threshold | deterministic | verdict |
|---|---|---|---|---|
| counters-list | 0.9917 | 0.95 | yes | pass |
| anim-steps | 0.9937 | 0.95 | yes | pass |
| layout-grid | 0.9889 | 0.985 | yes | pass |
| prose | 0.9679 | 0.95 | yes | pass |
| img-data-uri | 1.0000 | 0.95 | yes | pass |
| fixed-overlay | 0.9902 | 0.95 | yes | pass |
| text-styles | 0.9820 | 0.96 | yes | pass |
| pulse | 0.9825 | 0.96 | yes | pass |
| real-app-panel | 0.9965 | 0.93 | yes | pass |
| known-gap-multicol | 0.9422 | 0.95 | yes | pass |
| perf 72f@1080p30 | 305ms | ≤1500ms | — | pass |

Overall: **PASS**

Method: same normalized comp rendered by headless Chrome (browser truth) and
wavelet-render-core; SSIM via ffmpeg; determinism = sha256 over two full
wavelet renders; perf = wall clock for the standard 72-frame render.
