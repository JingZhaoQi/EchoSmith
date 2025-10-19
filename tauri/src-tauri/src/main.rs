#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{path::PathBuf, process::Command, sync::Mutex};

use portpicker::pick_unused_port;
use rand::{distributions::Alphanumeric, Rng};
use tauri::{command, Manager, State};

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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let backend_state = spawn_backend(app.handle().clone())?;
            app.manage(backend_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_config])
        .build(tauri::generate_context!())
        .expect("failed to build Tauri app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Clean up backend process
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    if let Some(mut child) = state.process.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

fn spawn_backend(app_handle: tauri::AppHandle) -> Result<BackendState, Box<dyn std::error::Error>> {
    // In development mode, use fixed port for Vite proxy; in production, pick dynamically
    let port = if cfg!(debug_assertions) {
        5179
    } else {
        pick_unused_port().unwrap_or(5179)
    };
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
    let resource_path = app_handle.path().resource_dir()
        .map_err(|_| "Failed to get resource directory")?;

    // Define backend executable name based on OS
    #[cfg(target_os = "windows")]
    let backend_exe_name = "backend.exe";

    #[cfg(not(target_os = "windows"))]
    let backend_exe_name = "backend";

    // Try multiple possible locations
    let possible_paths = vec![
        // Direct path in Resources/backend (new structure)
        resource_path.join("backend").join(backend_exe_name),
        // Tauri 1.x style
        resource_path.join("backend").join("backend").join(backend_exe_name),
        // Tauri 2.x with relative path preserved
        resource_path.join("_up_").join("_up_").join("tauri_backend_dist").join("backend").join(backend_exe_name),
        // Alternative Tauri 2.x structure
        resource_path.join("tauri_backend_dist").join("backend").join(backend_exe_name),
    ];

    for path in &possible_paths {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    // Fallback to development mode
    // pnpm tauri dev runs from tauri/ directory, go up to project root
    let backend_dir = std::env::current_dir()?
        .parent()  // tauri -> project root
        .ok_or("Cannot find parent directory")?
        .join("backend");

    if backend_dir.exists() {
        eprintln!("[DEBUG] Found backend in development mode: {:?}", backend_dir);
        Ok(backend_dir)
    } else {
        let error_msg = format!(
            "Backend not found. Tried paths: {:?}\nDevelopment fallback: {:?}\nCurrent dir: {:?}",
            possible_paths,
            backend_dir,
            std::env::current_dir()
        );
        eprintln!("[ERROR] {}", error_msg);
        Err(error_msg.into())
    }
}
