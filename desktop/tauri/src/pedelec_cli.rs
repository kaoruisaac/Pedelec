use crate::pedelec_core::{error_codes, ToolCallInput, PedelecError};
use crate::pedelec_ipc::{
    send_core_ipc_request, send_core_ipc_request_with_runtime_path, CoreIpcRequest,
};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub(crate) struct ToolCliResponse {
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<PedelecError>,
}

pub fn run() {
    let response = run_tool_cli(std::env::args().collect());
    match serde_json::to_string(&response) {
        Ok(payload) => println!("{payload}"),
        Err(err) => eprintln!("cannot serialize pedelec-cli response: {err}"),
    }
}

fn run_tool_cli(args: Vec<String>) -> ToolCliResponse {
    run_tool_cli_with_runtime_file_path(args, runtime_file_path_from_env().as_deref())
}

pub(crate) fn run_tool_cli_with_runtime_file_path(
    args: Vec<String>,
    runtime_file_path: Option<&Path>,
) -> ToolCliResponse {
    match parse_tool_call_args(&args) {
        Ok(input) => {
            let request = CoreIpcRequest {
                request_id: next_cli_request_id(),
                r#type: "tool_call".to_string(),
                payload: Some(serde_json::json!(input)),
            };
            let response = match runtime_file_path {
                Some(path) => send_core_ipc_request_with_runtime_path(&request, path),
                None => send_core_ipc_request(&request),
            };
            match response {
                Ok(response) if response.ok => ToolCliResponse {
                    ok: true,
                    result: response.result,
                    error: None,
                },
                Ok(response) => ToolCliResponse {
                    ok: false,
                    result: None,
                    error: response.error.or_else(|| {
                        Some(PedelecError::new(
                            error_codes::IPC_UNAVAILABLE,
                            "Core IPC request failed",
                        ))
                    }),
                },
                Err(err) => ToolCliResponse {
                    ok: false,
                    result: None,
                    error: Some(err),
                },
            }
        }
        Err(err) => ToolCliResponse {
            ok: false,
            result: None,
            error: Some(err),
        },
    }
}

fn runtime_file_path_from_env() -> Option<PathBuf> {
    std::env::var_os("PEDELEC_CORE_IPC_RUNTIME_FILE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn parse_tool_call_args(args: &[String]) -> Result<ToolCallInput, PedelecError> {
    if args.get(1).map(String::as_str) != Some("tool-call") || args.len() != 5 {
        return Err(PedelecError::new(
            error_codes::TOOL_ARGS_INVALID,
            "usage: pedelec-cli tool-call <thread_id> <tool_name> '<json_args>'",
        ));
    }

    let json_args = serde_json::from_str::<Value>(&args[4]).map_err(|err| {
        PedelecError::with_details(
            error_codes::TOOL_ARGS_INVALID,
            "tool args must be valid JSON",
            serde_json::json!({ "error": err.to_string() }),
        )
    })?;

    Ok(ToolCallInput {
        thread_id: args[2].clone(),
        tool_name: args[3].clone(),
        args: json_args,
    })
}

fn next_cli_request_id() -> String {
    format!(
        "cli_{}_{}",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_cli_args_return_json_error_shape() {
        let response = run_tool_cli(vec!["pedelec-cli".into()]);

        assert!(!response.ok);
        assert_eq!(response.error.unwrap().code, error_codes::TOOL_ARGS_INVALID);
    }

    #[test]
    fn invalid_json_args_return_tool_args_invalid() {
        let response = run_tool_cli(vec![
            "pedelec-cli".into(),
            "tool-call".into(),
            "thread_1".into(),
            "get_app_state".into(),
            "{".into(),
        ]);

        assert!(!response.ok);
        assert_eq!(response.error.unwrap().code, error_codes::TOOL_ARGS_INVALID);
    }
}
