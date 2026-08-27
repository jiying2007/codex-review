# 质量平台

Codex Review Safe 4.1 使用 Safe Core 4.4 的统一质量原语。`quick`、`standard`、`deep`、`security`、`embedded` 是用户侧执行 Profile，不属于仓库 Policy。Impact Evidence 只从受信工作区内有界的 tracked-file 候选中采集，再交给 Core 评分。SARIF 只读取用户或 CI 已生成的仓库内文件；扩展绝不执行 analyzer 命令。

修复完全 opt-in：已验证 finding 可请求一个结构化 unified-diff 候选，Core 会拒绝 binary 或越界补丁；VS Code 先打开只读 diff 预览，仅在用户明确确认后应用到 working tree。扩展绝不 commit、push 或 merge；用户检查并 Stage 目标修改后，再显式执行 Re-review。
