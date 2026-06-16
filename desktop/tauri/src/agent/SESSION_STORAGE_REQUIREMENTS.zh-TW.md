# pedelec-agent Session 儲存與識別碼調整需求

## 1. 文件目的

本文件定義 `pedelec-agent` session 儲存位置、目錄結構、session ID 產生方式，以及 CLI 建立與 resume session 的新契約。

本次改動不保留舊版相容性，也不執行既有 session 資料遷移。

## 2. 背景

目前 `pedelec-agent`：

- 預設將資料寫入 process current working directory 下的 `.pedelec-agent`。
- session 目錄為 `.pedelec-agent/sessions/<session_id>/`。
- `session_id` 由呼叫端以 CLI positional argument 傳入。
- 相同 `session_id` 再次執行時會 resume 既有 session。
- `PEDELEC_AGENT_HOME` 可覆寫 session 儲存根目錄。

這會造成以下問題：

- 儲存位置依啟動時的 working directory 改變，不是全域且穩定的位置。
- 所有 session 都位於同一層，長期累積後不易管理。
- 呼叫端可以自行指定 session ID，可能產生命名衝突或不一致格式。

## 3. 目標

本次改動必須完成：

1. 將 `pedelec-agent` 資料根目錄固定為使用者 home directory 下的 `.pedelec/pedelec-agent`。
2. 將 session 改為依建立年份與月份分層儲存。
3. 建立 session 時，由 `pedelec-agent` 自行產生 UUID v7。
4. resume 時，由 UUID v7 內含的 timestamp 推導 session 所在的 year/month，不建立額外 index。
5. 移除 `PEDELEC_AGENT_HOME` 與所有不再使用的 home path 設定。

## 4. 不在本次範圍

本次不處理：

- 舊 `.pedelec-agent` 目錄的偵測、讀取或搬移。
- 舊 session ID 格式的相容。
- 自動刪除或過期清理 session。
- session index database 或 `index.json`。
- transcript 與 event 的資料格式調整。
- provider、model、sandbox resume conflict 規則調整。

## 5. 儲存根目錄

### 5.1 固定路徑

正式執行時，`pedelec-agent` 的資料根目錄固定為：

```text
<user-home>/.pedelec/pedelec-agent
```

範例：

```text
# Linux / macOS
/Users/isaac/.pedelec/pedelec-agent
/home/isaac/.pedelec/pedelec-agent

# Windows
C:\Users\Isaac\.pedelec\pedelec-agent
```

程式必須透過作業系統提供的使用者 home directory API 取得 `<user-home>`，不得依賴：

- process current working directory
- executable 所在目錄
- sandbox 路徑
- `.env.local` 所在目錄

### 5.2 Home directory 無法取得

若無法取得使用者 home directory：

- 不得退回 current working directory。
- 不得建立相對路徑 `.pedelec`。
- 必須停止執行並輸出 JSONL error event。
- error code 使用 `CONFIG_ERROR`。
- error message 應明確指出無法解析 user home directory。

建議錯誤形狀：

```json
{
  "type": "error",
  "error": {
    "code": "CONFIG_ERROR",
    "message": "Unable to resolve user home directory"
  }
}
```

### 5.3 測試可替換路徑

正式 runtime 不得提供環境變數或 CLI option 覆寫資料根目錄。

為避免測試寫入真實使用者目錄，內部函式可以接受測試用 root path，例如：

```rust
fn create_session_at(root: &Path, ...)
fn load_session_at(root: &Path, ...)
```

這類 path injection 只能作為內部實作與測試能力，不得成為公開 CLI 或環境變數設定。

## 6. Session 目錄結構

### 6.1 新結構

session 必須儲存在：

```text
<user-home>/.pedelec/pedelec-agent/sessions/<year>/<month>/<session_id>/
```

完整範例：

```text
~/.pedelec/
  pedelec-agent/
    sessions/
      2026/
        06/
          0197d8f0-8e3c-7b1a-a331-3fcf7b1f9176/
            session.json
            transcript.jsonl
            events.jsonl
```

### 6.2 year/month 格式

- `<year>` 使用四位數 UTC 年份，例如 `2026`。
- `<month>` 使用兩位數 UTC 月份，必須補零，例如 `01`、`06`、`12`。
- year/month 必須從 UUID v7 內含的 timestamp 推導。
- 不得使用 resume 當下的時間決定路徑。
- 不得使用作業系統 local timezone。

### 6.3 Session 內檔案

每個 session 目錄仍包含：

```text
session.json
transcript.jsonl
events.jsonl
```

本次不修改三個檔案的用途：

- `session.json`：session metadata。
- `transcript.jsonl`：user、assistant 與 tool 訊息紀錄。
- `events.jsonl`：agent 執行事件紀錄。

既有 append-only 行為維持不變。

## 7. Session ID

### 7.1 建立規則

建立新 session 時：

- session ID 必須由 `pedelec-agent` 內部產生。
- 使用 UUID v7。
- 輸出格式使用標準 lowercase hyphenated UUID：

```text
xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
```

- 呼叫端不得指定新 session 的 ID。
- 產生後必須立即用該 UUID 推導 UTC year/month 並建立 session 目錄。

Rust dependency 應加入支援 UUID v7 產生與 timestamp 解析的 UUID library；不在本需求鎖定特定套件版本。

### 7.2 UUID collision 防護

即使 UUID v7 碰撞機率極低，建立流程仍不得覆寫既有 session：

1. 產生 UUID v7。
2. 推導目標 session directory。
3. 以「目錄必須不存在」的方式建立 session directory。
4. 如果目錄已存在，重新產生 UUID 後再試。
5. 其他 I/O error 則回傳 `SESSION_SAVE_FAILED`。

不得對已存在的同名目錄直接寫入新的 `session.json`。

### 7.3 Resume 規則

resume 既有 session 時：

- 呼叫端必須提供既有 `session_id`。
- `session_id` 必須能解析為 UUID。
- UUID version 必須是 v7。
- 由 UUID v7 timestamp 轉成 UTC year/month。
- 直接讀取：

```text
<root>/sessions/<year>/<month>/<session_id>/session.json
```

- 不得遞迴掃描所有 year/month 目錄。
- 不得額外維護 session index。

### 7.4 無效或不存在的 session ID

以下情況必須拒絕 resume：

- 空字串。
- 不是合法 UUID。
- UUID version 不是 v7。
- UUID v7 timestamp 無法解析。
- 推導出的 session directory 不存在。
- `session.json` 不存在。
- `session.json` 內的 `sessionId` 與 CLI 提供值不同。

建議錯誤規則：

| 情況 | error code |
| --- | --- |
| UUID 格式錯誤或不是 v7 | `INVALID_ARGUMENT` |
| 推導路徑後找不到 session | `SESSION_LOAD_FAILED` |
| metadata 無法解析或 sessionId 不一致 | `SESSION_LOAD_FAILED` |

錯誤 details 應包含可安全輸出的 `sessionId` 與目標 path，方便除錯。

## 8. CLI 契約

### 8.1 建立新 session

舊介面：

```bash
pedelec-agent run <session_id> "<prompt>"
```

改為：

```bash
pedelec-agent run "<prompt>"
```

範例：

```bash
pedelec-agent run "請讀取 README.md 並整理重點" \
  --sandbox . \
  --provider ollama \
  --model qwen2.5-coder:7b
```

建立成功後，第一個 session event 必須回傳 agent 產生的 UUID：

```jsonl
{"type":"session","sessionId":"0197d8f0-8e3c-7b1a-a331-3fcf7b1f9176","resumed":false}
```

呼叫端必須以此事件取得後續 resume 所需的 `sessionId`。

### 8.2 Resume 既有 session

resume 改為使用 named option：

```bash
pedelec-agent run "<prompt>" --session-id <existing_uuid>
```

範例：

```bash
pedelec-agent run "繼續剛才的分析" \
  --session-id 0197d8f0-8e3c-7b1a-a331-3fcf7b1f9176 \
  --sandbox . \
  --provider ollama \
  --model qwen2.5-coder:7b
```

resume 成功時必須輸出：

```jsonl
{"type":"session","sessionId":"0197d8f0-8e3c-7b1a-a331-3fcf7b1f9176","resumed":true}
```

### 8.3 Shorthand

若保留目前不含 `run` 的 shorthand，新的形式必須是：

```bash
pedelec-agent "<prompt>"
pedelec-agent "<prompt>" --session-id <existing_uuid>
```

不得再把第一個 positional argument 解讀為 session ID。

### 8.4 不相容變更

以下舊格式不再支援：

```bash
pedelec-agent run <session_id> "<prompt>"
pedelec-agent <session_id> "<prompt>"
```

使用舊格式時應回傳 `INVALID_ARGUMENT`，不需要提供 deprecation warning 或自動轉換。

## 9. Session 建立與載入流程

現有 `load_or_create_session(session_id, ...)` 同時負責建立與 resume。新需求建議拆成兩條明確流程：

```rust
create_session(config, sandbox_path) -> SessionState
load_session(session_id, config, sandbox_path) -> SessionState
```

### 9.1 create_session

流程：

1. 解析固定 agent root path。
2. 產生 UUID v7。
3. 從 UUID timestamp 取得 UTC year/month。
4. 原子建立 session directory，避免覆寫。
5. 建立 `SessionMetadata`。
6. 寫入 `session.json`。
7. 建立空的 `transcript.jsonl`。
8. 設定 `events.jsonl` path；檔案可在第一次 event 時建立。
9. 回傳 `SessionState { resumed: false }`。

### 9.2 load_session

流程：

1. 驗證 session ID 是 UUID v7。
2. 從 UUID timestamp 取得 UTC year/month。
3. 組出唯一 session directory。
4. 讀取並解析 `session.json`。
5. 驗證 metadata 的 `sessionId`。
6. 套用現有 provider、model、sandbox conflict 檢查。
7. 套用現有 transcript size 限制。
8. 回傳 `SessionState { resumed: true }`。

## 10. Metadata

`SessionMetadata` 欄位維持：

```rust
pub struct SessionMetadata {
    pub session_id: String,
    pub provider: String,
    pub model: String,
    pub sandbox_path: PathBuf,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

補充規則：

- `session_id` 使用 agent 產生的 UUID v7 字串。
- `created_at` 與 `updated_at` 使用 UTC。
- `created_at` 應在 session 建立時寫入。
- resume 不得修改 `created_at`。
- 正常完成一次 turn 後，維持既有行為更新 `updated_at`。
- 不需要額外保存 year 或 month，因為可由 UUID 推導。

## 11. 設定移除

### 11.1 必須移除

移除所有 `PEDELEC_AGENT_HOME` 支援：

- process environment 讀取。
- `.env.local` 讀取。
- README 範例。
- 測試 fixture。
- `AgentConfig.home` 欄位。
- 僅服務於可配置 agent home 的 helper function。

### 11.2 設定優先序更新

README 中的設定優先序仍可保留：

```text
CLI arguments > process env > .env.local > internal default
```

但此規則不再適用於 agent storage root，因為 storage root 沒有可覆寫設定。

## 12. 呼叫端整合要求

所有啟動 `pedelec-agent` 的呼叫端必須跟著更新：

### 第一次呼叫

- 不傳 session ID。
- 讀取 stdout JSONL。
- 從 `type = "session"` event 取得 `sessionId`。
- 保存此 ID 作為 provider session ID。

### 後續呼叫

- 將先前保存的 provider session ID 放入 `--session-id`。
- 不得使用 Pedelec thread ID 取代 agent session ID。

若呼叫端已有類似 `provider_session_id` 狀態，應保存 `pedelec-agent` 回傳的 UUID v7，不得自行產生。

## 13. 預期修改範圍

至少包含：

| 檔案 | 修改內容 |
| --- | --- |
| `desktop/tauri/Cargo.toml` | 加入支援 UUID v7 的 dependency 與必要 feature。 |
| `desktop/tauri/src/agent/cli.rs` | 移除 positional session ID；新增 `--session-id` optional argument。 |
| `desktop/tauri/src/agent/config.rs` | 移除 `AgentConfig.home` 與 `PEDELEC_AGENT_HOME`。 |
| `desktop/tauri/src/agent/session.rs` | 實作固定 root、UUID v7 建立、year/month 推導與 resume。 |
| `desktop/tauri/src/agent/runtime.rs` | 依 CLI 是否提供 `--session-id` 決定 create 或 resume。 |
| `desktop/tauri/src/agent/README.zh-TW.md` | 更新指令、目錄結構、設定與範例。 |
| 相關呼叫端 | 第一次執行解析 session event，後續傳入 `--session-id`。 |
| 相關測試 | 更新舊介面，新增 UUID v7 與目錄分層測試。 |

實作時若發現其他檔案仍引用舊 positional session ID 或 `PEDELEC_AGENT_HOME`，必須一併移除。

## 14. 測試需求

### 14.1 UUID

必須測試：

- 建立 session 會產生合法 UUID。
- UUID version 為 v7。
- UUID 輸出為 lowercase hyphenated 格式。
- 兩次建立會產生不同 ID。

### 14.2 目錄

必須測試：

- 目錄符合 `sessions/YYYY/MM/<uuid>`。
- year/month 來自 UUID timestamp 的 UTC 日期。
- month 必須補零。
- process working directory 改變不影響正式 root path 的計算。
- session directory 已存在時不會被覆寫。

測試不得將資料寫入真實 `~/.pedelec`，應使用內部 test root injection。

### 14.3 CLI

必須測試：

- `pedelec-agent run "prompt"` 被解析為建立新 session。
- `pedelec-agent run "prompt" --session-id <uuid-v7>` 被解析為 resume。
- shorthand 使用相同規則。
- 舊 positional session ID 格式被拒絕。
- `--session-id` 缺少值時回傳 `INVALID_ARGUMENT`。

### 14.4 Resume

必須測試：

- 可透過 UUID v7 直接找到 year/month 下的 session。
- resume 不需要掃描其他月份。
- UUID v4 被拒絕。
- 非 UUID 字串被拒絕。
- 合法 UUID v7 但 session 不存在時回傳 `SESSION_LOAD_FAILED`。
- metadata session ID 不一致時回傳 `SESSION_LOAD_FAILED`。
- provider、model、sandbox conflict 行為維持不變。
- transcript size limit 行為維持不變。

### 14.5 設定移除

必須測試或靜態確認：

- `AgentConfig` 不再包含 `home`。
- `PEDELEC_AGENT_HOME` 不再被讀取。
- `.env.local` 中即使存在 `PEDELEC_AGENT_HOME` 也不會影響路徑。
- README 不再將 `PEDELEC_AGENT_HOME` 列為支援設定。

### 14.6 無舊資料相容

必須測試：

- 舊的 `.pedelec-agent/sessions/<id>` 不會被自動讀取。
- 不執行 copy、move、symlink 或 migration。

## 15. 驗收標準

本需求完成需同時符合：

1. 新 session ID 只能由 `pedelec-agent` 產生，且為 UUID v7。
2. 建立 session 的 CLI 不接受外部指定 ID。
3. resume 僅透過 `--session-id <uuid-v7>` 指定既有 session。
4. session 固定寫入 `~/.pedelec/pedelec-agent/sessions/YYYY/MM/<uuid>/`。
5. YYYY/MM 由 UUID v7 timestamp 以 UTC 推導。
6. resume 可直接由 UUID 定位，不掃描 session tree，也不使用 index。
7. `PEDELEC_AGENT_HOME` 與 `AgentConfig.home` 已完全移除。
8. 不讀取、不遷移舊 `.pedelec-agent` 資料。
9. transcript、events、resume conflict 與完成後更新 `updatedAt` 的既有行為未被破壞。
10. 所有新增與既有相關測試通過。
