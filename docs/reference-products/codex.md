# OpenAI Codex 產品與設計分析（重點：Sandbox 實作）

- 來源：<https://github.com/openai/codex>（Apache-2.0）
- 分析快照：commit `29f056c`（2026-09-24）
- 一句話定位：**在本機執行的 coding agent**（CLI / TUI / IDE / App），核心是 Rust（`codex-rs/`）。它的特色在於**用作業系統原生的 sandbox 限制 Agent 執行的每一個指令**，並把審批、執行規則和網路政策疊在上面。

## 1. 產品功能

| 類別 | 功能                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 介面 | 終端機 TUI、`codex exec` 非互動模式、IDE 延伸、桌面 App；都透過 `app-server`（JSON-RPC）使用同一個 core                                                           |
| 工具 | shell / unified exec（可長時間執行的 PTY）、`apply_patch`、檔案搜尋、MCP client、web search、多 Agent 工具                                                        |
| 設定 | `config.toml` 分層合併；**permission profile**（內建 `:read-only`、`:workspace`、`:danger-full-access`，可自訂並用 `extends` 繼承）                               |
| 安全 | OS sandbox（macOS Seatbelt、Linux bubblewrap + seccomp、Windows restricted token / 專用帳號 / MXC）、審批政策、execpolicy 規則、受管網路 proxy、guardian 自動審查 |
| 其他 | Skills、`AGENTS.md`、記憶、雲端任務、hooks、OpenTelemetry                                                                                                         |

## 2. Sandbox 架構總覽

```
模型提出 tool call（shell / apply_patch / unified exec）
        │
        ▼
core/tools/orchestrator.rs ──── 1) 審批：AskForApproval × execpolicy × guardian
        │
        ▼
sandboxing::SandboxManager
   select_initial()  ── 依 PermissionProfile 與平台決定 SandboxType
   transform()       ── 把原始 argv 包成「在 sandbox 內執行」的 argv
        │
        ├─ macOS   : /usr/bin/sandbox-exec -p <SBPL 政策> -D參數… -- cmd
        ├─ Linux   : codex-linux-sandbox（bwrap 建檔案系統視圖 → no_new_privs + seccomp → execvp）
        ├─ Windows : restricted token + capability SID ACL，或專用本機帳號 + WFP 防火牆，或 MXC
        └─ None    : 直接執行
        │
        ▼
2) 第一次執行（在 sandbox 內）
        │ 失敗且看起來是 sandbox 拒絕？
        ▼
3) 依審批政策詢問使用者 → 允許則「不帶 sandbox」重跑（第二次執行）
```

相關 crate：

| Crate                                | 職責                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `protocol`                           | 政策資料模型：`PermissionProfile`、`FileSystemSandboxPolicy`、`NetworkSandboxPolicy`、`AskForApproval`、舊版 `SandboxPolicy` |
| `sandboxing`                         | 平台無關的 `SandboxManager`、Seatbelt 政策產生器（`.sbpl`）、bwrap 參數、拒絕偵測、違規事件                                  |
| `linux-sandbox`                      | `codex-linux-sandbox` 輔助程式：bubblewrap、Landlock（舊版）、seccomp、proxy 路由橋接                                        |
| `windows-sandbox-rs` / `mxc-sandbox` | Windows 三種後端                                                                                                             |
| `network-proxy`                      | 本機 HTTP / SOCKS5 proxy：網域 allow/deny、limited（唯讀）模式、MITM hook                                                    |
| `execpolicy`                         | Starlark 前綴規則：`allow / prompt / forbidden`                                                                              |
| `shell-escalation`                   | 攔截 `execve`，逐指令決定在 sandbox 內跑、提權到 sandbox 外跑、或拒絕                                                        |
| `process-hardening`                  | Codex 自身行程的強化：關 core dump、禁 ptrace、清 `LD_*` / `DYLD_*`                                                          |

## 3. 政策資料模型

### 3.1 PermissionProfile（新模型）

```rust
enum PermissionProfile {
    Managed  { file_system: ManagedFileSystemPermissions, network: NetworkSandboxPolicy }, // Codex 自己建 sandbox
    Disabled,                                                                           // 不套外層 sandbox
    External { network: NetworkSandboxPolicy },                                         // 外部（如容器）已隔離檔案系統
}
enum NetworkSandboxPolicy { Restricted /* 預設 */, Enabled }
enum FileSystemAccessMode { Read, Write, Deny }
```

- 檔案系統政策是**條目清單**：每個條目是「路徑或特殊路徑 → `read` / `write` / `deny`」。
- **特殊路徑**：`:root`、`:minimal`（平台執行所需的最小唯讀集合）、`:project_roots`（工作目錄，可帶 subpath）、`:tmpdir`、`:slash_tmp`。未知的特殊路徑保留為 `Unknown`，舊版遇到新版設定時會**警告並忽略**，不會拒絕載入（向前相容）。
- **衝突規則**：先比路徑具體程度，越具體的越優先；具體程度相同時 `deny > write > read`。因此可以寫 `/repo = write`、`/repo/a = deny`、`/repo/a/b = write`。
- 支援 glob 拒讀：例如 `"**/*.env" = "none"`，執行前展開成具體檔案再遮蔽。
- **受保護的中繼資料**：writable root 底下的 `.git`、`.agents`、`.codex` 預設唯讀。Agent 如果能改 `.git/hooks` 或自己的設定檔，就等於能在 sandbox 外執行任意程式，這是防止這種提權的關鍵。

### 3.2 舊版 SandboxPolicy（仍相容）

`read-only`、`workspace-write`（cwd + TMPDIR + `/tmp` 可寫，`network_access` 預設關）、`danger-full-access`、`external-sandbox`。新模型可以轉回舊模型，無法轉換的「split policy」一律走 bubblewrap。

### 3.3 審批政策（AskForApproval）

| 值                   | 行為                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `untrusted`          | 除非 execpolicy 規則明確允許，否則每個指令都要審批                                                                                              |
| `on-request`（預設） | 由模型決定何時請求審批（例如要求提權）；在 sandbox 內被拒時才詢問                                                                               |
| `granular`           | 逐類別控制：sandbox 提權、execpolicy `prompt` 規則、skill 腳本、`request_permissions` 工具、MCP elicitation；關閉的類別會**自動拒絕**而不是詢問 |
| `never`              | 從不詢問，失敗直接回給模型                                                                                                                      |

**Sandbox 和審批是兩個獨立的維度**：sandbox 決定「技術上能做什麼」，審批決定「什麼時候問人」。常見組合是 `:workspace` 搭配 `on-request`。

## 4. 各平台實作

### 4.1 macOS：Seatbelt（`sandbox-exec`）

- 只使用 `/usr/bin/sandbox-exec`，**不從 PATH 找**，防止攻擊者在 PATH 放假的執行檔。
- 政策是 SBPL（Scheme 風格），由幾個部分組成：
  - `seatbelt_base_policy.sbpl`：參考 Chrome renderer 的 sandbox，**`(deny default)` 預設全拒**，只放行 process-exec / fork、同 sandbox 內的 signal、必要的 sysctl、`/dev/null` 等。
  - `seatbelt_read_only_platform_defaults.sbpl`：平台執行所需的唯讀路徑。
  - `seatbelt_network_policy.sbpl`：只有網路開啟時才加入（DNS、TLS 憑證服務的 mach-lookup 等）。
  - 動態產生的部分：依政策為每個 root 產生 `(allow file-read* …)` 或 `(allow file-write* …)`。
- **路徑用參數傳入**（`-DWRITABLE_ROOT_0=/path`，政策內寫 `(param "WRITABLE_ROOT_0")`），不把路徑字串拼進政策文字，避免注入。
- 可寫 root 內的例外用 `require-not` 排除。會同時排除 `literal` 與 `subpath`，連「第一次 `mkdir .codex`」這種建立動作都擋。受保護的中繼資料名稱用 regex 排除。
- **Root anchor**：禁止刪除可寫 root 目錄本身（`deny file-write-unlink`），防止 sandbox 內的程序把「下次建 sandbox 會用到的邊界」換掉（例如換成 symlink）。
- 會處理 symlink 與 `/tmp` → `/private/tmp` 這類別名，對邏輯路徑與解析後路徑都下規則。
- 受管網路時，只允許連到 loopback 上的 proxy port（從 `HTTP_PROXY` 等環境變數解析），以及白名單內的 unix socket。

### 4.2 Linux：bubblewrap + seccomp（Landlock 為舊版後備）

`codex-linux-sandbox` 是獨立的輔助程式，也可以由 `codex` 主程式透過 **arg0 分派**（用 `codex-linux-sandbox` 這個名字被呼叫時，就以輔助程式身分執行）。流程：

1. **bubblewrap 建立檔案系統視圖**
   - `--ro-bind / /`：整個根目錄唯讀。
   - 可寫 root 用 `--bind <root> <root>` 疊上去；受保護的子路徑（`.git`、解析後的 `gitdir:`、`.codex`）再用 `--ro-bind` 蓋回唯讀。
   - 重疊的條目**依路徑具體程度排序套用**，因此可以「重新開放」深層路徑。
   - 拒讀的 glob 事先用 `rg --files` 展開（沒有 rg 就改用內建 walker），逐一遮蔽。
   - 可寫 root 內的 symlink 或尚不存在的受保護路徑，用 `/dev/null` 掛在上面擋住。
   - `--unshare-user`、`--unshare-pid`、新的 `/proc`；網路受限且沒有 proxy 時再加 `--unshare-net`。
2. **在行程內套用限制**：`PR_SET_NO_NEW_PRIVS`，再安裝 seccomp 過濾器：
   - 一律禁止：`ptrace`、`process_vm_readv/writev`、`io_uring_*`（io_uring 能繞過 `socket()` 建立 AF_VSOCK）。
   - 網路受限時：禁止 `connect`、`bind`、`listen`、`accept`、`sendto` 等；`socket` / `socketpair` 只允許 AF_UNIX。
   - 受管 proxy 模式：只允許 AF_INET / AF_INET6，以及用 AF_UNIX 連到橋接器；**橋接器建立後**再禁止新建 AF_UNIX。
3. `execvp` 進入目標指令。

受管 proxy 模式的網路路徑：network namespace 內沒有對外網路，只有一個 **TCP → UDS → TCP 的橋接器**，把流量送到 namespace 外的 `network-proxy`。所以程式即使無視 `HTTP_PROXY` 環境變數，也連不到任何地方。

系統相依性：優先用 PATH 上的 `bwrap`（會排除 cwd 內的，避免被工作目錄裡的假 bwrap 劫持）；沒有就用隨附的 bwrap，並在啟動時警告。WSL1 無法建立 user namespace，因此拒絕執行需要 sandbox 的指令。

### 4.3 Windows：三種後端

| 等級                        | 機制                                                                                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RestrictedToken`（非提權） | 以使用者 token 建立 **restricted token**，加入每個工作目錄專屬的 **capability SID**；在可寫 root 的 ACL 上授權給該 SID，因此只有這些目錄可寫。只支援相當於 `workspace-write` 的政策                                                                                                     |
| `Elevated`                  | 一次性以 UAC 或服務完成 setup：建立專用本機帳號 `CodexSandboxOffline` / `CodexSandboxOnline`，以該帳號登入執行；以 **WFP（Windows Filtering Platform）** 持久過濾器依帳號阻擋網路；以 ACL 實作拒讀與可寫 root；並使用私有 desktop（`CodexSandboxDesktop-<隨機>`），避免操作使用者的視窗 |
| `WindowsMxc`                | 使用 Windows 原生 MXC 容器；不支援時直接失敗，不退回 ACL 模式                                                                                                                                                                                                                           |

Windows 沒有現成的 `sandbox-exec` / bwrap，因此要實作帳號、ACL、防火牆、desktop 隔離。這也是整個 repo 中最龐大的 sandbox 子系統（`windows-sandbox-rs` 有 100 多個 Rust 原始檔）。

## 5. 疊在 sandbox 之上的機制

### 5.1 失敗後提權重試（orchestrator）

`core/src/tools/orchestrator.rs` 的三步驟：

1. **審批**：依 `AskForApproval`、execpolicy、guardian 判斷工具呼叫屬於 `Skip`（免審批，可附 `bypass_sandbox`）、`NeedsApproval` 或 `Forbidden`。
2. **在 sandbox 內第一次執行**。
3. **拒絕偵測**（`sandboxing/src/denial.rs`）：沒辦法確定失敗是不是 sandbox 造成的，所以採保守的啟發式判斷。輸出含 `operation not permitted`、`read-only file system`、`seccomp`、`landlock` 等關鍵字，或 Linux 上以 SIGSYS 結束（被 seccomp 擋下），視為 sandbox 拒絕；exit code 2、126、127（用法錯誤、無法執行、找不到指令）則直接判定**不是** sandbox 造成的。
   - `never` / `on-request`：不重試，把簡潔的拒絕訊息連同原始輸出回給模型。
   - 其他情況：詢問使用者，同意後**不帶 sandbox** 重跑。guardian 自動審查的核准只涵蓋 sandbox 內那次執行；不帶 sandbox 重跑需要**重新審查**。
   - 例外：政策中若有**拒讀路徑**，就永遠不允許不帶 sandbox 執行，因為拒讀只存在於 sandbox 內，繞過 sandbox 等於默默開放那些檔案。

「Approve for session」以**逐鍵快取**實作：`apply_patch` 一次改多個檔案時每個檔案各存一把鍵，之後只要動到其中任何子集就不再詢問。使用者同意時，系統可以一併提出 **execpolicy 修正案**（新增一條 `allow` 規則），日後同類指令就不必再問。

### 5.2 execpolicy：指令前綴規則

```starlark
prefix_rule(
    pattern = ["git", ["push", "reset"]],
    decision = "prompt",               # allow | prompt | forbidden
    justification = "改動遠端或歷史需確認",
    match = [["git", "push"]],         # 載入時驗證的範例（等同單元測試）
    not_match = [["git", "status"]],
)
host_executable(name = "git", paths = ["/usr/bin/git", "/opt/homebrew/bin/git"])
```

- 依 token 順序比對前綴；`forbidden` 可以用 `justification` 建議替代做法。
- `host_executable` 限制 basename 規則只能對應到哪些絕對路徑，防止 `./git` 冒充系統的 git。
- 規則內附帶 `match` / `not_match` 範例，載入時就會驗證，規則寫錯會立刻被發現。

### 5.3 Shell escalation：逐一攔截 execve

打了 patch 的 zsh 支援 `EXEC_WRAPPER`，因此 shell 內**每一次** `execve` 都會先交給 `codex-execve-wrapper`。wrapper 透過 socket 詢問 Codex，得到三種回覆：

- `Run`：在 sandbox 內照常執行。
- `Escalate`：把檔案描述子轉交給 sandbox 外的伺服器，由它代為執行，完成後回傳 exit code。
- `Deny`：印出錯誤並結束。

這讓 execpolicy 可以作用在**管線或腳本中的每個子指令**，而不只是模型送出的那一行文字。

### 5.4 受管網路 proxy

- 本機 HTTP proxy（`127.0.0.1:3128`）與 SOCKS5 proxy（`:8081`），預設只綁 loopback。
- 網域 allow / deny（支援 `*.openai.com`，但不接受全域 `*`）；**沒有任何 allow 條目時全部阻擋**。
- 預設拒絕 local / private 網段。主機名稱**解析後**若落在私有 IP，即使在 allowlist 內也會阻擋（防 DNS rebinding）。
- `limited` 模式：只允許 `GET`、`HEAD`、`OPTIONS`。HTTPS 要做到這點必須 MITM，否則直接阻擋；CA 私鑰只存在 proxy 的記憶體中。
- MITM hook：例如對 `api.github.com` 的 `POST` / `PUT` 移除 `Authorization` header。
- **OS sandbox 負責確保「只能連到 proxy」，proxy 負責「連到哪裡」**。兩層缺一層都不完整。

### 5.5 Guardian 自動審查

`core/src/guardian/`：一個獨立、同步的 reviewer session。extension 決定政策與證據，core 負責強制執行權限與必要的審查。每個核准都保留發出時的上下文，也可以被取消。這與 Rakazo 的 auto-review 和 OpenMausBot 的「Approve for me」屬於同一類設計。

### 5.6 Codex 自身行程強化

`process-hardening` 在 `main()` 之前執行：關閉 core dump（`PR_SET_DUMPABLE=0` / `RLIMIT_CORE=0`）、macOS 用 `PT_DENY_ATTACH` 禁止 debugger attach、清除 `LD_*` / `DYLD_*`。目的是保護 Codex 行程記憶體中的 API key 與 token。

## 6. 設計邏輯總結

1. **預設全拒，逐項開放**：Seatbelt `(deny default)`、bwrap `--ro-bind / /`、seccomp 黑名單加 socket family 白名單。
2. **邊界本身要受保護**：`.git` / `.codex` / `.agents` 唯讀、禁止刪除或替換可寫 root、限定 `sandbox-exec` 與 bwrap 的來源路徑。
3. **政策是資料，平台實作是翻譯**：同一份 `PermissionProfile` 翻譯成 SBPL、bwrap 參數、Windows ACL / WFP。平台無法表達的政策就明確失敗，**不會默默放寬**。
4. **Sandbox（能力）與審批（何時問人）分開**，再疊上 execpolicy（逐指令規則）、guardian（LLM 審查）、network proxy（逐目的地規則）。
5. **失敗後才升級**：先在 sandbox 內嘗試，被拒才詢問是否不帶 sandbox 重跑；會讓安全失效的情況（拒讀）永遠不升級。
6. **向前相容**：未知的特殊路徑、未知的設定值都保留並警告，不讓舊版因新版設定而拒絕啟動。
7. **測試密度高**：`seatbelt_tests.rs` 約 2,700 行、`policy_transforms_tests.rs` 約 1,400 行，另有 Windows smoke test 腳本。

## 7. 優點與取捨

| 優點                                                               | 代價                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 使用 OS 原生機制，不需要 Docker 或 VM，啟動成本幾乎為零            | 三個平台三套實作，Windows 尤其複雜（需要提權 setup、專用帳號）            |
| 政策模型表達力強（deny > write > read、glob 拒讀、受保護中繼資料） | 語意在各平台不完全一致（Windows restricted token 只支援 workspace-write） |
| 網路以 namespace / proxy 雙層強制                                  | MITM 需要自簽 CA，並將憑證環境變數注入子行程                              |
| 拒絕偵測加提權重試，體驗流暢                                       | 拒絕偵測是啟發式判斷，可能誤判                                            |
