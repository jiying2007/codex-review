# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

在 VS Code 中使用本地 Codex CLI，仅针对 **Git 暂存区（staged）变更**进行 fail-closed、覆盖可证明的结构化代码审查。

Codex Review Safe 4.0 固定使用 **Codex Safe Core 4.0.0**，pin 到 `4dc4de836625a8b70084531eb3321734eca675d0`。仓库策略统一使用 HEAD 中已提交的 `.codex-safe.json`（`schemaVersion: 3`）；Policy v2 明确拒绝，不保留兼容 parser。

## 长期架构

```text
staged Git snapshot
      ↓
Safe Core Git / Policy / Process / Codex
      ↓
coverage-preserving Review Evidence Chunks
      ↓
Review domain
  exact changed-line validation
  confidence gate
  deterministic review rules
  diagnostics/report
      ↓
Review Receipt v4
```

产品仓只拥有 Review 领域逻辑。Process、通用 Git 原语、Repository Policy 结构、Safe Contract/Receipt 校验、Review Evidence Chunking、确定性规则语义和 Codex CLI 安全边界统一属于 `codex-safe-core`。

## 核心保证

- 只分析 staged changes；working-tree-only 修改不属于本次审查快照；
- HEAD + Git 原始 index 指纹防止 stale/TOCTOU；
- `.codex-safe.json.review` 固定读取捕获到的 HEAD，并按 Policy Schema v3 fail closed；
- Review Evidence Chunking 不再对 changed hunk 做静默 middle truncation：每个 hunk 要么进入审查，要么形成明确 coverage gap；
- 模型 finding 必须精确命中 post-change 新增/修改行；旧的 ±3 nearest-line relocation 已删除；
- `confidenceThreshold` 会在低置信度模型 finding 进入 Problems/verdict 前直接抑制；
- `.codex-safe.json.review.rules` 由 Safe Core 确定性执行，包括 forbidden path 与“代码改动必须有测试改动”；
- coverage 不完整或模型 finding 位置非法时 fail closed，Review verdict 阻断；
- Review Receipt v4 使用 `git-index` subject，绑定 HEAD/index/diff/policy 指纹以及 quality/readiness/mechanical/coverage verdict；
- Restricted Mode 在运行时拒绝，并由 Extension Host 测试覆盖；
- Codex 使用临时目录、read-only sandbox、no approval、忽略用户 rules/config，并在运行前执行能力探测；
- 不自动修改源码、Commit、Push 或创建 PR；
- Marketplace/Release 运行边界仅为 `dist/`，源码、测试、脚本、lockfile 和 submodule 元数据不进入 VSIX。

## Repository Policy

```json
{
  "schemaVersion": 3,
  "review": {
    "language": "zh-CN",
    "maxDiffBytes": 524288,
    "maxFindings": 40,
    "severityThreshold": "low",
    "confidenceThreshold": 0.7,
    "timeoutSeconds": 120,
    "extraInstructions": "重点关注正确性、并发、边界、错误处理和长期运行稳定性。",
    "rules": {
      "requireTestsForCodeChanges": true,
      "codePathPrefixes": ["src/"],
      "testPathPrefixes": ["test/", "tests/"],
      "forbiddenPathPrefixes": []
    }
  }
}
```

`maxDiffBytes` 是 **coverage-preserving chunking 使用的单次 Review evidence 预算**，不是原始 diff 拒绝阈值。原始 staged diff 仍有固定 8 MiB safety ceiling，完整原始 diff 继续用于确定性 fingerprint。

`safeCodexReview.codexPath` 为 machine scope，其余产品设置为 application scope。仓库策略不能选择 executable/model，也不能定义任意命令。

## 使用

1. Stage 准备审查的修改。
2. 从 Source Control 或 Command Palette 运行 **Codex Review Safe: Review Staged Changes**。
3. 精确命中 post-change changed line 的 finding 出现在 Problems；coverage gap、deterministic-rule violation 和 report-only evidence 保留在 Review report。
4. 修复、重新 Stage，再 Review，最后人工 Commit。

`qualityVerdict=no_findings` 只表示已审查 evidence 中未发现实质问题，不代表需求、构建、测试或人工审查已经就绪。

## 开发与发布

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run test:trust
npm run package
```

CI 覆盖 Linux/Windows/macOS 最新 VS Code、最低 VS Code `1.90.0`、zh-CN、Workspace Trust、dist-only VSIX 和 SHA-256。Release 还会在发布不可变 Tag/Release 前，对 VSIX 与 `SHA256SUMS` 生成 GitHub build-provenance attestation。

详见 [SECURITY.md](SECURITY.md)、[PUBLISHING.md](PUBLISHING.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Identity

- Publisher：`jiying2007`
- Extension：`codex-review-safe`
- ID：`jiying2007.codex-review-safe`
- Settings namespace：`safeCodexReview.*`
- Runtime entry：`./dist/extension.js`

## License

见 [LICENSE](LICENSE)。
