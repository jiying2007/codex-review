# Review 收敛与 Independent Review 协议

Codex Review Safe 将“**正在审什么**”与“**每一次真正执行的审查**”彻底拆开。重复审查不再允许把缓存中的模型结论伪装成新的 convergence 证据。

## ReviewSubject 与 ReviewRun

`ReviewSubjectKey` 标识一个不可变的语义审查对象：HEAD/index/diff、Policy、Scope/Profile、Analyzer Evidence、Prompt Contract、模型身份/选项，以及不可变 Evidence Manifest。

`ReviewRunId` 标识一次实际发生的 fresh 模型执行。因此同一个 `ReviewSubjectKey` 可以拥有多个独立的 fresh Run。

必须遵守以下语义：

- `ReviewSubjectKey` 相同，只说明代码与证据对象未变化；
- subject 相同，不代表上一轮模型结论可以算作一次新审查；
- `ReviewRunId` 是 lineage 持久化的幂等键；
- result replay 不产生新的 lineage run，也不产生新的 review receipt。

## Evidence Cache 与 Judgment Replay

缓存被硬切成两个存储域。

### Evidence Cache

当 fingerprint 不变时，可以复用确定性、不可变证据，包括 staged diff evidence、固定到 Git Index 的 dependency/symbol evidence、impact graph、analyzer evidence 与 Evidence Manifest。

Evidence Cache 命中会明确显示为 `evidence=cache-hit`。Independent Review 允许复用这些证据，因为其中不包含上一轮模型结论。

### Judgment Replay

已经验证过的模型结果只能作为明确的历史/replay 保存。它不能作为 fresh reviewer 的输入，也不能计入 fresh stability。

Replay 会明确显示 `inference=replay`、`judgment=replay-only` 与 `[result-replay]`；不会增加 lineage、convergence 或 receipt 次数。

旧的整份 Review 缓存 `semanticRuns.v1` 会被清理，不迁移到新协议。

## Independent Review

`Independent Review Staged Changes` 对当前 `ReviewSubjectKey` **强制执行新的模型推理**。

它可以复用确定性 Evidence Cache，但模型必须对以下上一轮 judgment 保持 blind：

- 上一轮 accepted findings；
- 上一轮 suppressed hypotheses/findings；
- 上一轮 coverage verdict；
- 上一轮模型 summary/解释；
- 上一轮 false-positive 裁决。

只有 fresh 模型执行完成之后，系统才允许在确定性的 lineage/stability 层比较各轮结果。

不同 fresh reviewer 的 disagreement 会被保留。Codex Review Safe 不会因为上一轮没有某个 Finding，就把本轮新 Finding 压掉以制造“稳定”。

## Review Lineage

Review Session 仍由 HEAD、Policy fingerprint、Scope fingerprint 与 Review Profile 共同确定，但 lineage 现在有两个正交维度：

1. **Subject transition**：staged subject 发生变化时，使用 Stable Finding ID 计算 `fixed`、`unchanged`、`changed`、`new`、`reintroduced`、`likely-fix-induced`；
2. **Repeated subject runs**：subject 未变化时，允许存在多个 fresh Run，用于衡量 reviewer agreement/stability，而不是假装代码发生了变化。

`likely-fix-induced` 仍然只是启发式信号，不表述为已证明的因果关系。

## Fresh provenance gate

Convergence 必须由真实执行 provenance 支撑，不能只看序列化输出是否完全一致。

默认同一 subject 至少需要两次 fresh、blind 的模型执行。Stability 会记录：

- required fresh runs；
- fresh inference runs；
- complete fresh runs；
- blind fresh runs；
- independent-review runs；
- cached-verdict runs；
- finding-set agreement；
- disagreement finding IDs。

最近要求数量的 fresh Run 必须全部 coverage complete。缓存/replay 的旧 verdict 永远不能满足 stability gate。

## Convergence

收敛状态定义为：

- `converged`：Coverage 完整、fresh provenance 完整、最近要求数量的 fresh Run 一致，并且没有可发布 Finding；
- `improving`：subject 变化后关闭的旧 Finding 多于新增 Finding；
- `regressing`：subject 变化后出现 reintroduced / likely-fix-induced，或新增 Finding 多于修复；
- `active`：仍有 Finding，但没有更明确的改善/退化信号；
- `incomplete`：Evidence/Coverage 不完整、缺少要求数量的 fresh blind Run、fresh coverage 不连续完整，或 fresh reviewer 之间存在 disagreement。

报告会明确给出原因：`fresh_runs_missing`、`blind_context_missing`、`fresh_coverage_incomplete`、`finding_disagreement` 或 `judgment_cache_used`，而不是把所有情况都压成一个含义不清的 `blocked`。

## 分层 Readiness

报告把三个问题拆开：

- `Defect verdict`：是否存在已经证据验证的代码 Finding；
- `Evidence readiness`：审查证据与 coverage 是否完整；
- `Overall readiness`：当前证据是否足够支持交付就绪。

因此即使 `no_findings`，如果仍缺 HIL、构建、需求或其他验证证据，也会表现为“证据/产品就绪未闭环”，而不是像发现了代码缺陷一样显示一个矛盾的 block。

## Changed causal anchor

Finding 仍必须锚定 staged diff 中精确的 added/modified causal span。`supportingLocations` 可以指向 unchanged symptom/dependency/test/configuration evidence，但不能绕过 changed-line gate。

## Deterministic invariant

已验证 Finding 仍可提出 deterministic regression invariant。重复模型审查的价值之一，是把可重复发现的问题提炼成长期确定性测试/规则；一旦形成 deterministic invariant，就不应继续依赖模型下一轮重新发现同一个问题。
