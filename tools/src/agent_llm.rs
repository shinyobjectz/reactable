use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const MLX_LM_PIN: &str = "mlx-lm==0.31.3";
pub const TRANSFORMERS_PIN: &str = "transformers==5.0.0";
pub const PYTHON_PIN: &str = "3.12";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub system: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub max_tokens: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub ok: bool,
    pub text: String,
    pub engine: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn default_model() -> String {
    std::env::var("REACTABLE_AGENT_MODEL")
        .unwrap_or_else(|_| "mlx-community/gemma-4-e4b-it-4bit".into())
}

pub fn server_port() -> u16 {
    std::env::var("REACTABLE_AGENT_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8837)
}

fn agent_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let dir = Path::new(&home).join(".reactable").join("agent");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn hf_hub_dir() -> PathBuf {
    if let Ok(h) = std::env::var("HF_HOME") {
        return Path::new(&h).join("hub");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    Path::new(&home).join(".cache").join("huggingface").join("hub")
}

/// Offline check: model dir has a snapshot with config.json + at least one weight file.
pub fn model_cached(model: &str) -> bool {
    let repo_dir = hf_hub_dir().join(format!("models--{}", model.replace('/', "--")));
    let snapshots = repo_dir.join("snapshots");
    let Ok(entries) = fs::read_dir(&snapshots) else {
        return false;
    };
    for snap in entries.flatten() {
        let p = snap.path();
        if !p.join("config.json").exists() {
            continue;
        }
        if let Ok(files) = fs::read_dir(&p) {
            for f in files.flatten() {
                let name = f.file_name().to_string_lossy().to_string();
                if name.ends_with(".safetensors") {
                    return true;
                }
            }
        }
    }
    false
}

pub fn find_uv() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("REACTABLE_UV") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    for cand in [
        format!("{home}/.local/bin/uv"),
        "/opt/homebrew/bin/uv".into(),
        "/usr/local/bin/uv".into(),
    ] {
        let p = PathBuf::from(&cand);
        if p.exists() {
            return Some(p);
        }
    }
    which("uv")
}

fn which(bin: &str) -> Option<PathBuf> {
    let path = std::env::var("PATH").unwrap_or_default();
    for dir in path.split(':') {
        let p = Path::new(dir).join(bin);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn http_get(port: u16, path: &str, timeout: Duration) -> Option<String> {
    let url = format!("http://127.0.0.1:{port}{path}");
    let resp = ureq::get(&url).timeout(timeout).call().ok()?;
    resp.into_string().ok()
}

/// Model id the running server reports, if any.
pub fn server_model(port: u16) -> Option<String> {
    let body = http_get(port, "/v1/models", Duration::from_millis(800))?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    v["data"][0]["id"].as_str().map(|s| s.to_string())
}

pub fn server_ready(port: u16, model: &str) -> bool {
    match server_model(port) {
        // mlx_lm.server may report the resolved local path — accept either.
        Some(m) => m == model || m.ends_with(model) || model.ends_with(&m) || m.contains(model),
        None => false,
    }
}

fn read_pidfile() -> Option<i32> {
    fs::read_to_string(agent_dir().join("server.pid"))
        .ok()?
        .trim()
        .parse()
        .ok()
}

pub fn stop_server() -> bool {
    let mut killed = false;
    if let Some(pid) = read_pidfile() {
        unsafe {
            killed = libc_kill(pid) == 0;
        }
    }
    let _ = fs::remove_file(agent_dir().join("server.pid"));
    killed
}

unsafe fn libc_kill(pid: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    kill(pid, 15)
}

pub fn touch_last_used() {
    let _ = fs::write(
        agent_dir().join("last-used"),
        format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        ),
    );
}

/// Ensure mlx_lm.server is running with `model`. Never downloads: requires cached weights.
pub fn ensure_server(model: &str) -> Result<u16, String> {
    let port = server_port();
    if server_ready(port, model) {
        return Ok(port);
    }
    // Server up but serving a different model → replace it.
    if server_model(port).is_some() {
        stop_server();
        std::thread::sleep(Duration::from_millis(500));
    }
    if !model_cached(model) {
        return Err(format!(
            "model not cached: {model} — run: reactable agent pull"
        ));
    }
    let uv = find_uv().ok_or_else(|| {
        "uv not found — install: curl -LsSf https://astral.sh/uv/install.sh | sh".to_string()
    })?;

    let dir = agent_dir();
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("server.log"))
        .map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let child = Command::new(&uv)
        .args([
            "tool",
            "run",
            "--python",
            PYTHON_PIN,
            "--from",
            MLX_LM_PIN,
            "--with",
            TRANSFORMERS_PIN,
            "mlx_lm.server",
            "--model",
            model,
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .env("HF_HUB_OFFLINE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .process_group(0)
        .spawn()
        .map_err(|e| format!("spawn mlx_lm.server: {e}"))?;

    let pid = child.id() as i32;
    fs::write(dir.join("server.pid"), pid.to_string()).map_err(|e| e.to_string())?;
    touch_last_used();
    spawn_idle_watchdog(pid, &dir);

    // Cold budget: first run also resolves the uv env; local weights, no network.
    let deadline = Instant::now() + Duration::from_secs(240);
    while Instant::now() < deadline {
        // We own this spawn, so any responding server on the port is ours.
        if server_model(port).is_some() {
            // Fire a throwaway completion so Metal kernels compile and weights
            // fault in NOW — otherwise the user's first real turn eats ~3s.
            warmup(port, model);
            return Ok(port);
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(format!(
        "mlx_lm.server did not become ready in 240s — see {}",
        dir.join("server.log").display()
    ))
}

fn warmup(port: u16, model: &str) {
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "warmup"}],
        "max_tokens": 1,
        "stream": false,
        "chat_template_kwargs": {"enable_thinking": false},
    });
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");
    let _ = ureq::post(&url)
        .timeout(Duration::from_secs(60))
        .send_json(body);
}

fn spawn_idle_watchdog(pid: i32, dir: &Path) {
    let idle: u64 = std::env::var("REACTABLE_AGENT_IDLE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1800);
    if idle == 0 {
        return;
    }
    let last_used = dir.join("last-used").display().to_string();
    let script = format!(
        "while kill -0 {pid} 2>/dev/null; do \
           last=$(cat '{last_used}' 2>/dev/null || echo 0); \
           now=$(date +%s); \
           if [ $((now - last)) -gt {idle} ]; then kill {pid} 2>/dev/null; exit 0; fi; \
           sleep 60; \
         done"
    );
    let _ = Command::new("/bin/bash")
        .args(["-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn();
}

pub fn complete(req: &ChatRequest, model: &str) -> ChatResponse {
    let engine = format!("mlx-lm/{model}");
    let port = match ensure_server(model) {
        Ok(p) => p,
        Err(e) => {
            return ChatResponse {
                ok: false,
                text: String::new(),
                engine,
                error: Some(e),
            }
        }
    };
    touch_last_used();

    let mut messages: Vec<serde_json::Value> = Vec::new();
    if !req.system.is_empty() {
        messages.push(serde_json::json!({"role": "system", "content": req.system}));
    }
    for m in &req.messages {
        messages.push(serde_json::json!({"role": m.role, "content": m.content}));
    }
    // gemma-4 is a reasoning model; thinking off by default so short budgets
    // land in `content` (REACTABLE_AGENT_THINKING=1 re-enables).
    let thinking = std::env::var("REACTABLE_AGENT_THINKING").ok().as_deref() == Some("1");
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": req.max_tokens.unwrap_or(2048),
        "stream": false,
        "chat_template_kwargs": {"enable_thinking": thinking},
    });

    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");
    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(300))
        .send_json(body);

    match resp {
        Ok(r) => {
            let mut buf = String::new();
            if r.into_reader().take(4_000_000).read_to_string(&mut buf).is_err() {
                return ChatResponse {
                    ok: false,
                    text: String::new(),
                    engine,
                    error: Some("read response".into()),
                };
            }
            match serde_json::from_str::<serde_json::Value>(&buf) {
                Ok(v) => {
                    let text = v["choices"][0]["message"]["content"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    ChatResponse {
                        ok: true,
                        text,
                        engine,
                        error: None,
                    }
                }
                Err(e) => ChatResponse {
                    ok: false,
                    text: String::new(),
                    engine,
                    error: Some(format!("parse completion: {e}")),
                },
            }
        }
        Err(e) => ChatResponse {
            ok: false,
            text: String::new(),
            engine,
            error: Some(format!("server request: {e}")),
        },
    }
}
