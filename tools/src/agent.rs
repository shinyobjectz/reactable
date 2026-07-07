use crate::agent_llm::{self, ChatRequest};
use std::fs;
use std::path::Path;
use std::process::Command;

pub fn chat(input: &str, output: Option<&str>, model: Option<&str>) -> i32 {
    let body = match fs::read_to_string(input) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("read input: {e}");
            return 1;
        }
    };
    let req: ChatRequest = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("parse request: {e}");
            return 1;
        }
    };
    let model_id = model.map(|s| s.to_string()).unwrap_or_else(agent_llm::default_model);
    let resp = agent_llm::complete(&req, &model_id);
    let json = serde_json::to_string_pretty(&resp).unwrap_or_default();
    if let Some(out) = output {
        if let Some(parent) = Path::new(out).parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = fs::write(out, &json) {
            eprintln!("write output: {e}");
            return 1;
        }
    }
    println!("{json}");
    if resp.ok { 0 } else { 1 }
}

/// Offline status — never loads the model, never touches the network
/// (server probe is localhost only).
pub fn status() -> i32 {
    let model = agent_llm::default_model();
    let port = agent_llm::server_port();
    let uv = agent_llm::find_uv().is_some();
    let cached = agent_llm::model_cached(&model);
    let ready = agent_llm::server_ready(port, &model);

    let state = if ready {
        "server-ready"
    } else if cached && uv {
        "model-cached"
    } else if !uv {
        "uv-missing"
    } else {
        "needs-pull"
    };
    // ok = a chat will succeed without any download
    let ok = ready || (cached && uv);

    let hint = match state {
        "server-ready" => None,
        "model-cached" => Some("server spawns on first chat (cold load < ~30s)".to_string()),
        "uv-missing" => {
            Some("install uv: curl -LsSf https://astral.sh/uv/install.sh | sh".to_string())
        }
        _ => Some("run: reactable agent pull".to_string()),
    };

    let report = serde_json::json!({
        "ok": ok,
        "state": state,
        "engine": format!("mlx-lm/{model}"),
        "model": model,
        "port": port,
        "uv": uv,
        "model_cached": cached,
        "server_ready": ready,
        "hint": hint,
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    if ok { 0 } else { 1 }
}

/// Explicit model download with progress (the only agent path allowed to hit HF).
pub fn pull(model: Option<&str>) -> i32 {
    let model_id = model.map(|s| s.to_string()).unwrap_or_else(agent_llm::default_model);
    if agent_llm::model_cached(&model_id) {
        println!("already cached: {model_id}");
        return 0;
    }
    let Some(uv) = agent_llm::find_uv() else {
        eprintln!("uv not found — install: curl -LsSf https://astral.sh/uv/install.sh | sh");
        return 1;
    };
    eprintln!("pulling {model_id} (anon HF is throttled; a free HF_TOKEN speeds this up)");
    let status = Command::new(&uv)
        .args([
            "tool",
            "run",
            "--from",
            "huggingface_hub[cli]",
            "hf",
            "download",
            &model_id,
        ])
        .status();
    match status {
        Ok(s) if s.success() => {
            if agent_llm::model_cached(&model_id) {
                println!("cached: {model_id}");
                0
            } else {
                eprintln!("download finished but cache check failed");
                1
            }
        }
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("run hf download: {e}");
            1
        }
    }
}

/// Explicit server control: start (ensure) or stop.
pub fn serve(stop: bool) -> i32 {
    if stop {
        let killed = agent_llm::stop_server();
        println!("{}", serde_json::json!({"ok": true, "stopped": killed}));
        return 0;
    }
    let model = agent_llm::default_model();
    match agent_llm::ensure_server(&model) {
        Ok(port) => {
            println!(
                "{}",
                serde_json::json!({"ok": true, "port": port, "model": model})
            );
            0
        }
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}
