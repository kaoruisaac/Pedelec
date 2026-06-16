use super::error::AgentError;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CliArgs {
    pub session_id: Option<String>,
    pub prompt: String,
    pub sandbox: Option<PathBuf>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub env_file: Option<PathBuf>,
    pub pedelec_cli: Option<PathBuf>,
    pub core_runtime_file: Option<PathBuf>,
}

pub fn parse_args(args: Vec<String>) -> Result<CliArgs, AgentError> {
    let mut rest = args.into_iter().skip(1).collect::<Vec<_>>();
    if rest.first().map(String::as_str) == Some("run") {
        rest.remove(0);
    }

    let prompt = take_positional(&mut rest, "prompt")?;
    let mut parsed = CliArgs {
        prompt,
        ..CliArgs::default()
    };

    let mut index = 0;
    while index < rest.len() {
        match rest[index].as_str() {
            "--jsonl" => {
                index += 1;
            }
            "--sandbox" => {
                parsed.sandbox = Some(PathBuf::from(take_option_value(&rest, index)?));
                index += 2;
            }
            "--provider" => {
                parsed.provider = Some(take_option_value(&rest, index)?);
                index += 2;
            }
            "--model" => {
                parsed.model = Some(take_option_value(&rest, index)?);
                index += 2;
            }
            "--session-id" => {
                parsed.session_id = Some(take_non_empty_option_value(&rest, index)?);
                index += 2;
            }
            "--env-file" => {
                parsed.env_file = Some(PathBuf::from(take_option_value(&rest, index)?));
                index += 2;
            }
            "--pedelec-cli" => {
                parsed.pedelec_cli = Some(PathBuf::from(take_option_value(&rest, index)?));
                index += 2;
            }
            "--core-runtime-file" => {
                parsed.core_runtime_file = Some(PathBuf::from(take_option_value(&rest, index)?));
                index += 2;
            }
            other => {
                return Err(AgentError::with_details(
                    "INVALID_ARGUMENT",
                    format!("Unknown argument: {other}"),
                    serde_json::json!({ "argument": other }),
                ));
            }
        }
    }

    Ok(parsed)
}

fn take_positional(rest: &mut Vec<String>, name: &str) -> Result<String, AgentError> {
    if rest.is_empty() || rest[0].starts_with("--") {
        return Err(AgentError::new(
            "INVALID_ARGUMENT",
            format!("Missing required argument: {name}"),
        ));
    }
    Ok(rest.remove(0))
}

fn take_option_value(rest: &[String], index: usize) -> Result<String, AgentError> {
    rest.get(index + 1)
        .filter(|value| !value.starts_with("--"))
        .cloned()
        .ok_or_else(|| {
            AgentError::new(
                "INVALID_ARGUMENT",
                format!("Missing value for {}", rest[index]),
            )
        })
}

fn take_non_empty_option_value(rest: &[String], index: usize) -> Result<String, AgentError> {
    let value = take_option_value(rest, index)?;
    if value.trim().is_empty() {
        return Err(AgentError::new(
            "INVALID_ARGUMENT",
            format!("Missing value for {}", rest[index]),
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_run_command() {
        let args = parse_args(vec![
            "pedelec-agent".into(),
            "run".into(),
            "hello".into(),
            "--provider".into(),
            "ollama".into(),
        ])
        .unwrap();

        assert_eq!(args.session_id, None);
        assert_eq!(args.prompt, "hello");
        assert_eq!(args.provider.as_deref(), Some("ollama"));
    }

    #[test]
    fn parses_shorthand_command() {
        let args = parse_args(vec![
            "pedelec-agent".into(),
            "hello".into(),
            "--jsonl".into(),
        ])
        .unwrap();

        assert_eq!(args.session_id, None);
        assert_eq!(args.prompt, "hello");
    }

    #[test]
    fn parses_session_id_option_for_resume() {
        let args = parse_args(vec![
            "pedelec-agent".into(),
            "run".into(),
            "hello".into(),
            "--session-id".into(),
            "0197d8f0-8e3c-7b1a-a331-3fcf7b1f9176".into(),
        ])
        .unwrap();

        assert_eq!(
            args.session_id.as_deref(),
            Some("0197d8f0-8e3c-7b1a-a331-3fcf7b1f9176")
        );
        assert_eq!(args.prompt, "hello");
    }

    #[test]
    fn rejects_old_positional_session_id_format() {
        let err = parse_args(vec![
            "pedelec-agent".into(),
            "run".into(),
            "s1".into(),
            "hello".into(),
        ])
        .unwrap_err();

        assert_eq!(err.code, "INVALID_ARGUMENT");
    }

    #[test]
    fn rejects_empty_session_id_option() {
        let err = parse_args(vec![
            "pedelec-agent".into(),
            "run".into(),
            "hello".into(),
            "--session-id".into(),
            "".into(),
        ])
        .unwrap_err();

        assert_eq!(err.code, "INVALID_ARGUMENT");
    }
}
