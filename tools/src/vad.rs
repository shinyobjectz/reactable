use regex::Regex;
use serde_json::json;
use std::process::Command;

use crate::ffmpeg_util;

pub fn detect(input: &str, noise_db: &str, min_silence: &str) -> i32 {
    let Some(ff) = ffmpeg_util::resolve_ffmpeg() else {
        eprintln!("ffmpeg not found");
        return 127;
    };
    let filter = format!(
        "silencedetect=noise={noise_db}dB:d={min_silence}",
        noise_db = noise_db,
        min_silence = min_silence
    );
    let out = Command::new(&ff)
        .args(["-i", input, "-af", &filter, "-f", "null", "-"])
        .output();
    let Ok(out) = out else {
        return 1;
    };
    let stderr = String::from_utf8_lossy(&out.stderr);
    let start_re = Regex::new(r"silence_start:\s*([\d.]+)").unwrap();
    let end_re = Regex::new(r"silence_end:\s*([\d.]+)").unwrap();
    let mut regions = Vec::new();
    let starts: Vec<f64> = start_re
        .captures_iter(&stderr)
        .filter_map(|c| c.get(1)?.as_str().parse().ok())
        .collect();
    let ends: Vec<f64> = end_re
        .captures_iter(&stderr)
        .filter_map(|c| c.get(1)?.as_str().parse().ok())
        .collect();
    for (i, start) in starts.iter().enumerate() {
        if let Some(end) = ends.get(i) {
            regions.push(json!({"start": start, "end": end, "type": "silence"}));
        }
    }
    println!(
        "{}",
        json!({"ok": true, "regions": regions, "count": regions.len()})
    );
    0
}

pub fn trim_silence(input: &str, output: &str, noise_db: &str) -> i32 {
    let Some(ff) = ffmpeg_util::resolve_ffmpeg() else {
        return 127;
    };
    let filter = format!(
        "silenceremove=stop_periods=-1:stop_duration=0.3:stop_threshold={noise_db}dB",
        noise_db = noise_db
    );
    let status = Command::new(&ff)
        .args(["-y", "-i", input, "-af", &filter, output])
        .status();
    match status {
        Ok(s) if s.success() => {
            println!("{{\"ok\":true,\"output\":\"{output}\"}}");
            0
        }
        Ok(s) => s.code().unwrap_or(1),
        Err(_) => 1,
    }
}
