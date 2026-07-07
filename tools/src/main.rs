mod agent;
mod agent_llm;
mod doctor;
mod ffmpeg_util;
mod har;
mod isolate;
mod mlx_stt;
mod mlx_tts;
mod transcribe;
mod vad;

use clap::{Parser, Subcommand};
use std::process;

#[derive(Parser)]
#[command(name = "reactable-tools", about = "Reactable native toolchain (MLX on Apple Silicon)")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Doctor,
    Ffmpeg {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    ExtractAudio { input: String, output: String },
    Transcribe {
        input: String,
        #[arg(long, default_value = "UsefulSensors/moonshine-tiny")]
        model: String,
        #[arg(long)]
        output: Option<String>,
    },
    TtsSpeak {
        #[arg(long)]
        text: String,
        #[arg(long)]
        output: String,
        #[arg(long, default_value = "af_heart")]
        voice: String,
        #[arg(long, default_value = "1.0")]
        speed: f64,
    },
    VadDetect {
        input: String,
        #[arg(long, default_value = "-40", allow_hyphen_values = true)]
        noise_db: String,
        #[arg(long, default_value = "0.3")]
        min_silence: String,
    },
    TrimSilence {
        input: String,
        output: String,
        #[arg(long, default_value = "-40", allow_hyphen_values = true)]
        noise_db: String,
    },
    RemoveFiller {
        transcript: String,
        #[arg(long)]
        output: Option<String>,
        #[arg(long)]
        aggressive: bool,
    },
    HarCapture {
        url: String,
        #[arg(long)]
        project: String,
        #[arg(long)]
        wb_data: Option<String>,
    },
    HarList {
        #[arg(long)]
        project: String,
        #[arg(long)]
        wb_data: Option<String>,
    },
    Isolate {
        input: String,
        #[arg(long)]
        output: String,
        #[arg(long, default_value = "person")]
        target: String,
    },
    AgentChat {
        #[arg(long)]
        input: String,
        #[arg(long)]
        output: Option<String>,
        #[arg(long)]
        model: Option<String>,
    },
    AgentStatus,
    AgentPull {
        #[arg(long)]
        model: Option<String>,
    },
    AgentServe {
        #[arg(long)]
        stop: bool,
    },
}

fn main() {
    let cli = Cli::parse();
    let code = match cli.command {
        Commands::Doctor => doctor::run(),
        Commands::Ffmpeg { args } => ffmpeg_util::passthrough(&args),
        Commands::ExtractAudio { input, output } => ffmpeg_util::extract_audio(&input, &output),
        Commands::Transcribe { input, model, output } => {
            transcribe::run(&input, &model, output.as_deref())
        }
        Commands::TtsSpeak {
            text,
            output,
            voice,
            speed,
        } => mlx_tts::speak(&text, &output, &voice, speed),
        Commands::VadDetect {
            input,
            noise_db,
            min_silence,
        } => vad::detect(&input, &noise_db, &min_silence),
        Commands::TrimSilence {
            input,
            output,
            noise_db,
        } => vad::trim_silence(&input, &output, &noise_db),
        Commands::RemoveFiller {
            transcript,
            output,
            aggressive,
        } => transcribe::remove_filler(&transcript, output.as_deref(), aggressive),
        Commands::HarCapture { url, project, wb_data } => {
            har::capture(&url, &project, wb_data.as_deref())
        }
        Commands::HarList { project, wb_data } => har::list(&project, wb_data.as_deref()),
        Commands::Isolate {
            input,
            output,
            target,
        } => isolate::run(&input, &output, &target),
        Commands::AgentChat {
            input,
            output,
            model,
        } => agent::chat(&input, output.as_deref(), model.as_deref()),
        Commands::AgentStatus => agent::status(),
        Commands::AgentPull { model } => agent::pull(model.as_deref()),
        Commands::AgentServe { stop } => agent::serve(stop),
    };
    process::exit(code);
}
