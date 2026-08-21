# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

在 VS Code 中使用本地 Codex CLI，仅针对 **Git 暂存区变更**生成安全、结构化的代码审查结果。

> **为什么叫 “Safe”？** Codex Review Safe 是 [Codex Commit Safe](https://github.com/jiying2007/codex-commit) 的代码审查配套扩展。两者统一采用 staged-only 输入、Structured Output、HEAD + raw index 一致性校验、最小 Codex 能力集、fail-closed 行为，并且都不会自动修改源码、Commit 或 Push。

## 主要能力

- VS Code Source Control 一键审查 staged changes
- **只审查 Git 暂存区**（`git diff --cached`）
- 审查结果支持 **简体中文 / 英文**
- 命令、设置、进度、警告、报告、错误完整支持 **中英文 UI**
- VS Code UI 语言与审查结果语言相互独立
- Codex Structured Output + 本地严格 schema / path 校验
- Problems 保守发布：只有能安全映射到当前 working tree 的问题才发布 inline Diagnostic
- 使用 HEAD + raw Git index snapshot 防止 stale result 和 TOCTOU
- `.codex-review.json` 固定读取捕获到的 HEAD，因此 staged 规则修改不能降低对自身的审查
- 报告展示精确 HEAD、raw index、staged diff 指纹以及 Codex 执行元数据
- staged 文件同时存在更新的 unstaged 修改时，明确提示这些最新修改尚未被审查
- dirty editor、unstaged changes、删除文件、binary、submodule、symlink 越界、纯 rename/copy、无法安全定位的行号全部 fail-safe 为 report-only
- Windows `.exe` / `.cmd` / `.bat`、Linux、macOS 均由 CI 覆盖
- 永远不会自动修改源码、Commit、Push 或创建 PR

## 中英文支持

VS Code UI 自动跟随编辑器语言：

- 英文 VS Code → 英文命令/提示/报告
- 简体中文 VS Code → 中文命令/提示/报告

审查结果语言独立配置：

```json
{
  "safeCodexReview.language": "zh-CN"
}
```

或：

```json
{
  "safeCodexReview.language": "en"
}
```

因此中文 VS Code 可以输出英文 Review，英文 VS Code 也可以输出中文 Review。

## 工作流

```text
Stage changes
    ↓
VS Code Source Control
    ↓
Codex Review Safe
    ↓
本地 Codex CLI
    ↓
Structured review result
    ↓
本地安全校验
    ↓
Problems + 完整审查报告
```

## 安全模型

Codex Review Safe 有意保持较小的执行和信任边界：

- 只把 staged diff 发送给 Codex 推理；
- Codex 在临时目录执行，而不是项目仓库目录；
- 本次 Review 忽略用户 Codex config 和项目执行规则；
- 在 CLI 支持的情况下显式关闭不需要的 Codex 能力；
- 使用 read-only sandbox，并关闭 approval；
- 模型输出必须通过严格的本地 schema、路径和范围校验；
- 仓库状态使用 **HEAD OID + SHA-256(raw `git ls-files --stage -z`)** 表示；
- 在输入采集前后、Codex 返回后、Problems 发布后都进行 snapshot 校验；
- HEAD/index 发生变化或新 Review 覆盖旧 Review 时，旧结果直接丢弃；
- workspace/folder settings 不能降低 Review policy；
- `.codex-review.json` 从捕获到的精确 HEAD OID 中读取；
- operational log 不记录源码、staged diff、审查内容、secret 或仓库绝对路径。

组织级 Codex 策略、MDM、managed hooks 和云端策略仍可能具有更高优先级，扩展不会尝试绕过组织策略。

> staged diff 会离开本机并发送到所配置的 Codex 服务。请确保符合所在组织的源码和数据使用规范。

完整说明见 [SECURITY.md](SECURITY.md)。

## 环境要求

- VS Code `1.90.0` 或更高版本
- Git
- 已安装并登录 OpenAI Codex CLI

先确认：

```bash
codex --version
```

## 安装

从 GitHub Release 下载 VSIX：

```bash
code --install-extension codex-review-safe-1.0.1.vsix
```

或在 VS Code 中：

```text
Extensions → ... → Install from VSIX...
```

然后运行：

```text
Ctrl+Shift+P → Codex Review Safe: 检查 Codex 环境
```

## 使用方法

1. Stage 需要审查的修改。
2. 打开 **Source Control**。
3. 运行 **Codex Review Safe: 审查 Staged Changes**，或点击 Source Control 工具栏按钮。
4. 能安全定位的问题会出现在 **Problems**。
5. 使用 **Codex Review Safe: 显示审查报告** 查看完整报告，包括 report-only 问题和原因。
6. 修复问题、重新 Stage，再重新 Review，最后手动 Commit。

报告只描述 staged 快照。如果已暂存文件同时还有未暂存修改，报告会列出该 overlay，并明确最新 working-tree 版本尚未被审查。重新 Review 前应先 Stage 准备提交的修复。

## 项目配置

仓库可以提交 `.codex-review.json`：

```json
{
  "language": "zh-CN",
  "maxDiffBytes": 524288,
  "maxFindings": 40,
  "severityThreshold": "low",
  "timeoutSeconds": 120,
  "extraInstructions": "重点关注正确性、资源泄漏、并发、边界检查、错误处理和长期运行稳定性。"
}
```

项目规则不能设置 Codex 可执行文件、模型、环境变量、工作目录或任意命令。Review policy 从本次 Review 捕获到的精确 HEAD 中读取，因此 staged 的规则修改只会在提交后生效。

所有 `safeCodexReview.*` VS Code 设置都是 application-scoped User Settings。

## 扩展身份

- 仓库：`codex-review`
- Extension name：`codex-review-safe`
- Display name：**Codex Review Safe**
- Publisher/VSIX ID：`jiying2007.codex-review-safe`
- 命令/设置 namespace：`safeCodexReview.*`
- 仓库规则：`.codex-review.json`
- 配套扩展：**Codex Commit Safe**（`jiying2007.codex-commit-safe`）
- Marketplace：**暂未发布**，当前通过 GitHub Releases 分发

## 开发

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run package
```

CI 会验证 Linux/Windows/macOS 最新 VS Code、VS Code `1.90.0` 最低兼容、Extension Host 中的简体中文本地化 smoke、源码与双语 l10n key 一致性、官方 VSIX 内容和 SHA-256。

发布流程见 [PUBLISHING.md](PUBLISHING.md)。

## License

见 [LICENSE](LICENSE)。
