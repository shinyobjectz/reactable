use serde::Serialize;

#[derive(Serialize)]
struct ToolCheck {
    name: String,
    ok: bool,
    detail: Option<String>,
}

#[derive(Serialize)]
struct DoctorReport {
    ok: bool,
    backend: String,
    tools: Vec<ToolCheck>,
}

pub fn run() -> i32 {
    let mut tools = vec![
        ToolCheck {
            name: "platform".into(),
            ok: cfg!(target_os = "macos"),
            detail: Some(std::env::consts::ARCH.into()),
        },
        ToolCheck {
            name: "mlx-stt".into(),
            ok: crate::mlx_stt::available(),
            detail: Some("moonshine via voice-stt + MLX".into()),
        },
        ToolCheck {
            name: "mlx-tts".into(),
            ok: crate::mlx_tts::available(),
            detail: Some("kokoro via voice-tts + voice-g2p + MLX".into()),
        },
        ToolCheck {
            name: "agent-llm".into(),
            ok: agent_llm_available(),
            detail: Some(agent_llm_detail()),
        },
    ];

    if let Some(ff) = super::ffmpeg_util::resolve_ffmpeg() {
        tools.push(ToolCheck {
            name: "ffmpeg".into(),
            ok: true,
            detail: Some(ff),
        });
    } else {
        tools.push(ToolCheck {
            name: "ffmpeg".into(),
            ok: false,
            detail: Some("install ffmpeg or set REACTABLE_FFMPEG".into()),
        });
    }

    let ok = tools.iter().any(|t| t.name == "ffmpeg" && t.ok)
        && tools.iter().any(|t| t.name == "mlx-stt" && t.ok);

    let report = DoctorReport {
        ok,
        backend: "rust-mlx".into(),
        tools,
    };
    println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    if ok { 0 } else { 1 }
}

fn agent_llm_available() -> bool {
    crate::agent_llm::find_uv().is_some() && crate::agent_llm::model_cached(&crate::agent_llm::default_model())
}

fn agent_llm_detail() -> String {
    let model = crate::agent_llm::default_model();
    if crate::agent_llm::find_uv().is_none() {
        return "uv missing — curl -LsSf https://astral.sh/uv/install.sh | sh".into();
    }
    if crate::agent_llm::model_cached(&model) {
        format!("{model} via mlx_lm.server (cached)")
    } else {
        format!("{model} not cached — run: reactable agent pull")
    }
}
