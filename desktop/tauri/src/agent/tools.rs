use super::config::AgentConfig;
use super::error::AgentError;
use super::sandbox::Sandbox;
use serde_json::Value;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub fn tool_definitions() -> Value {
    serde_json::json!([
        {
            "type": "function",
            "function": {
                "name": "fs.list_text_files",
                "description": "List readable UTF-8 text files inside the sandbox.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "dir": { "type": "string", "default": "." },
                        "maxDepth": { "type": "integer", "default": 3 }
                    },
                    "additionalProperties": false
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "fs.read_text_file",
                "description": "Read one UTF-8 text file inside the sandbox.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "pedelec_cli.tool_call",
                "description": "Call a Pedelec host app tool through pedelec-cli.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "toolName": { "type": "string" },
                        "args": { "type": "object" }
                    },
                    "required": ["toolName", "args"],
                    "additionalProperties": false
                }
            }
        }
    ])
}

pub fn execute_tool(
    tool: &str,
    args: &Value,
    session_id: &str,
    sandbox: &Sandbox,
    config: &AgentConfig,
) -> Result<Value, AgentError> {
    match tool {
        "fs.list_text_files" => {
            let dir = args.get("dir").and_then(Value::as_str).unwrap_or(".");
            let max_depth = args
                .get("maxDepth")
                .and_then(Value::as_u64)
                .unwrap_or(3)
                .min(16) as usize;
            let files = sandbox.list_text_files(dir, max_depth)?;
            Ok(serde_json::json!({ "files": files }))
        }
        "fs.read_text_file" => {
            let path = args.get("path").and_then(Value::as_str).ok_or_else(|| {
                AgentError::new("INVALID_ARGUMENT", "fs.read_text_file requires path")
            })?;
            let (text, truncated) = sandbox.read_text_file(path)?;
            Ok(serde_json::json!({ "path": path, "text": text, "truncated": truncated }))
        }
        "pedelec_cli.tool_call" => pedelec_cli_tool_call(args, session_id, config),
        _ => Err(AgentError::with_details(
            "INVALID_ARGUMENT",
            "Unknown tool",
            serde_json::json!({ "tool": tool }),
        )),
    }
}

fn pedelec_cli_tool_call(
    args: &Value,
    session_id: &str,
    config: &AgentConfig,
) -> Result<Value, AgentError> {
    let tool_name = args
        .get("toolName")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentError::new("INVALID_ARGUMENT", "toolName must be a non-empty string")
        })?;
    let tool_args = args
        .get("args")
        .filter(|value| value.is_object())
        .ok_or_else(|| AgentError::new("INVALID_ARGUMENT", "args must be a JSON object"))?;
    let cli_path = resolve_pedelec_cli(config)?;
    let json_args = serde_json::to_string(tool_args).map_err(|err| {
        AgentError::with_details(
            "PEDELEC_CLI_FAILED",
            "Failed to serialize tool args",
            serde_json::json!({ "error": err.to_string() }),
        )
    })?;
    let mut command = Command::new(cli_path);
    command
        .arg("tool-call")
        .arg(session_id)
        .arg(tool_name)
        .arg(json_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(runtime_file) = &config.core_runtime_file {
        command.env("PEDELEC_CORE_IPC_RUNTIME_FILE", runtime_file);
    }
    let output =
        run_command_with_timeout(command, config.pedelec_cli_timeout_ms).map_err(|err| {
            AgentError::with_details(
                "PEDELEC_CLI_FAILED",
                "Failed to execute pedelec-cli",
                serde_json::json!({ "error": err.to_string() }),
            )
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        return Err(AgentError::with_details(
            "PEDELEC_CLI_FAILED",
            "pedelec-cli exited with an error",
            serde_json::json!({
                "status": output.status.code(),
                "stdout": stdout,
                "stderr": String::from_utf8_lossy(&output.stderr)
            }),
        ));
    }
    serde_json::from_str::<Value>(&stdout).map_err(|err| {
        AgentError::with_details(
            "PEDELEC_CLI_FAILED",
            "pedelec-cli stdout was not valid JSON",
            serde_json::json!({ "stdout": stdout, "error": err.to_string() }),
        )
    })
}

fn run_command_with_timeout(
    mut command: Command,
    timeout_ms: u64,
) -> Result<Output, std::io::Error> {
    let mut child = command.spawn()?;
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1));
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output();
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            return child.wait_with_output();
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn resolve_pedelec_cli(config: &AgentConfig) -> Result<PathBuf, AgentError> {
    if let Some(path) = &config.pedelec_cli_path {
        if path.exists() {
            return Ok(path.clone());
        }
    }
    find_on_path("pedelec-cli")
        .ok_or_else(|| AgentError::new("PEDELEC_CLI_NOT_FOUND", "Cannot find pedelec-cli."))
}

fn find_on_path(program: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for dir in env::split_paths(&path) {
        for candidate in candidates(&dir, program) {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn candidates(dir: &Path, program: &str) -> Vec<PathBuf> {
    let mut values = vec![dir.join(program)];
    #[cfg(windows)]
    {
        values.push(dir.join(format!("{program}.exe")));
        values.push(dir.join(format!("{program}.cmd")));
        values.push(dir.join(format!("{program}.bat")));
    }
    values
}
