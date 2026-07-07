use std::path::PathBuf;
use std::process::{Command, Stdio};

pub fn resolve_ffmpeg() -> Option<String> {
    if let Ok(p) = std::env::var("REACTABLE_FFMPEG") {
        if !p.is_empty() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let bundled = exe.parent()?.join("ffmpeg");
        if bundled.exists() {
            return bundled.to_str().map(|s| s.to_string());
        }
    }
    which("ffmpeg")
}

fn which(cmd: &str) -> Option<String> {
    let out = Command::new("which").arg(cmd).output().ok()?;
    if out.status.success() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            return Some(p);
        }
    }
    None
}

pub fn passthrough(args: &[String]) -> i32 {
    let Some(ff) = resolve_ffmpeg() else {
        eprintln!("reactable-tools: ffmpeg not found");
        return 127;
    };
    let status = Command::new(&ff)
        .args(args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();
    match status {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("reactable-tools: ffmpeg exec failed: {e}");
            1
        }
    }
}

pub fn extract_audio(input: &str, output: &str) -> i32 {
    let Some(ff) = resolve_ffmpeg() else {
        eprintln!("reactable-tools: ffmpeg not found");
        return 127;
    };
    let out = PathBuf::from(output);
    if let Some(parent) = out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let status = Command::new(&ff)
        .args([
            "-y",
            "-i",
            input,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            output,
        ])
        .status();
    match status {
        Ok(s) if s.success() => {
            println!("{{\"ok\":true,\"output\":\"{output}\"}}");
            0
        }
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("extract-audio failed: {e}");
            1
        }
    }
}
