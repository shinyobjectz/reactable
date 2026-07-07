use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn resolve_wb_data(base: Option<&str>) -> PathBuf {
    base.map(PathBuf::from)
        .or_else(|| std::env::var("WB_DATA").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn har_root(wb: &PathBuf, project: &str) -> PathBuf {
    wb.join(".reactable").join("har").join(project)
}

fn host_of(url: &str) -> String {
    url.split("//").nth(1).unwrap_or(url).split('/').next().unwrap_or("unknown").to_string()
}

pub fn capture(url: &str, project: &str, wb_data: Option<&str>) -> i32 {
    let root = resolve_wb_data(wb_data);
    let dir = har_root(&root, project);
    let _ = fs::create_dir_all(&dir);

    let out = Command::new("curl")
        .args(["-sSL", "-D", "-", url])
        .output();
    let Ok(out) = out else {
        eprintln!("curl failed");
        return 1;
    };
    if !out.status.success() {
        eprintln!("fetch failed: {}", out.status);
        return 1;
    }

    let raw = String::from_utf8_lossy(&out.stdout);
    let (headers, body) = raw.split_once("\r\n\r\n").unwrap_or(("", raw.as_ref()));

    let asset_re = Regex::new(r#"(?:href|src)=["']([^"']+)["']"#).unwrap();
    let mut assets: Vec<String> = asset_re
        .captures_iter(body)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
        .take(200)
        .collect();
    assets.sort();
    assets.dedup();

    let hash = hex::encode(Sha256::digest(url.as_bytes()))[..16].to_string();
    let host = host_of(url);
    let entry = json!({
        "id": hash,
        "url": url,
        "host": host,
        "capturedAt": chrono_now(),
        "headers": headers.lines().take(40).collect::<Vec<_>>(),
        "assets": assets,
        "bodyBytes": body.len(),
        "blitzHint": "POST /reactable/blitz/replay with {\"ref\": id, \"project\": project}"
    });

    let path = dir.join(format!("{hash}.json"));
    if let Err(e) = fs::write(&path, serde_json::to_string_pretty(&entry).unwrap()) {
        eprintln!("write har: {e}");
        return 1;
    }

    // Lightweight body ref (not full HTML — agent pulls via blitz replay)
    let body_ref = dir.join(format!("{hash}.body.html"));
    let _ = fs::write(&body_ref, body);

    append_index(&dir, &entry);
    println!("{}", json!({"ok": true, "id": hash, "path": path.display().to_string()}));
    0
}

fn append_index(dir: &PathBuf, entry: &Value) {
    let index_path = dir.join("index.json");
    let mut list: Vec<Value> = if index_path.exists() {
        fs::read_to_string(&index_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
    list.retain(|e| e.get("id").and_then(|v| v.as_str()) != Some(id));
    list.push(json!({
        "id": id,
        "url": entry.get("url"),
        "host": entry.get("host"),
        "capturedAt": entry.get("capturedAt"),
        "assets": entry.get("assets").and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0)
    }));
    let _ = fs::write(&index_path, serde_json::to_string_pretty(&list).unwrap());
}

pub fn list(project: &str, wb_data: Option<&str>) -> i32 {
    let root = resolve_wb_data(wb_data);
    let dir = har_root(&root, project);
    let index_path = dir.join("index.json");
    if !index_path.exists() {
        println!("{}", json!({"ok": true, "entries": [], "project": project}));
        return 0;
    }
    let body = fs::read_to_string(&index_path).unwrap_or_else(|_| "[]".into());
    println!("{}", json!({"ok": true, "project": project, "entries": serde_json::from_str::<Value>(&body).unwrap_or(json!([]))}));
    0
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", d.as_secs(), d.subsec_millis())
}
