use std::{env, fs, path::PathBuf};

const DEV_CHROME_EXTENSION_ID_ENV: &str = "PEDELEC_DEV_CHROME_EXTENSION_ID";

fn main() {
    load_dev_chrome_extension_id();
    tauri_build::build()
}

fn load_dev_chrome_extension_id() {
    println!("cargo:rerun-if-env-changed={DEV_CHROME_EXTENSION_ID_ENV}");

    let profile = env::var("PROFILE").unwrap_or_default();
    if profile != "debug" {
        return;
    }

    let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") else {
        return;
    };

    let env_path = PathBuf::from(manifest_dir)
        .join("..")
        .join("..")
        .join(".env.local");
    println!("cargo:rerun-if-changed={}", env_path.display());

    if let Ok(value) = env::var(DEV_CHROME_EXTENSION_ID_ENV) {
        let value = value.trim();
        if !value.is_empty() {
            println!("cargo:rustc-env={DEV_CHROME_EXTENSION_ID_ENV}={value}");
            return;
        }
    }

    let Ok(contents) = fs::read_to_string(env_path) else {
        return;
    };

    if let Some(value) = read_dotenv_value(&contents, DEV_CHROME_EXTENSION_ID_ENV) {
        let value = value.trim();
        if !value.is_empty() {
            println!("cargo:rustc-env={DEV_CHROME_EXTENSION_ID_ENV}={value}");
        }
    }
}

fn read_dotenv_value(contents: &str, key: &str) -> Option<String> {
    for line in contents.lines() {
        let line = line.trim();

        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((current_key, value)) = line.split_once('=') else {
            continue;
        };

        if current_key.trim() != key {
            continue;
        }

        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);

        return Some(value.to_string());
    }

    None
}
