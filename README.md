# Codex Review

在 VS Code Source Control 中使用本地 Codex CLI 审查 **staged changes**，将可信定位的问题发布到 Problems，并在 OutputChannel 中保留完整审查报告。

## 特性

- 直接集成 VS Code Source Control，可从 SCM 标题栏发起审查。
- 只审查 Git staged/index 内容，不读取未暂存改动作为审查输入。
- 使用本地 `codex exec` + Structured Output，结果经过本地 schema 和路径校验。
- critical/high 自动判定为 `block`，其他 finding 为 `needs_attention`，无 finding 为 `pass`。
- Finding 只有在能够可靠映射到本次 staged changed line 时才进入 Problems；否则保留为 report-only。
- 检测 dirty editor、unstaged changes、删除文件、binary、submodule、symlink、纯 rename/copy 等边界，宁可不做 inline 定位，也不显示可能错行的 Diagnostic。
- HEAD + raw INDEX 多阶段 snapshot 校验，审查过程中 Git 状态变化会丢弃旧结果。
- 存在 unresolved merge conflicts 时拒绝审查。
- Review policy 固定到审查开始时的 HEAD；本次 staged 修改 `.codex-review.json` 不会影响对自身的审查。
- VS Code Review 设置均为 User/Application scope，workspace/folder 无法降低审查策略。
- 支持多仓库 workspace，每个 repository 独立维护 Problems 和报告。
- Workspace 必须 trusted；virtual workspace 不支持。

## 要求

- VS Code `1.90.0+`
- Git
- 已安装并可正常使用的 Codex CLI

检查 Codex CLI：

```bash
codex --version
```

## 安装

从 GitHub Releases 下载 `codex-review-*.vsix` 后：

```bash
code --install-extension codex-review-*.vsix
```

## 使用

1. 在 Source Control 中 Stage 需要提交的修改。
2. 点击 SCM 标题栏的 **Codex Review** 按钮，或打开 Command Palette 执行 `Codex Review: 审查 Staged Changes`。
3. 审查完成后：
   - 可可靠定位的问题显示在 **Problems**；
   - 完整 finding、report-only 原因和 verdict 显示在 **Codex Review OutputChannel**。
4. Git HEAD/INDEX 或文件内容变化后，旧 inline diagnostics 会自动失效。

## 配置

User Settings 支持：

| Setting | Default | Description |
|---|---:|---|
| `codexReview.codexPath` | `codex` | Codex CLI 路径 |
| `codexReview.model` | empty | 可选模型，空值使用 CLI 默认 |
| `codexReview.language` | `zh-CN` | `zh-CN` / `en` |
| `codexReview.maxDiffBytes` | `524288` | 最大 staged diff 字节数 |
| `codexReview.maxFindings` | `40` | 最大 findings 数量 |
| `codexReview.severityThreshold` | `low` | Problems/报告显示阈值 |
| `codexReview.timeoutSeconds` | `120` | Codex 超时 |
| `codexReview.extraInstructions` | empty | 用户级附加审查要求 |

这些设置为 `application` scope，仓库中的 `.vscode/settings.json` 无法覆盖。

## Repository Review Policy

仓库可提交 `.codex-review.json` 作为团队规则。审查时使用 **当前稳定 snapshot 对应 HEAD 中的版本**，而不是 working tree/index 里的新版本。

示例：

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

## 安全边界

Codex Review 调用 Codex 时保持受控非交互模式，包括：

- `--json`
- `--output-schema`
- `--ephemeral`
- `--ignore-user-config`
- `--ignore-rules`
- `--sandbox read-only`
- `--ask-for-approval never`

同时关闭不需要的 shell/apps/hooks/goals/memories 等能力。详细说明见 [SECURITY.md](SECURITY.md)。

> Staged diff 会发送给 Codex 进行推理。请遵守组织的代码、隐私和数据策略。

## 开发

```bash
npm ci --ignore-scripts
npm run check
npm run test:integration
npm run package
```

## GitHub Actions / Release

- `CI`：Linux + Windows 单元/Extension Host 测试，并生成 VSIX artifact。
- `Release`：推送 `v*` tag 后重新跑 Linux + Windows 验证，使用官方 `@vscode/vsce` 打包，并创建 GitHub Release，附带 VSIX 与 SHA256。

正式发布由 `v*` tag 触发，校验 `package.json` 版本后自动创建 GitHub Release。

## License

MIT
