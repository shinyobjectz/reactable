use serde_json::json;

pub fn run(input: &str, output: &str, target: &str) -> i32 {
    eprintln!(
        "reactable-tools isolate: offline background matting for '{target}' is planned."
    );
    eprintln!("  input:  {input}");
    eprintln!("  output: {output}");
    eprintln!("  Workaround: use ffmpeg chromakey or an external rembg/MODNet pipeline.");
    println!(
        "{}",
        json!({
            "ok": false,
            "error": "not_implemented",
            "planned": "rust sidecar + local matting model",
            "target": target
        })
    );
    1
}
