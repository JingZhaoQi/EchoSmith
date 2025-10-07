#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{path::PathBuf, process::Command, sync::Mutex};

use portpicker::pick_unused_port;
use rand::{distributions::Alphanumeric, Rng};
use tauri::{command, api::path::resource_dir, Manager, RunEvent, State};

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
        .setup(|app| {
            let backend_state = spawn_backend(app.handle())?;
            app.manage(backend_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_config])
        .build(tauri::generate_context!())
        .expect("failed to build Tauri app")
        .run(|app_handle, event| match event {
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

fn spawn_backend(app_handle: tauri::AppHandle) -> Result<BackendState, Box<dyn std::error::Error>> {
    let port = pick_unused_port().unwrap_or(5179);
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let backend_path = get_backend_path(&app_handle)?;

    let mut command = if backend_path.extension().and_then(|s| s.to_str()) == Some("exe")
        || !backend_path.extension().is_some() {
        // Production: standalone executable
        Command::new(&backend_path)
    } else {
        // Development: python module
        let mut cmd = Command::new("python3");
        cmd.args(["-m", "backend"]);
        cmd.current_dir(backend_path.parent().unwrap().parent().unwrap());
        cmd
    };

    command.env("ECHOSMITH_PORT", port.to_string());
    command.env("ECHOSMITH_TOKEN", &token);

    let child = command.spawn()
        .map_err(|e| format!("Failed to start backend at {:?}: {}", backend_path, e))?;

    Ok(BackendState {
        process: Mutex::new(Some(child)),
        port,
        token,
    })
}

fn get_backend_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let package_info = app_handle.package_info();
    let resource_path = resource_dir(package_info, &app_handle.env())
        .ok_or("Failed to get resource directory")?;

    // Try to find backend executable or directory
    #[cfg(target_os = "macos")]
    let backend_executable = resource_path.join("backend").join("backend");

    #[cfg(target_os = "windows")]
    let backend_executable = resource_path.join("backend").join("backend.exe");

    #[cfg(target_os = "linux")]
    let backend_executable = resource_path.join("backend").join("backend");

    if backend_executable.exists() {
        Ok(backend_executable)
    } else {
        // Fallback to development mode
        let backend_dir = std::env::current_dir()?
            .parent()
            .ok_or("Cannot find parent directory")?
            .parent()
            .ok_or("Cannot find grandparent directory")?
            .join("backend");

        if backend_dir.exists() {
            Ok(backend_dir)
        } else {
            Err(format!("Backend not found at {:?} or {:?}", backend_executable, backend_dir).into())
        }
    }
}
