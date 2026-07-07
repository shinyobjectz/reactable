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
        "tier": agent_llm::current_tier(),
        "port": port,
        "uv": uv,
        "model_cached": cached,
        "server_ready": ready,
        // Gate: the agent chat needs at least one model downloaded.
        "any_model": agent_llm::any_model_present(),
        "recommended_tier": agent_llm::recommended_tier(),
        "hint": hint,
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    if ok { 0 } else { 1 }
}

/// Model catalog for the UI picker: the three tiers with size, min RAM, cached
/// state, plus the machine's hardware + recommended tier.
pub fn models() -> i32 {
    let ram = agent_llm::detect_ram_gb();
    let chip = agent_llm::detect_chip();
    let recommended = agent_llm::recommended_tier();
    let current = agent_llm::current_tier();

    let tiers: Vec<_> = agent_llm::TIERS
        .iter()
        .map(|t| {
            serde_json::json!({
                "tier": t.tier,
                "repo": t.repo,
                "label": t.label,
                "blurb": t.blurb,
                "size_bytes": t.size_bytes,
                "size_gb": format!("{:.1}", t.size_bytes as f64 / 1e9),
                "min_ram_gb": t.min_ram_gb,
                "cached": agent_llm::model_cached(t.repo),
                "recommended": t.tier == recommended,
                "current": t.tier == current,
                "fits": ram == 0 || ram >= t.min_ram_gb,
            })
        })
        .collect();

    let report = serde_json::json!({
        "ok": true,
        "hardware": { "ram_gb": ram, "chip": chip },
        "recommended_tier": recommended,
        "current_tier": current,
        "any_model": agent_llm::any_model_present(),
        "tiers": tiers,
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    0
}

/// Delete a downloaded model (local mirror + HF cache) to free space.
pub fn remove(name: &str) -> i32 {
    let repo = agent_llm::tier_by_name(name).map(|t| t.repo.to_string()).unwrap_or_else(|| name.to_string());
    match agent_llm::remove_model(&repo) {
        Ok(freed) => {
            println!(
                "{}",
                serde_json::json!({"ok": true, "removed": repo, "freed_gb": format!("{:.1}", freed as f64 / 1e9)})
            );
            0
        }
        Err(e) => {
            eprintln!("{}", serde_json::json!({"ok": false, "error": e}));
            1
        }
    }
}

/// Download a model — a `low|medium|high` tier or an explicit repo. Tries the
/// R2 mirror first (fast, no HF throttle), falls back to Hugging Face. Records
/// the chosen tier so it becomes the active model.
pub fn pull(model: Option<&str>) -> i32 {
    // Resolve the requested name → repo (+ remember the tier if it was one).
    let (repo, tier) = match model {
        Some(name) => match agent_llm::tier_by_name(name) {
            Some(t) => (t.repo.to_string(), Some(t.tier)),
            None => (name.to_string(), agent_llm::tier_for_repo(name).map(|t| t.tier)),
        },
        None => {
            let t = agent_llm::current_tier();
            (agent_llm::tier_by_name(t).unwrap().repo.to_string(), Some(t))
        }
    };

    if agent_llm::model_cached(&repo) {
        if let Some(t) = tier { let _ = agent_llm::set_tier(t); }
        println!("{}", serde_json::json!({"ok": true, "cached": repo, "note": "already downloaded"}));
        return 0;
    }

    // 1) R2 mirror (preferred).
    eprintln!("↓ {repo} — trying reactable.app mirror…");
    match agent_llm::pull_from_r2(&repo, true) {
        Ok(()) if agent_llm::model_cached(&repo) => {
            if let Some(t) = tier { let _ = agent_llm::set_tier(t); }
            println!("{}", serde_json::json!({"ok": true, "cached": repo, "via": "r2"}));
            return 0;
        }
        Ok(()) => {}
        Err(e) => eprintln!("  mirror unavailable ({e}); falling back to Hugging Face…"),
    }

    // 2) Hugging Face fallback.
    let Some(uv) = agent_llm::find_uv() else {
        eprintln!("uv not found — install: curl -LsSf https://astral.sh/uv/install.sh | sh");
        return 1;
    };
    eprintln!("↓ {repo} — Hugging Face (anon is throttled; a free HF_TOKEN speeds this up)");
    let status = Command::new(&uv)
        .args(["tool", "run", "--from", "huggingface_hub[cli]", "hf", "download", &repo])
        .status();
    match status {
        Ok(s) if s.success() && agent_llm::model_cached(&repo) => {
            if let Some(t) = tier { let _ = agent_llm::set_tier(t); }
            println!("{}", serde_json::json!({"ok": true, "cached": repo, "via": "hf"}));
            0
        }
        Ok(_) => {
            eprintln!("download finished but cache check failed");
            1
        }
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
