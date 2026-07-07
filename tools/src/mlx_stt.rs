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

#[cfg(target_os = "macos")]
pub fn transcribe_file(input: &str, output: &str, model: &str) -> i32 {
    let path = Path::new(input);
    if !path.exists() {
        eprintln!("transcribe: missing {input}");
        return 1;
    }

    let result = (|| -> voice_stt::Result<Transcript> {
        let mut m = voice_stt::load_model(model)?;
        let r = voice_stt::transcribe(&mut m, input)?;
        Ok(Transcript {
            engine: format!("moonshine-mlx/{model}"),
            text: r.text.clone(),
            words: vec![Word {
                word: r.text,
                start: 0.0,
                end: 0.0,
            }],
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
