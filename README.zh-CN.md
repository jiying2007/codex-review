# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

在 VS Code 中使用本地 Codex CLI，仅针对 **Git 暂存区（staged）变更**进行安全、结构化代码审查。

Codex Review Safe 2.1 使用 **Codex Safe Core 2.1** 作为唯一共享 Core。仓库策略统一使用 HEAD 中已提交的 `.codex-safe.json`（`schemaVersion: 2`），其中 `review` section 在进入产品逻辑前由 Safe Core 统一执行 fail-closed 校验。

## 长期架构

```text
staged Git snapshot
      ↓
Safe Core Git / Policy / Process / Codex / Context
      ↓
Review domain
  finding validation
  confidence gate
  diagnostics/report
      ↓
Review Receipt v2
```

产品仓只拥有 Review 领域逻辑。Process、通用 Git 原语、Repository Policy 结构、Safe Contract/Receipt、Semantic Context 和 Codex CLI 安全边界统一属于 `codex-safe-core`。

## 核心保证

- 只分析 staged changes；working-tree-only 修改不属于本次审查快照；
- HEAD + Git 原始 index 指纹防止 stale/TOCTOU；
- `.codex-safe.json.review` 固定读取捕获到的 HEAD，并 fail closed；
- `confidenceThreshold` 会在低置信度 finding 进入 Problems/verdict 前直接抑制；
- source diff 使用 Semantic Context 预算，generated/lock/binary 采用保守元数据表示；
- Review Receipt v2 绑定 HEAD/index/diff/policy 指纹，只代表 AI Review evidence，不代表人工批准、需求验收或测试通过；
- Restricted Mode 在运行时拒绝，并由 Extension Host 测试覆盖；
- Codex 使用临时目录、read-only sandbox、no approval、忽略用户 rules/config，并在运行前执行能力探测；
- 不自动修改源码、Commit、Push 或创建 PR；
- Marketplace/Release 运行边界仅为 `dist/`，源码、测试、脚本、lockfile 和 submodule 元数据不进入 VSIX。

## Repository Policy

```json
{
  "schemaVersion": 2,
  "review": {
    "language": "zh-CN",
    "maxDiffBytes": 524288,
    "maxFindings": 40,
    "severityThreshold": "low",
    "confidenceThreshold": 0.7,
    "timeoutSeconds": 120,
    "extraInstructions": "重点关注正确性、并发、边界、错误处理和长期运行稳定性。"
  }
}
```

`maxDiffBytes` 是**模型 Semantic Context 预算**，不是用户可调的原始 diff 拒绝阈值。原始 staged diff 使用固定 8 MiB safety ceiling，完整原始 diff 仍用于确定性 fingerprint。

`safeCodexReview.codexPath` 为 machine scope，其余产品设置为 application scope。仓库策略不能选择 executable/model，也不能定义任意命令。

## 使用

1. Stage 准备审查的修改。
2. 从 Source Control 或 Command Palette 运行 **Codex Review Safe: Review Staged Changes**。
3. 可安全定位的 finding 出现在 Problems；完整 finding 与 report-only 原因可在 Review report 查看。
4. 修复、重新 Stage，再 Review，最后人工 Commit。

`qualityVerdict=no_findings` 只表示输入 diff 中未发现实质问题，不代表需求、构建、测试或人工审查已经就绪。

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
