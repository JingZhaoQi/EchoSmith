#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
    thread,
    time::Duration,
};

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
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let backend_path = get_backend_path(&app_handle)?;
    eprintln!("[DEBUG] Backend path: {:?}", backend_path);
    eprintln!("[DEBUG] Is directory: {}", backend_path.is_dir());

    let mut last_error: Option<String> = None;

    for attempt in 0..5 {
        let port = select_port(attempt);
        eprintln!("[DEBUG] Attempt #{}, using port {}", attempt + 1, port);

        let mut command = if backend_path.is_dir() {
            // Development: python module (backend_path is the backend directory)
            let project_root = backend_path
                .parent()
                .ok_or("Invalid backend path structure in development mode")?;
            let python_bin = find_venv_python(project_root).unwrap_or_else(|| "python3".into());
            let mut cmd = Command::new(python_bin);
            cmd.args(["-m", "backend"]);
            eprintln!("[DEBUG] Running: python3 -m backend");
            eprintln!("[DEBUG] Working directory: {:?}", project_root);
            cmd.current_dir(project_root);
            cmd
        } else {
            // Production: standalone executable
            eprintln!("[DEBUG] Running standalone executable: {:?}", backend_path);
            Command::new(&backend_path)
        };

        command.env("ECHOSMITH_PORT", port.to_string());
        command.env("ECHOSMITH_TOKEN", &token);
        eprintln!("[DEBUG] Port: {}, Token: {}", port, &token);

        match command.spawn() {
            Ok(mut child) => {
                eprintln!(
                    "[DEBUG] Backend process spawned successfully, PID: {:?}",
                    child.id()
                );
                match wait_for_backend(&mut child, port) {
                    Ok(()) => {
                        return Ok(BackendState {
                            process: Mutex::new(Some(child)),
                            port,
                            token: token.clone(),
                        });
                    }
                    Err(wait_err) => {
                        eprintln!(
                            "[ERROR] Backend did not become ready on port {}: {}",
                            port, wait_err
                        );
                        let _ = child.kill();
                        last_error = Some(wait_err);
                    }
                }
            }
            Err(spawn_err) => {
                let err_msg = format!(
                    "Failed to start backend at {:?}: {}",
                    backend_path, spawn_err
                );
                eprintln!("[ERROR] {}", err_msg);
                last_error = Some(err_msg);
            }
        }

        thread::sleep(Duration::from_millis(200));
    }

    Err(last_error
        .unwrap_or_else(|| "Unable to start backend after multiple attempts".to_string())
        .into())
}

fn select_port(attempt: usize) -> u16 {
    if cfg!(debug_assertions) {
        if attempt == 0 {
            if let Ok(listener) = TcpListener::bind(("127.0.0.1", 5179)) {
                let port = listener
                    .local_addr()
                    .map(|addr| addr.port())
                    .unwrap_or(5179);
                drop(listener);
                return port;
            }
        }
        pick_unused_port().unwrap_or(5179)
    } else {
        pick_unused_port().unwrap_or(5179)
    }
}

fn wait_for_backend(child: &mut Child, port: u16) -> Result<(), String> {
    for _ in 0..80 {
        if let Some(status) = child
            .try_wait()
            .map_err(|err| format!("failed to poll backend process: {}", err))?
        {
            return Err(format!("backend exited early with status: {}", status));
        }

        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(stream) => {
                drop(stream);
                return Ok(());
            }
            Err(err) => {
                if err.kind() == std::io::ErrorKind::ConnectionRefused
                    || err.kind() == std::io::ErrorKind::TimedOut
                {
                    thread::sleep(Duration::from_millis(150));
                    continue;
                }
                return Err(err.to_string());
            }
        }
    }
    Err("backend did not open port within timeout".to_string())
}

fn get_backend_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // In development mode (debug build), always prefer Python source
    if cfg!(debug_assertions) {
        // Development mode: use Python module
        // Current dir is tauri/src-tauri, need to go up two levels to project root
        let backend_dir = std::env::current_dir()?
            .parent() // src-tauri -> tauri
            .and_then(|p| p.parent()) // tauri -> project root
            .ok_or("Cannot find project root directory")?
            .join("backend");

        if backend_dir.exists() {
            eprintln!(
                "[DEBUG] Using backend in development mode (Python source): {:?}",
                backend_dir
            );
            return Ok(backend_dir);
        } else {
            let error_msg = format!(
                "Backend source not found in development mode.\nExpected path: {:?}\nCurrent dir: {:?}",
                backend_dir,
                std::env::current_dir()
            );
            eprintln!("[ERROR] {}", error_msg);
            return Err(error_msg.into());
        }
    }

    // Production mode: look for compiled executable
    let resource_path = app_handle
        .path()
        .resource_dir()
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
        resource_path
            .join("backend")
            .join("backend")
            .join(backend_exe_name),
        // Tauri 2.x with relative path preserved
        resource_path
            .join("_up_")
            .join("_up_")
            .join("tauri_backend_dist")
            .join("backend")
            .join(backend_exe_name),
        // Alternative Tauri 2.x structure
        resource_path
            .join("tauri_backend_dist")
            .join("backend")
            .join(backend_exe_name),
    ];

    for path in &possible_paths {
        if path.exists() {
            eprintln!("[DEBUG] Using backend in production mode: {:?}", path);
            return Ok(path.clone());
        }
    }

    let error_msg = format!(
        "Backend executable not found in production mode.\nTried paths: {:?}\nResource dir: {:?}",
        possible_paths, resource_path
    );
    eprintln!("[ERROR] {}", error_msg);
    Err(error_msg.into())
}

fn find_venv_python(project_root: &Path) -> Option<PathBuf> {
    // Prefer project local virtualenv to avoid system Python conflicts
    let candidates = if cfg!(target_os = "windows") {
        vec![
            project_root.join(".venv").join("Scripts").join("python.exe"),
            project_root.join("venv").join("Scripts").join("python.exe"),
        ]
    } else {
        vec![
            project_root.join(".venv").join("bin").join("python3"),
            project_root.join(".venv").join("bin").join("python"),
            project_root.join("venv").join("bin").join("python3"),
            project_root.join("venv").join("bin").join("python"),
        ]
    };

    for candidate in candidates {
        if candidate.exists() {
            eprintln!("[DEBUG] Using virtualenv python: {:?}", candidate);
            return Some(candidate);
        }
    }
    None
}
