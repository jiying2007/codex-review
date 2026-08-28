# Semantic Review 4.2

Codex Review Safe 4.2 将 Git 暂存区视为不可变 Review Subject，并把“候选推理”与“Finding 发布”彻底分离。

## Review Subject

唯一 Review 目标是 staged diff。依赖上下文必须从同一个 Git Index 快照只读获取（`git show :path`）；未暂存 working tree 内容不得作为语义证据。预生成 SARIF 仍然只是数据证据，扩展不会执行 analyzer 命令。

Controller 构建 Evidence Manifest，包含受限的 staged、dependency、symbol declaration/definition 与 analyzer evidence。每条证据都有稳定 Evidence ID 和内容摘要，Manifest digest 参与 ReviewKey。

## Symbol Evidence

对 changed C/C++ 行中的普通函数调用提取 semantic requirement；Controller 使用 `git grep --cached` 受限定位声明/定义，再从 Git Index 读取匹配片段。Dependency 文件只是上下文，永远不能成为 Finding 目标。

## 两阶段 Review

1. **Hypothesis stage**：Codex 只能在精确 changed line 上提出候选主张；凡依赖外部 API/函数/类型/宏语义的前提，必须显式列出 assumptions 和 requiredSymbols。
2. **Verification stage**：语义 Hypothesis 只能使用已提供的不可变 Evidence 验证，结果只能是 `verified`、`insufficient_evidence` 或 `contradicted`，并引用精确 Evidence ID。

模型自报的高 confidence 不是证据。存在未解决语义假设的 Hypothesis 不能发布。最终 Finding 带 stable finding ID、evidence grade、evidence refs 和 evidence digest。

## 反复 Review 收敛

ReviewKey 绑定 HEAD、Index fingerprint、diff fingerprint、policy fingerprint、Profile、Evidence Manifest digest、analyzer digest、semantic contract/options 与 model identity。同一个 ReviewKey 再次 Review 时直接复用已验证缓存，不重复调用 Codex。

`Force Re-review Staged Changes` 会绕过缓存。如果同一个冻结 ReviewKey 得到不稳定的模型 Finding Set，不稳定 Finding 自动 suppress，并以明确 stability coverage gap fail-closed。

## Finding Resolution

用户可把已验证 Finding 标记为 `fixed`、`false_positive`、`accepted_risk`、`duplicate`、`obsolete`、`not_applicable` 或 `policy_exception`。Resolution 由 stable finding ID + evidence digest 绑定；依赖实现/证据一旦变化，旧 Resolution 自动失效并重新验证。

`Clear Review Results` 不删除 Resolution Ledger；需要通过 `Clear Finding Resolutions` 显式清除。

## 安全边界

- 模型不能调用工具、Shell、网络、仓库规则或主动读文件；
- 仓库 I/O 只由 Controller 负责且有明确上限；
- dependency context 绑定 Git Index 并始终按不可信数据处理；
- Finding 仍必须精确落在 staged changed line；
- Safe Fix 继续保持先预览、只改 working tree，绝不自动 stage/commit/push/merge。


## Review Lineage 与 Scope Contract

Review 4.2 可从 HEAD 读取可选 `.codex-review-scope.json`，并在同一 HEAD/Policy/Scope/Profile Session 内记录跨 index 的 Review Lineage。参见 [Review 收敛机制](REVIEW_CONVERGENCE.zh-CN.md)。
