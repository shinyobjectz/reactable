#[cfg(target_os = "macos")]
use voice_tts::Array;
use std::path::Path;

#[cfg(target_os = "macos")]
pub fn speak(text: &str, output: &str, voice: &str, speed: f64) -> i32 {
    let result = (|| -> Result<(), String> {
        let mut model = voice_tts::load_model("prince-canuma/Kokoro-82M").map_err(|e| e.to_string())?;
        let voice_emb = voice_tts::load_voice(voice, None).map_err(|e| e.to_string())?;
        let chunks = voice_g2p::text_to_phoneme_chunks(text).map_err(|e| e.to_string())?;

        let mut samples: Vec<f32> = Vec::new();
        for phonemes in &chunks {
            let audio = voice_tts::generate(&mut model, phonemes, &voice_emb, speed as f32)
                .map_err(|e| e.to_string())?;
            audio.eval().map_err(|e| e.to_string())?;
            samples.extend_from_slice(audio.as_slice());
        }

        if let Some(parent) = Path::new(output).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let out = Array::from_slice(&samples, &[samples.len() as i32]);
        voice_tts::save_wav(&out, Path::new(output), 24000).map_err(|e| e.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            println!(
                "{{\"ok\":true,\"engine\":\"kokoro-mlx\",\"output\":\"{output}\",\"voice\":\"{voice}\"}}"
            );
            0
        }
        Err(e) => {
            eprintln!("kokoro-mlx failed: {e}");
            1
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn speak(_text: &str, _output: &str, _voice: &str, _speed: f64) -> i32 {
    eprintln!("reactable-tools: MLX TTS requires Apple Silicon macOS");
    1
}

pub fn available() -> bool {
    cfg!(target_os = "macos")
}
