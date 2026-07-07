use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
struct Word {
    word: String,
    start: f64,
    end: f64,
}

#[derive(Serialize)]
struct Transcript {
    engine: String,
    text: String,
    words: Vec<Word>,
}

/// Moonshine degenerates (repetition loops) and truncates past its ~200-token
/// generate cap when fed whole takes, so long audio is transcribed in fixed
/// windows and words get linearly-interpolated timestamps within each window.
#[cfg(target_os = "macos")]
const CHUNK_SECONDS: f64 = 20.0;

#[cfg(target_os = "macos")]
fn decode_to_f32_16k(input: &str) -> Result<Vec<f32>, String> {
    let ff = crate::ffmpeg_util::resolve_ffmpeg().ok_or("ffmpeg not found")?;
    let tmp = std::env::temp_dir().join(format!("reactable-stt-{}.f32", std::process::id()));
    let tmp_str = tmp.to_string_lossy().to_string();
    let out = std::process::Command::new(&ff)
        .args([
            "-y", "-loglevel", "error", "-i", input,
            "-ac", "1", "-ar", "16000", "-f", "f32le", "-acodec", "pcm_f32le", &tmp_str,
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    let bytes = std::fs::read(&tmp).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp);
    Ok(bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

#[cfg(target_os = "macos")]
pub fn transcribe_file(input: &str, output: &str, model: &str) -> i32 {
    let path = Path::new(input);
    if !path.exists() {
        eprintln!("transcribe: missing {input}");
        return 1;
    }

    let result = (|| -> Result<Transcript, String> {
        let samples = decode_to_f32_16k(input)?;
        let mut m = voice_stt::load_model(model).map_err(|e| e.to_string())?;

        let rate = 16000usize;
        let chunk_len = (CHUNK_SECONDS * rate as f64) as usize;
        let mut text = String::new();
        let mut words: Vec<Word> = Vec::new();

        for (i, chunk) in samples.chunks(chunk_len).enumerate() {
            let start_sec = (i * chunk_len) as f64 / rate as f64;
            let dur_sec = chunk.len() as f64 / rate as f64;
            // Skip windows with no signal — silence makes Moonshine hallucinate.
            let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();
            if rms < 0.003 {
                continue;
            }
            let r = voice_stt::transcribe_audio(&mut m, chunk, rate as u32)
                .map_err(|e| e.to_string())?;
            let chunk_text = r.text.trim().to_string();
            if chunk_text.is_empty() {
                continue;
            }
            let chunk_words: Vec<&str> = chunk_text.split_whitespace().collect();
            let per = dur_sec / chunk_words.len() as f64;
            for (wi, w) in chunk_words.iter().enumerate() {
                words.push(Word {
                    word: (*w).to_string(),
                    start: start_sec + wi as f64 * per,
                    end: start_sec + (wi as f64 + 1.0) * per,
                });
            }
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(&chunk_text);
        }

        Ok(Transcript {
            engine: format!("moonshine-mlx/{model} (chunked {CHUNK_SECONDS}s, approx word timing)"),
            text,
            words,
        })
    })();

    match result {
        Ok(t) => {
            if let Some(parent) = Path::new(output).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(output, serde_json::to_string_pretty(&t).unwrap()) {
                eprintln!("write transcript: {e}");
                return 1;
            }
            println!(
                "{{\"ok\":true,\"engine\":\"{}\",\"output\":\"{output}\",\"words\":{}}}",
                t.engine,
                t.words.len()
            );
            0
        }
        Err(e) => {
            eprintln!("moonshine-mlx failed: {e}");
            1
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn transcribe_file(_input: &str, _output: &str, _model: &str) -> i32 {
    eprintln!("reactable-tools: MLX STT requires Apple Silicon macOS");
    1
}

pub fn available() -> bool {
    cfg!(target_os = "macos")
}
