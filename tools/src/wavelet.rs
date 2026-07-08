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
    font: Option<&str>,
) -> i32 {
    let font_bytes = match font {
        Some(p) => match std::fs::read(p) {
            Ok(b) => Some(b),
            Err(e) => {
                eprintln!("wavelet: cannot read font {p}: {e}");
                return 1;
            }
        },
        None => None,
    };
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
    let n = match wavelet_render_core::render_sequence_to_dir_font(comp_path, &frames_dir, fps, duration, w, h, font_bytes.as_deref()) {
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
