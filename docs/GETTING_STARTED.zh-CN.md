# Codex Review Safe 快速开始

## 1. 安装环境

在 VS Code workspace Extension Host 所在环境安装 VS Code 1.90+、Git 和 OpenAI Codex CLI：

```bash
codex --version
```

使用官方 OpenAI 时，可继续在该环境完成 Codex 登录：

```bash
codex login
```

Remote SSH、Dev Containers、Codespaces、WSL 必须在对应远端环境安装 Codex。插件运行在 workspace Extension Host 中，因此 Codex 可执行文件和 Provider 凭据都必须对该 Extension Host 可见。

## 2. 安装插件

从 VS Code Marketplace 安装 `jiying2007.codex-review-safe`，或安装 GitHub Release 中 immutable VSIX。

## 3. 使用 OpenAI-compatible 中转站

Codex Review Safe 为保持 Safe Contract，会主动使用 `--ignore-user-config`，因此**不会读取 `~/.codex/config.toml` 中的中转站/provider 配置**。普通终端 Codex 可以继续使用该文件，但 Review Safe 必须显式配置 Provider。

在 VS Code User Settings JSON 中配置：

```json
{
  "safeCodexReview.providerMode": "openai-compatible",
  "safeCodexReview.providerBaseUrl": "https://relay.example.com/v1",
  "safeCodexReview.providerApiKeyEnv": "CODEX_RELAY_API_KEY",
  "safeCodexReview.model": "gpt-5.2"
}
```

其中：

- `providerBaseUrl` 必须是 HTTPS base URL，不要在 URL 中放用户名、密码、query 或 fragment；
- `providerApiKeyEnv` 填的是**环境变量名**，不是 API Key 本身；
- `model` 可留空使用 Provider 默认模型；若中转站有自己的模型别名，建议显式填写；
- 中转站必须兼容 OpenAI **Responses API**（`/v1/responses`）和 SSE/Structured Output，仅兼容 `/v1/chat/completions` 不足以保证可用；
- compatible Provider 固定走 Responses HTTP/SSE，不走 WebSocket。

### 让 Key 对 VS Code Extension Host 可见

Linux/macOS：

```bash
export CODEX_RELAY_API_KEY="sk-xxxx"
code .
```

Windows PowerShell：

```powershell
$env:CODEX_RELAY_API_KEY="sk-xxxx"
code .
```

如果 VS Code 已经启动，之后只在集成终端执行 `export` / `$env:...`，不会把变量反向注入已经运行的 Extension Host。请完全退出并从带有该环境变量的进程重新启动 VS Code。

Remote SSH、WSL、Dev Containers、Codespaces 场景中，Key 必须配置在**远端 Extension Host 所在环境**，而不是只配置在本机桌面系统。

如果 Commit Safe、Review Safe、PR Safe 使用同一个中转站，可以让三个插件的 `providerApiKeyEnv` 都指向同一个 `CODEX_RELAY_API_KEY`。

## 4. 先检查环境

打开可信 Git workspace，运行：

**Codex Review Safe: 检查 Codex 环境**

新版 Environment Check 不只检查 Codex CLI/capability，还会使用与真实 Review 相同的 Safe Runtime/Provider 配置执行一次最小结构化模型 round-trip。只有该检查成功，才表示 Extension Host、凭据、中转站、Responses API、模型与 Structured Output 链路真实可用。

常见 Provider 错误会区分 DNS、连接、TLS、认证、429、模型和请求超时。不要把 Provider/DNS 问题通过单纯增加 Review timeout 掩盖掉。

## 5. 第一次 Review

```bash
git status --short
git add <files>
git diff --cached --stat
```

然后执行 **Review Staged Changes**。只审查 staged snapshot；未 stage 的修改刻意忽略。

## 6. 可选仓库 Policy

可在目标分支提交 `.codex-safe.json`，配置语言、Evidence Budget、阈值与确定性 Rules。Policy 修改只有 Commit 后才生效。

## 常见问题

### 终端 Codex 能用，中转站 Review 仍失败

先确认 VS Code Settings 中 `safeCodexReview.providerMode` 为 `openai-compatible`，而不是只在 `~/.codex/config.toml` 配置中转站；再确认 Key 环境变量对 Extension Host 可见，并重新运行 **检查 Codex 环境**。

### 日志仍访问 `api.openai.com`

中转站模式不应回退到官方 endpoint。检查 `providerMode`、`providerBaseUrl`、`providerApiKeyEnv` 和 Extension Host 环境后重新启动 VS Code；不要仅提高 timeout。

### 中转站只支持 Chat Completions

Review Safe 的兼容 Provider 需要 Responses API。若中转站只实现 `/v1/chat/completions`，需要中转站补齐 Responses API 兼容层。

### 没有 staged changes

先 `git add`。Review Safe 不审查 working-tree-only 修改。

### 找不到 Codex

在 VS Code workspace 相同 local/remote 环境执行 `codex --version`；必要时设置 `safeCodexReview.codexPath`。

### Restricted Mode

先信任 workspace。Restricted Mode 下 Review 被设计为直接拒绝。

### Coverage incomplete

某个 changed hunk 无法在当前 Evidence Limits 内覆盖时会 fail closed。应拆小变更，或在评估风险后调整仓库 Policy。

## 升级

Marketplace 更新或替换为新版 immutable VSIX，Reload VS Code 后先运行一次 **检查 Codex 环境**，再开始 Review。
