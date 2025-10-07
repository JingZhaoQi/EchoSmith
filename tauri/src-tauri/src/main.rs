#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{process::Command, sync::Mutex};

use portpicker::pick_unused_port;
use rand::{distributions::Alphanumeric, Rng};
use tauri::{command, AppHandle, Manager, RunEvent, State};

struct BackendState {
    process: Mutex<Option<std::process::Child>>,
    port: u16,
    token: String,
}

#[derive(serde::Serialize)]
struct BackendConfig {
    url: String,
    token: String,
}

#[command]
fn get_backend_config(state: State<BackendState>) -> BackendConfig {
    BackendConfig {
        url: format!("http://127.0.0.1:{}", state.port),
        token: state.token.clone(),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(spawn_backend())
        .invoke_handler(tauri::generate_handler![get_backend_config])
        .build(tauri::generate_context!())
        .expect("failed to build Tauri app")
        .run(|app_handle: AppHandle, event: RunEvent| match event {
            RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    if let Some(mut child) = state.process.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
                std::process::exit(0);
            }
            _ => {}
        });
}

fn spawn_backend() -> BackendState {
    let port = pick_unused_port().unwrap_or(5179);
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let mut command = Command::new("python");
    command.args(["-m", "backend"]);
    command.env("ECHOSMITH_PORT", port.to_string());
    command.env("ECHOSMITH_TOKEN", &token);
    command.current_dir(app_base_dir());
    let child = command.spawn().expect("Failed to start backend process");

    BackendState {
        process: Mutex::new(Some(child)),
        port,
        token,
    }
}

fn app_base_dir() -> std::path::PathBuf {
    std::env::current_dir()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}
