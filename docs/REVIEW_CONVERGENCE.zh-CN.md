# Review 收敛与自适应重放协议

Codex Review Safe 将**确定性证据**、**fresh 模型判断**、**短期重放**和**长期审计历史**彻底分离。

## 只有一个 Review 入口

用户只需要使用一个 Review。`fresh blind review` 已退役。对完全相同的 `ReviewSubjectKey`，Review 自动执行：

`fresh → replay → replay → fresh → replay → replay → fresh ...`

HEAD/index/diff、Policy、Scope/Profile、模型/选项、Prompt Contract、Analyzer/SARIF 输入或 Evidence Manifest 任一变化，都会形成新的 Subject，并立即要求 fresh inference。

## 持久化 Evidence Cache

持久化缓存只包含确定性的结构证据：staged/index 固定证据、symbol/dependency 证据、impact graph 和结构 Evidence Manifest。它按内容指纹失效，不按时间 TTL 失效。Analyzer/SARIF 证据每次 Review 都重新组合进最终 Evidence Manifest，因此 analyzer 变化不会迫使昂贵的结构证据整套重扫。

`evidence=structural-cache-hit` 只表示证据复用，不代表模型没有执行。

## Session Replay Window

模型 Judgment 不再作为持久化 Cache 保存。只有当前 VS Code 扩展会话内、完全相同的 `ReviewSubjectKey` 才允许短期重放，并同时受两条硬限制：

- 最多连续 replay 2 次；
- 距离来源 fresh run 最多 10 分钟。

任一限制达到后，下一次 Review 必须执行 fresh blind 模型审查。重启 VS Code 会清空 Replay Window，因此下一次 Review 必定 fresh，但确定性的 Evidence Cache 仍可继续复用。

Replay 不生成新的 `ReviewRunId`、Lineage run、Review Receipt，也不能作为 fresh convergence 证据。

## Fresh blind Review

每次 fresh run 只接收当前 diff/evidence，不会看到上一轮 Findings、suppressed hypotheses、coverage verdict、summary、explanation 或人工 resolution。历史判断只在模型执行结束后由确定性的 lineage/stability 逻辑对账。

## Lineage 与 Convergence

`ReviewSubjectKey` 标识不可变审查对象；`ReviewRunId` 标识一次真实 fresh 模型执行。Convergence 仍要求至少两次 coverage complete 且 finding set 一致的 fresh blind runs，Replay 永远不能满足该条件。

Report 必须明确区分 `fresh`、`result-replay` 与 `structural-cache-hit`。长期 Judgment 历史只由 Review Receipt + Review Lineage 保存，它们用于审计，不作为下一轮模型输入。

## 验证覆盖与候选上限

`maxFindings` 限制展示和验证工作量，不能证明被省略的候选已经受审。Hypothesis schema 在该上限之外保留有界余量；响应达到容量、单个 chunk 省略候选、跨 chunk 汇总截断都会生成明确的 coverage gap。展示上限为 1 时仅返回 1 个候选，本身不代表响应容量饱和。

Hypothesis 与 verification 两阶段均接收所选 Profile Pack 检查项。只有 staged 和必需 symbol 证据完整进入实际 verifier input 的候选才可送验。必需证据因预算被省略时，审查保持 incomplete，控制器不会把不具备验证条件的候选交给模型判断。即使没有可发布 Findings 且 finding set 稳定，失败的机械规则仍阻止交付。

## 受控回归证据

语义 corpus 包含可执行的临时 Git 夹具和受控模型输出，实际经过证据收集、两阶段审查、因果行锚点、Lineage、Convergence 与 Receipt 资格判断。`evaluationMode: controlled-model-controller-regression` 明确表示控制器回归覆盖；它不衡量真实新模型的召回率、准确率或生产晋级质量。
