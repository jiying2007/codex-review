# Token 效率

Codex Review Safe 使用 Codex Safe Core v4.3 的统一效率原语。现在整个 staged review 共享一个总证据预算，不再允许每个 chunk 分别吃满完整上限；总字节预算无法覆盖全部 chunk 时，优先保留更高风险证据，任何遗漏都会形成显式 coverage gap 并按 fail-closed 处理。

每个 chunk 在调用前按 Review 总 Token 预算做保守预检，实际 Codex usage 累计到 execution metadata，并记录计划/已执行 chunk、估算 Token、实际 usage 和实际模型。安全边界、精确 changed-line anchoring、确定性 Review Rules 和 Review Receipt 语义保持不变。
