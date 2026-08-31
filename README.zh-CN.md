# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

在 VS Code 中使用本地 Codex CLI，对 **Git staged changes** 做结构化代码审查；确定性规则、精确 changed-line 校验、fail-closed coverage，以及具备真实执行 provenance 的独立复审都在本地完成。

## 快速开始

适合在 **Commit 之前**做质量门禁，同时不把源码修改、Commit、Push 或创建 PR 的权限交给 AI。

环境要求：

- VS Code 1.90.0+
- Git
- 在 VS Code Extension Host 所在环境安装并登录 OpenAI Codex CLI
- 已信任、本地文件系统 Git workspace

Remote SSH、Dev Containers、Codespaces、WSL 场景下，需要在对应远端环境安装/登录 Codex，并在那里配置 `safeCodexReview.codexPath`。

### 第一次成功 Review

1. Stage 本次要审查的文件。
2. 先运行一次 **Codex Review Safe: 检查 Codex 环境**。
3. 从 Source Control 或 Command Palette 运行 **Codex Review Safe: Review Staged Changes**。
4. 在 Problems 查看精确行 Finding，在 Review report 查看完整 coverage/rules/evidence/provenance。
5. 修复后重新 Stage、重新 Review，最后人工 Commit。

仅 working-tree 修改不会进入本次 Review Snapshot，这是刻意的产品边界。

完整安装、配置和故障排查见 [Getting Started](docs/GETTING_STARTED.zh-CN.md)。

## Fresh 与 Independent Review

Codex Review Safe 明确区分不可变审查对象与每一次真正执行的模型审查：

- `ReviewSubjectKey` 回答“**正在审什么**”；
- `ReviewRunId` 标识“**这一次真实发生的 fresh 模型执行**”；
- 确定性 Semantic Evidence 可以通过 Evidence Cache 复用；
- 上一轮模型 judgment 永远不会作为 fresh reviewer 的输入；
- 相同 subject 的旧结果如果只是 replay，会明确标记 `[result-replay]`，且不会产生新的 lineage run、convergence run 或 Review Receipt；
- **Independent Review Staged Changes / 独立复审 Staged Changes** 会强制执行新的 blind 模型推理，同时仍允许复用确定性 Evidence。

默认 convergence 至少需要同一 subject 的两次 fresh、blind Run。如果两个独立 reviewer 不一致，系统会保留 disagreement 并维持 `incomplete`，不会为了制造“稳定”而压掉新 Finding。

完整 ReviewSubject/ReviewRun、缓存、lineage 与 provenance 契约见 [Review 收敛机制](docs/REVIEW_CONVERGENCE.zh-CN.md)。

## 核心保证

- 只审查 staged snapshot，并绑定 HEAD + Git 原始 index fingerprint；
- `.codex-safe.json` 固定读取 committed HEAD，使用 Policy Schema v4；
- Review Evidence Chunking 不静默丢 changed hunk，无法覆盖时形成明确 coverage gap；
- Deterministic Evidence Cache 与 Model Judgment Replay 分离；
- Independent Review 强制 fresh blind inference，不读取上一轮 accepted findings / suppressed hypotheses 作为 reviewer 输入；
- convergence 依赖真实 fresh provenance，而不是“缓存输出完全一致”；
- 模型 Finding 必须精确命中 post-change changed line；
- Repository Rules 在模型之外确定性执行；
- 低置信度 Finding 在进入 Problems/verdict 前过滤；
- coverage 不完整或 Finding 无法验证时 fail closed；
- Review Receipt v4 只为真实 fresh Review 执行记录 immutable evidence/provenance；
- Restricted Mode 直接拒绝；
- Safe Contract v2 使用 ephemeral、read-only、no approval，并显式关闭 shell/web/apps/multi-agent/plugins/hooks/goals/memories/dependency install；
- 不自动修改源码、Commit、Push 或创建 PR。

共享安全/runtime 与 Repository Policy 校验只来自精确 commit-pinned 的 **Codex Safe Core 4.10.0**，SHA 为 `57440a00030941020d5c3e9e01ced3c06062f42e`。

## 正确理解 Readiness

报告把三类结论拆开：

- `Defect verdict`：是否存在已经证据验证的代码 Finding；
- `Evidence readiness`：Semantic Review / Coverage 是否完整；
- `Overall readiness`：当前证据是否足以宣布交付就绪。

因此 `no_findings` 可以与“仍缺构建/HIL/需求证据”同时成立，不会再让证据不足看起来像发现了代码缺陷。

## Repository Policy

唯一仓库策略文件是 committed `.codex-safe.json`，必须使用 `schemaVersion: 4`。Safe Core 统一拥有闭合的 `commit`、`review`、`change`、`reviewService` section；Review Safe 只消费自身相关的 Review Policy，Change 的交付解释仍由 Codex Change Safe 负责。

```json
{
  "$schema": "https://raw.githubusercontent.com/jiying2007/codex-safe-core/57440a00030941020d5c3e9e01ced3c06062f42e/codex-safe.schema.json",
  "schemaVersion": 4,
  "review": {
    "language": "zh-CN",
    "maxDiffBytes": 524288,
    "maxFindings": 40,
    "severityThreshold": "low",
    "confidenceThreshold": 0.7,
    "timeoutSeconds": 120,
    "rules": {
      "requireTestsForCodeChanges": true,
      "codePathPrefixes": ["src/"],
      "testPathPrefixes": ["test/", "tests/"],
      "forbiddenPathPrefixes": []
    }
  },
  "change": {}
}
```

`maxDiffBytes` 是模型/evidence 预算，不是原始 staged diff 拒绝阈值；完整原始 diff 继续用于确定性 fingerprint。

## Family 工作流

```text
staged changes
    ↓
Codex Review Safe → Review Receipt v4
    ↓
Codex Commit Safe → Commit Receipt v4
    ↓
人工 git commit / push
    ↓
Codex Change Safe → Change Receipt v1
    ↓
GitHub PR / GitLab MR
```

每个产品都可以独立使用。**Codex PR Safe** 仅作为旧的模型生成 PR 描述产品身份退役；**Codex Change Safe** 是确定性的后继交付阶段，并不会恢复旧 Narrative Generator。

## 安装、升级与验证

可从 VS Code Marketplace 安装，或安装 GitHub Release 中 immutable VSIX。升级后第一次使用建议先执行 **检查 Codex 环境**。

Release 只构建一份 VSIX，并提供 checksum + provenance attestation。见 [VERIFY_RELEASE.md](VERIFY_RELEASE.md) 与 [PUBLISHING.md](PUBLISHING.md)。

## 开发

```bash
git submodule update --init --recursive
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
```

## 支持与安全

- 使用/故障排查：[SUPPORT.md](SUPPORT.md)
- 安全边界/漏洞报告：[SECURITY.md](SECURITY.md)
- 贡献：[CONTRIBUTING.md](CONTRIBUTING.md)

## Identity

- Publisher：`jiying2007`
- Extension ID：`jiying2007.codex-review-safe`
- Settings：`safeCodexReview.*`

## License

MIT

## Codex Provider Runtime

Codex Review Safe 为保持 Safe Contract 会主动忽略 `~/.codex/config.toml`。使用 OpenAI-compatible 中转站时，将 `safeCodexReview.providerMode` 设为 `openai-compatible`，配置 `safeCodexReview.providerBaseUrl`，并让 `safeCodexReview.providerApiKeyEnv` 指向 VS Code 进程可见的 API Key 环境变量。兼容 Provider 固定使用 Responses HTTP/SSE，不走 WebSocket。`Check Environment` 会真实执行一次结构化 Provider 探测。
