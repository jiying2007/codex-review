# Codex Review

简体中文 | [English](README.md)

Codex Review 在 VS Code Source Control 中提供保守、可靠的 **staged-only** 代码审查流程：将 Git 暂存区 diff 交给本地 Codex CLI，使用 Structured Output 获取结果，在本地完成 schema / 路径 / 行号校验，只把可安全定位的问题发布到 **Problems**，完整报告保留在 **Codex Review OutputChannel**。

> **为什么强调保守 / Safe？** 和配套的 [Codex Commit Safe](https://github.com/jiying2007/codex-commit) 一样，本扩展刻意保持窄信任边界：只使用 staged 输入、Structured Output、HEAD + raw index 一致性校验、最小 Codex 能力、不自动修改/提交/推送，并且对无法可靠定位的结果 fail-safe。

## 核心特性

- 从 Source Control 标题栏或 Command Palette 直接审查 **Git staged/index changes**。
- 本地 `codex exec` + Structured Output，模型结果先经过本地 schema 和路径验证。
- Verdict 本地确定：`critical/high -> block`，其他 finding -> `needs_attention`，无 finding -> `pass`。
- Inline Diagnostic 采用 fail-safe 策略：只有能够可靠映射到当前 working-tree 文件时才进入 Problems。
- 检测 dirty editor、unstaged changes、删除文件、binary、submodule、symlink 越界、纯 rename/copy、Git stale state 等边界。
- 多阶段 `HEAD + raw INDEX` snapshot 校验，审查过程中 Git 状态变化会丢弃旧结果。
- 存在 unresolved merge conflicts 时，在调用 Codex 前直接拒绝审查。
- Repository policy 固定到审查 snapshot 的 HEAD；本次 staged 修改 `.codex-review.json` 不会影响对自身的审查。
- 所有 VS Code Review policy 设置均为 application scope，workspace/folder settings 无法降低审查策略。
- 支持多仓库 workspace，每个 repository 独立维护 Problems 和报告。
- 仅支持 trusted local workspace；不支持 virtual workspace。

## 中英文支持

扩展 Manifest 使用 VS Code NLS：

- 英文：`package.nls.json`
- 简体中文：`package.nls.zh-cn.json`

命令标题、配置说明、Capability 描述、Marketplace 元数据、进度提示、报告说明、环境检查和运行时错误都会通过 VS Code NLS 与 `vscode.l10n` 跟随 VS Code UI 语言自动切换。

审查结果语言由 `codexReview.language` 独立控制：

- `zh-CN`：审查摘要/findings 使用简体中文
- `en`：审查摘要/findings 使用英文

因此可以做到：英文 VS Code + 中文审查结果，或者中文 VS Code + 英文审查结果。

## 环境要求

- VS Code `1.90.0+`
- Git
- 已安装并可正常使用的本地 Codex CLI

检查 Codex：

```bash
codex --version
```

## 安装

从 GitHub Releases 下载 VSIX：

```bash
code --install-extension codex-review-*.vsix
```

## 使用

1. 在 Source Control 中 Stage 准备提交的修改。
2. 点击 Source Control 标题栏中的 **Codex Review**，或执行 **Codex Review: 审查 Staged Changes**。
3. 可可靠定位的 findings 显示在 **Problems**。
4. 完整报告、report-only finding 和原因显示在 **Codex Review OutputChannel**。
5. 文件继续编辑或 HEAD/index 变化后，旧 inline diagnostics 会自动失效。

## 配置

以下配置全部为 application-scoped User Settings：

| Setting | Default | 说明 |
|---|---:|---|
| `codexReview.codexPath` | `codex` | Codex CLI 可执行路径 |
| `codexReview.model` | empty | 可选模型覆盖 |
| `codexReview.language` | `zh-CN` | 审查结果语言：`zh-CN` / `en` |
| `codexReview.maxDiffBytes` | `524288` | 发送给 Codex 的最大 staged diff 字节数 |
| `codexReview.maxFindings` | `40` | 最大 accepted findings 数量 |
| `codexReview.severityThreshold` | `low` | Problems/报告显示的最低严重级别 |
| `codexReview.timeoutSeconds` | `120` | Codex 超时时间 |
| `codexReview.extraInstructions` | empty | 用户级附加审查要求 |

## Repository Review Policy

仓库可以提交 `.codex-review.json` 作为团队规则。插件从**审查 snapshot 对应的精确 HEAD OID**读取 policy，而不是读取 working tree/index 中的新版本。

```json
{
  "language": "zh-CN",
  "maxDiffBytes": 524288,
  "maxFindings": 40,
  "severityThreshold": "low",
  "timeoutSeconds": 120,
  "extraInstructions": "重点关注资源泄漏、并发、越界、错误处理和嵌入式长期运行稳定性。"
}
```

如果本次 staged changes 同时修改 `.codex-review.json`，当前审查仍使用提交前 HEAD 中的旧规则；新规则提交后生效。

## 安全模型

Codex Review 从临时目录调用 Codex，并使用受控非交互请求，包括：

- `--json`
- `--output-schema`
- `--ephemeral`
- `--ignore-user-config`
- `--ignore-rules`
- `--sandbox read-only`
- `--ask-for-approval never`

同时在支持的情况下关闭不需要的 shell/app/hook/goal/memory/plugin 能力。Finding 文件路径和行号会在发布 Diagnostic 前由本地代码验证。

> Staged diff 会离开本机发送给 Codex 推理，请遵守组织的源代码和数据策略。

完整信任边界和发布供应链说明见 [SECURITY.md](SECURITY.md)。

## 开发

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run package
```

## CI / Release

CI 会验证：

- lockfile 完整性；
- unit/regression tests；
- Linux / Windows / macOS 最新 VS Code Extension Host；
- Ubuntu 上最低支持版本 VS Code `1.90.0`；
- 官方 `@vscode/vsce` 打包；
- VSIX 内容和 SHA-256。

Release tag 必须符合 `vMAJOR.MINOR.PATCH`，与 `package.json.version` 一致，并且对应 commit 必须可从 `main` 追溯。只有最终 release job 拥有仓库写权限。

详见 [PUBLISHING.md](PUBLISHING.md)。


## 扩展身份

- 仓库：`codex-review`
- Extension name：`codex-review`
- Display name：**Codex Review**
- Publisher/VSIX ID：`jiying2007.codex-review`
- 命令/配置 namespace：`codexReview.*`
- 配套扩展：**Codex Commit Safe**（`jiying2007.codex-commit-safe`）
- Marketplace 状态：**尚未发布**；当前以 GitHub Releases 为正式分发渠道

技术 Extension ID 和 namespace 保持稳定，后续发布 VS Code Marketplace 时不会切断现有 GitHub/VSIX 用户的升级链路。

## License

MIT
