// wavelet: deterministic HTML-comp → video, rendered NATIVELY by wavelet-render-core
// (Blitz + Stylo + vello_cpu — the same crate that builds to wasm32-wasip1 for the
// parked nexus lane). CSS @keyframes are the timeline: each frame steps the Stylo
// clock to t = frame/fps, so re-renders are deterministic at any resolution/aspect.
// Frames encode via the bundled/system ffmpeg (crf18 delivery, or --lossless
// qp0+yuv444p master). PNG frames dir is the archival master when kept.

use crate::ffmpeg_util;
use std::path::Path;
use std::process::Command;

#[allow(clippy::too_many_arguments)]
pub fn render(
    comp: &str,
    output: &str,
    w: u32,
    h: u32,
    fps: u32,
    duration: f64,
    lossless: bool,
    keep_frames: bool,
    fonts: &[String],
) -> i32 {
    // Font chain: explicit --font args (priority order) → ~/.reactable/fonts/*
    // → a wide-coverage local system font if present (glyph rescue for chars
    // outside Geist, e.g. U+FF0B) → bundled Geist floor. Chain order = metrics
    // priority; later fonts only fill missing glyphs.
    let mut font_bytes: Vec<Vec<u8>> = Vec::new();
    // REACTABLE_FONT_CHAIN=bundled — skip discovery (deterministic across
    // machines: CI has no ~/.reactable/fonts or system rescue font)
    let discovery = std::env::var("REACTABLE_FONT_CHAIN").map(|v| v != "bundled").unwrap_or(true);
    for p in fonts {
        match std::fs::read(p) {
            Ok(b) => font_bytes.push(b),
            Err(e) => {
                eprintln!("wavelet: cannot read font {p}: {e}");
                return 1;
            }
        }
    }
    if discovery { if let Some(home) = std::env::var_os("HOME") {
        let dir = Path::new(&home).join(".reactable/fonts");
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let mut paths: Vec<_> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| matches!(p.extension().and_then(|e| e.to_str()), Some("ttf" | "otf")))
                .collect();
            paths.sort();
            for p in paths {
                if let Ok(b) = std::fs::read(&p) {
                    font_bytes.push(b);
                }
            }
        }
    }
    for rescue in ["/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "C:\\Windows\\Fonts\\arialuni.ttf"] {
        if let Ok(b) = std::fs::read(rescue) {
            font_bytes.push(b);
            break;
        }
    } }
    let comp_path = Path::new(comp);
    if !comp_path.exists() {
        eprintln!("wavelet: comp not found: {comp}");
        return 1;
    }

    let out_path = Path::new(output);
    let to_mp4 = output.ends_with(".mp4");

    // frames land in the output dir itself, or in <out>.frames/ next to the mp4
    let frames_dir = if to_mp4 {
        out_path.with_extension("frames")
    } else {
        out_path.to_path_buf()
    };

    if let Err(e) = std::fs::create_dir_all(&frames_dir) {
        eprintln!("wavelet: cannot create frames dir {}: {e}", frames_dir.display());
        return 1;
    }

    let started = std::time::Instant::now();
    let n = match {
        let mut chain: Vec<&[u8]> = font_bytes.iter().map(|b| b.as_slice()).collect();
        chain.push(wavelet_render_core::bundled_font());
        wavelet_render_core::render_sequence_to_dir_fonts(comp_path, &frames_dir, fps, duration, w, h, &chain)
    } {
        Ok(n) => n,
        Err(e) => {
            eprintln!("wavelet: render failed: {e}");
            return 1;
        }
    };
    let render_ms = started.elapsed().as_millis();
    eprintln!("wavelet: rendered {n} frames ({w}x{h}@{fps}fps, {duration}s) in {render_ms}ms -> {}", frames_dir.display());

    if !to_mp4 {
        println!("{}", frames_dir.display());
        return 0;
    }

    let Some(ffmpeg) = ffmpeg_util::resolve_ffmpeg() else {
        eprintln!("wavelet: ffmpeg not found (set REACTABLE_FFMPEG or install ffmpeg)");
        return 1;
    };

    let pattern = frames_dir.join("frame_%05d.png");
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-framerate".into(), fps.to_string(),
        "-i".into(), pattern.display().to_string(),
        // odd frame dimensions (e.g. a captured 1625px viewport) break yuv420p
        "-vf".into(), "pad=ceil(iw/2)*2:ceil(ih/2)*2".into(),
        "-c:v".into(), "libx264".into(),
    ];
    if lossless {
        // true-lossless master: qp 0 + full-chroma. Bigger files, exact pixels.
        args.extend(["-qp".into(), "0".into(), "-pix_fmt".into(), "yuv444p".into(), "-preset".into(), "fast".into()]);
    } else {
        args.extend(["-crf".into(), "18".into(), "-pix_fmt".into(), "yuv420p".into(), "-movflags".into(), "+faststart".into()]);
    }
    args.push(out_path.display().to_string());

    let enc_started = std::time::Instant::now();
    let status = Command::new(&ffmpeg).args(&args).status();
    match status {
        Ok(s) if s.success() => {
            eprintln!("wavelet: encoded {} in {}ms{}", out_path.display(), enc_started.elapsed().as_millis(), if lossless { " (lossless qp0/yuv444p)" } else { "" });
            if !keep_frames {
                let _ = std::fs::remove_dir_all(&frames_dir);
            }
            println!("{}", out_path.display());
            0
        }
        Ok(s) => {
            eprintln!("wavelet: ffmpeg exited with {s}");
            1
        }
        Err(e) => {
            eprintln!("wavelet: ffmpeg spawn failed: {e}");
            1
        }
    }
}
