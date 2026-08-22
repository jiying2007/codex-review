# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

在 VS Code 中只审查 **Git 暂存区变更**，把经过本地严格校验的 findings 转换为版本化质量凭据，同时不把仓库控制权交给模型。

Codex Review Safe 是 **Codex Safe Git Workflow** 产品族的质量门禁阶段：

```text
Codex Review Safe
      ↓ Review Receipt v2
Codex Commit Safe
      ↓ Commit Receipt v2
Codex PR Safe
      ↓ 可验证 PR provenance
```

所有共享安全与运行时基础设施只来自固定 commit 的 [`codex-safe-core`](https://github.com/jiying2007/codex-safe-core) Git submodule。

## 核心能力

- 只审查 staged/index changes。
- Review findings 支持简体中文和英文。
- 使用 Safe Core Semantic Context Budget，不再做“取前 N 字节”的粗暴截断。
- 对每个 finding 做本地 schema、severity、category、file、line range、confidence 校验。
- 低于 `confidenceThreshold` 的 finding 在影响 Problems、verdict、receipt 之前就被 suppressed。
- 只有能安全映射到当前文件的位置才发布为 Problems Diagnostic。
- 无法安全定位的 finding 保留在完整报告中，而不是强行发布 inline diagnostic。
- 使用 HEAD + Git 原始 index snapshot 防止 stale result。
- **质量结论**与**交付就绪结论**严格分离。
- 持久化与 HEAD、index、完整 diff、policy fingerprint 绑定的 Review Receipt v2。
- 通过只读 API 向 Commit/PR 配套扩展提供 range evidence。

## 明确不会做的事

- 不修改源码。
- 不自动 commit 或 push。
- 不自动创建/提交 Pull Request。
- 不给 Codex Shell 权限。
- 不给 Codex 网络/Web Search 权限。
- 不把“无 findings”解释为需求、构建或测试已经通过。

## 安全边界

Safe Core v2 要求 Codex CLI 具备：

- `--ask-for-approval never`
- `exec --json`
- ephemeral execution
- 本次请求忽略用户/项目 Codex rules
- read-only sandbox
- Structured Output schema
- 显式关闭 shell、unified exec、web search、apps、hooks、memories、multi-agent 等无关能力

缺失必要安全能力时直接 fail closed 并要求升级；**不存在 legacy CLI fallback**。

完整 staged diff 保留在本地，用于 fingerprint、line mapping 和 Review Receipt evidence；模型输入单独经过 Safe Core Semantic Context Budget：

- source 文件公平分配预算；
- generated/lock 文件只保留元数据；
- binary 文件只保留元数据；
- 过大的 source 文件保留受控头尾上下文；
- 原始 staged diff 固定 8 MiB 安全上限。

## Finding 精度门禁

每个 finding 都有 `0~1` 的 `confidence`。默认 `confidenceThreshold=0.70`。

```text
model finding
    ↓ schema/path validation
confidence >= threshold?
    ├─ 是 → finding → diagnostic/verdict/receipt
    └─ 否 → suppressed finding
```

Suppressed findings 不影响 `qualityVerdict` 或 Review Receipt。目标是优先保证证据充分、误报率低，而不是追求 finding 数量。

## 唯一仓库策略文件

仓库只认 `.codex-safe.json`，且必须使用 `schemaVersion: 2`。

```json
{
  "$schema": "https://raw.githubusercontent.com/jiying2007/codex-safe-core/d49dc356824b984166e81e42bb5f9d7abfb90099/codex-safe.schema.json",
  "schemaVersion": 2,
  "review": {
    "language": "zh-CN",
    "maxDiffBytes": 524288,
    "maxFindings": 40,
    "severityThreshold": "low",
    "confidenceThreshold": 0.7,
    "timeoutSeconds": 120,
    "extraInstructions": "重点关注正确性、资源生命周期、并发、边界和错误处理。"
  }
}
```

只使用 **HEAD 中已提交的策略**。staged 的策略修改不能降低对自身的 Review 门禁，而是在提交后生效。

仓库策略不能配置 Codex executable、model、environment、working directory 或任意命令。`safeCodexReview.codexPath` 为 machine scope，其余用户偏好为 application scope。

`maxDiffBytes` 表示**模型 Semantic Context 预算**，不是原始 diff 的拒绝阈值。

## Verdict 与 Receipt

Review Safe 分离两个维度：

- `qualityVerdict`：`no_findings` / `findings_open` / `blocked`；
- `readinessVerdict`：只基于独立交付证据，不会声称需求/构建/测试已经完成。

Review Receipt v2 记录精确的 HEAD、index、diff、policy fingerprint，以及 quality/readiness/mechanical-gate 与执行元数据。

Commit Safe 只有在 Receipt 与当前精确 staged snapshot 匹配时才消费它；PR Safe 后续还会把 Review Receipt 与真正提交后的 first-parent diff 重新验证。

## Diagnostic 安全策略

即使 finding 通过结构化校验，也可能只进入报告，不发布 Problems。例如：

- 删除文件；
- binary 文件；
- submodule change；
- dirty editor；
- staged 文件同时存在 unstaged overlay；
- symlink 指向仓库外；
- rename/copy 但无内容变更；
- 行号无法安全映射。

这样可以保持 Problems 界面保守可信，同时不丢失完整 Review evidence。

## 使用

1. Stage 准备审查的修改。
2. 打开 **Source Control**。
3. 执行 **Codex Review Safe: 审查 Staged Changes**。
4. 在 **Problems** 查看能安全定位的 findings。
5. 执行 **显示审查报告** 查看完整结果。
6. 修复、重新 Stage，再次 Review。
7. 手工 Commit，或继续使用 Codex Commit Safe。

**清除审查结果**会同时清理本机持久化的 Review Receipt 历史。

## 环境要求

- VS Code `1.90.0` 或更高版本
- Git
- 在工作区 Extension Host 所在环境安装并登录 OpenAI Codex CLI

## 构建与测试

```bash
git submodule update --init --recursive
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run test:trust
npm run package
```

Marketplace / Release 运行入口统一为 `dist/extension.js`。VSIX 只包含 `dist/` 下的确定性生产运行时、`dist/codex-safe.schema.json`、本地化、图标和发布文档；源码、tests、scripts、submodule metadata 一旦进入 VSIX，CI 直接失败。

CI 门禁包括：

- static/contract/module-boundary；
- unit/regression；
- Linux / Windows / macOS Extension Host；
- 最低 VS Code `1.90.0`；
- 简体中文本地化 smoke；
- 真实 Workspace Trust / Restricted Mode；
- 官方 VSIX 边界审计与 SHA-256。

## 发布完整性

`main` 上版本变更触发完整 Release gate。只有 validation 与 integration 全部通过后才创建不可变 Tag 和 GitHub Release。

发布资产包括：

- `codex-review-safe-<version>.vsix`
- `SHA256SUMS`
- 两个资产对应的 GitHub build-provenance attestation

只有最终 Release job 拥有 `contents: write`、`id-token: write`、`attestations: write`；其他验证 job 只读。Actions 使用完整 commit SHA 固定。

详见 [SECURITY.md](SECURITY.md)、[CONTRIBUTING.md](CONTRIBUTING.md)、[PUBLISHING.md](PUBLISHING.md)。

## 产品族边界

| 产品 | 职责 | 明确不做 |
| --- | --- | --- |
| **Codex Review Safe** | staged-change 质量门禁 + Review Receipt | 写代码 / commit |
| Codex Commit Safe | Commit Message + 可验证 Commit Receipt | commit / push |
| Codex PR Safe | PR narrative + provenance | push / 自动提交 PR |

设计原则：**AI 辅助 Git 工作流，但不把 Git 控制权交给 AI。**

## License

MIT
