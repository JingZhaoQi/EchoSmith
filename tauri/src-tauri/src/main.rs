#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::Write,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
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

fn get_log_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let log_dir = PathBuf::from(&home).join("Library").join("Logs").join("EchoSmith");
    let _ = fs::create_dir_all(&log_dir);
    log_dir.join("backend.log")
}

fn log_to_file(msg: &str) {
    let path = get_log_path();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "[{}] {}", timestamp, msg);
    }
}

fn main() {
    // Truncate log on fresh start
    let log_path = get_log_path();
    let _ = fs::write(&log_path, "");
    log_to_file("=== EchoSmith starting ===");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            match spawn_backend(app.handle().clone()) {
                Ok(backend_state) => {
                    app.manage(backend_state);
                }
                Err(err) => {
                    let msg = format!("{}", err);
                    log_to_file(&format!("FATAL: backend failed to start: {}", msg));

                    let log_path = get_log_path();
                    #[cfg(target_os = "macos")]
                    let hint = format!(
                        "后端启动失败，请尝试以下步骤：\n\n\
                         1. 打开「终端」应用\n\
                         2. 运行命令：xattr -cr /Applications/EchoSmith.app\n\
                         3. 重新打开 EchoSmith\n\n\
                         日志文件：{}\n\n\
                         错误信息：{}",
                        log_path.display(),
                        msg,
                    );
                    #[cfg(not(target_os = "macos"))]
                    let hint = format!(
                        "后端启动失败。\n\n\
                         日志文件：{}\n\n\
                         错误信息：{}",
                        log_path.display(),
                        msg,
                    );
                    eprintln!("{}", hint);

                    // Show native dialog so user can see the error
                    #[cfg(target_os = "macos")]
                    {
                        use std::process::Command as Cmd;
                        let script = format!(
                            "display dialog \"{}\" with title \"EchoSmith\" buttons {{\"OK\"}} default button 1",
                            hint.replace('\"', "\\\"").replace('\n', "\\n")
                        );
                        let _ = Cmd::new("osascript").args(["-e", &script]).output();
                    }

                    return Err(err);
                }
            }
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
    log_to_file(&format!("Backend path: {:?}", backend_path));
    log_to_file(&format!("Is directory: {}", backend_path.is_dir()));
    log_to_file(&format!("File exists: {}", backend_path.exists()));

    // Strip macOS quarantine attributes from the entire backend tree.
    // When the app is installed from a DMG, Gatekeeper quarantines all files.
    // The user may approve the main app, but subsidiary binaries can still be blocked.
    #[cfg(target_os = "macos")]
    if !backend_path.is_dir() {
        if let Some(backend_dir) = backend_path.parent() {
            log_to_file(&format!("Stripping quarantine from {:?}", backend_dir));
            let output = Command::new("xattr")
                .args(["-rc", &backend_dir.to_string_lossy()])
                .output();
            match output {
                Ok(o) => {
                    if !o.status.success() {
                        log_to_file(&format!(
                            "xattr warning: {}",
                            String::from_utf8_lossy(&o.stderr)
                        ));
                    } else {
                        log_to_file("Quarantine attributes stripped successfully");
                    }
                }
                Err(e) => log_to_file(&format!("xattr failed: {}", e)),
            }
        }
    }

    // Check executable permissions (Unix only)
    #[cfg(unix)]
    if !backend_path.is_dir() {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(&backend_path) {
            let mode = metadata.permissions().mode();
            log_to_file(&format!("Backend permissions: {:o}", mode));
            if mode & 0o111 == 0 {
                log_to_file("WARNING: Backend binary is not executable!");
            }
        }
    }

    let mut last_error: Option<String> = None;

    // Open log file for backend stdout/stderr
    let log_path = get_log_path();
    let backend_stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();
    let backend_stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();

    for attempt in 0..5 {
        let port = select_port(attempt);
        log_to_file(&format!("Attempt #{}, port {}", attempt + 1, port));

        let mut command = if backend_path.is_dir() {
            let project_root = backend_path
                .parent()
                .ok_or("Invalid backend path structure in development mode")?;
            let python_bin = find_venv_python(project_root).unwrap_or_else(|| "python3".into());
            let mut cmd = Command::new(python_bin);
            cmd.args(["-m", "backend"]);
            cmd.current_dir(project_root);
            cmd
        } else {
            Command::new(&backend_path)
        };

        command.env("ECHOSMITH_PORT", port.to_string());
        command.env("ECHOSMITH_TOKEN", &token);

        // Redirect stdout/stderr to log file
        if let Some(ref stdout_file) = backend_stdout {
            command.stdout(Stdio::from(stdout_file.try_clone().unwrap_or_else(|_| {
                OpenOptions::new().write(true).open("/dev/null").unwrap()
            })));
        }
        if let Some(ref stderr_file) = backend_stderr {
            command.stderr(Stdio::from(stderr_file.try_clone().unwrap_or_else(|_| {
                OpenOptions::new().write(true).open("/dev/null").unwrap()
            })));
        }

        match command.spawn() {
            Ok(mut child) => {
                log_to_file(&format!("Backend spawned, PID: {:?}", child.id()));
                match wait_for_backend(&mut child, port) {
                    Ok(()) => {
                        log_to_file(&format!("Backend ready on port {}", port));
                        return Ok(BackendState {
                            process: Mutex::new(Some(child)),
                            port,
                            token: token.clone(),
                        });
                    }
                    Err(wait_err) => {
                        log_to_file(&format!("Backend not ready on port {}: {}", port, wait_err));
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
                log_to_file(&format!("SPAWN ERROR: {}", err_msg));
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
        let exists = path.exists();
        log_to_file(&format!("Try path: {:?} exists={}", path, exists));
        if exists {
            return Ok(path.clone());
        }
    }

    let error_msg = format!(
        "Backend executable not found.\nTried: {:?}\nResource dir: {:?}",
        possible_paths, resource_path
    );
    log_to_file(&error_msg);
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
