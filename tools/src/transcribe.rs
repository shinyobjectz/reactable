use crate::ffmpeg_util;
use crate::mlx_stt;
use std::path::PathBuf;

pub fn run(input: &str, model: &str, output: Option<&str>) -> i32 {
    let out_path = output
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(input).with_extension("transcript.json"));

    // Ensure WAV for video inputs via ffmpeg extract
    let audio = if input.ends_with(".wav") {
        input.to_string()
    } else {
        let wav = out_path.with_extension("wav");
        let code = ffmpeg_util::extract_audio(input, wav.to_str().unwrap_or("audio.wav"));
        if code != 0 {
            return code;
        }
        wav.display().to_string()
    };

    mlx_stt::transcribe_file(&audio, out_path.to_str().unwrap_or("transcript.json"), model)
}

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;

#[derive(Serialize, Deserialize)]
struct Word {
    word: String,
    start: f64,
    end: f64,
}

#[derive(Serialize, Deserialize)]
struct Transcript {
    engine: String,
    text: String,
    words: Vec<Word>,
}

pub fn remove_filler(transcript_path: &str, output: Option<&str>, aggressive: bool) -> i32 {
    let body = match fs::read_to_string(transcript_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("read transcript: {e}");
            return 1;
        }
    };
    let t: Transcript = match serde_json::from_str(&body) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("parse transcript: {e}");
            return 1;
        }
    };

    let fillers = if aggressive {
        vec!["um", "uh", "er", "ah", "like", "you know", "sort of", "kind of"]
    } else {
        vec!["um", "uh", "er", "ah"]
    };

    let mut cuts = Vec::new();
    for w in &t.words {
        let norm = w.word.to_lowercase();
        let norm = norm.trim_matches(|c: char| !c.is_alphanumeric());
        if fillers.iter().any(|f| norm == *f) {
            cuts.push(json!({
                "start": w.start,
                "end": w.end,
                "word": w.word,
                "reason": "filler"
            }));
        }
    }

    let out = output
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(transcript_path).with_extension("filler-cuts.json"));

    let report = json!({
        "ok": true,
        "cuts": cuts,
        "removed": cuts.len(),
        "engine": t.engine
    });

    if let Err(e) = fs::write(&out, serde_json::to_string_pretty(&report).unwrap()) {
        eprintln!("write cuts: {e}");
        return 1;
    }
    println!("{}", serde_json::to_string(&report).unwrap());
    0
}
