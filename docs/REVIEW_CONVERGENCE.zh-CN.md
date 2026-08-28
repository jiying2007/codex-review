# Review 收敛机制 4.2

Codex Review Safe 4.2 将连续修改 staged 内容的过程视为同一个 Review Session，而不是一组互不相关的一次性模型调用。

## Scope Contract

可选的 `.codex-review-scope.json` 从 **HEAD** 读取，不读取 working tree 或 staged 版本，避免“被审查的改动同时削弱自身 Review 边界”。该契约属于 Review 产品层，不修改 Safe Policy Schema v3。

支持字段：`phase`、`goals`、`invariants`、`nonGoals`、`managedPaths`、`complexityBudget`、`notes`。文件存在时，未知字段或非法值 fail-closed；文件不存在时，Review 不会凭空发明 non-goal，也不会按 scope 抑制 Finding。

Scope 约束的是修复范围与复杂度，不是事实正确性。如果 concern 仅属于 `non_goal_risk` 或 `needs_scope_decision`，且仓库显式提供了 Scope Contract，则默认 report-only；但 changed line 若违反 Scope 中逐字声明的 invariant，仍可发布 Finding。

## Review Lineage

Review Session 由 HEAD、Policy fingerprint、Scope fingerprint 和 Review Profile 共同确定。只要 HEAD 未变化，staged index 的连续修改会生成新的 ReviewKey，但仍属于同一个 Session。

每个新 ReviewKey 都会用 Stable Finding ID 对比上一轮，形成：

- `fixed`
- `unchanged`
- `changed`
- `new`
- `reintroduced`
- `likely-fix-induced`

`likely-fix-induced` 明确是启发式信号：表示“新 Finding 出现在上一轮刚关闭 Finding 的同一文件”，用于定位收敛问题，不宣称已经证明因果关系。

## Convergence

报告会生成收敛状态：

- `converged`：Coverage 完整、重复 Review 稳定、没有可发布 Finding；
- `improving`：本轮关闭的旧 Finding 多于新增 Finding；
- `regressing`：出现 reintroduced / likely-fix-induced，或新增 Finding 多于修复；
- `active`：仍有 Finding，但没有明显改善/退化信号；
- `incomplete`：Evidence/Coverage 不完整，或 Force Re-review 稳定性不足。

报告会显式输出 `reviews-to-convergence`（收敛时为该 Session 的 run number，未收敛时为 `pending`）、closure rate、new finding 数量、reintroduced 数量、`likely-fix-induced` 数量、deterministic-preventable 数量，并保留 fix-induced rate 与 reintroduced rate。`likely-fix-induced` 始终只是启发式信号，不会被表述为已证明的因果关系。

## Changed causal anchor

Finding 必须锚定 staged diff 中精确的 changed causal span：`file`、`line`、`endLine` 必须完整落在同一个 added/modified range 内。模型可以额外提供 `supportingLocations`，用于指向未修改的症状代码、依赖实现、测试、配置或状态展示。

这样可以覆盖“changed 状态转换导致 unchanged LCD 分支显示错误”一类问题，而无需恢复 nearest-line 映射。未修改位置只作为 supporting evidence；Problems 诊断仍落在精确的 changed causal span。

## Deterministic invariant

已验证 Finding 可以标记 `invariantCandidate` 并给出 `invariantText`。报告会把这些候选不变量显式列出，帮助把反复出现的状态机/并发问题转成 deterministic test，而不是下一轮继续依赖模型重新发现。

4.2 regression corpus 同时包含 API ownership hard-negative 与生产老化温控反复 Review 中提取的 hard-positive 状态机案例。
