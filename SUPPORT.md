# Support

Before opening an issue, run **Codex Review Safe: Check Codex Environment** and capture the Review Safe Output channel.

Include:

- extension version;
- VS Code version and local/Remote SSH/Container/WSL context;
- OS;
- `git --version`;
- `codex --version`;
- whether the workspace is trusted;
- whether the problem reproduces with a small staged change;
- error code/message from the Output channel.

Do not attach credentials, private source code, raw proprietary diffs, prompts or Codex authentication files.

Expected product boundaries are not bugs: working-tree-only edits are not reviewed; Review Safe does not modify source, commit, push or create PRs; missing Safe Contract capabilities fail closed.

中文：提 Issue 前先运行 **检查 Codex 环境** 并查看 Output。请提供插件/VS Code/Codex/Git/OS 版本、远端环境类型、Workspace Trust 状态和错误码/消息；不要上传凭据、私有源码或完整专有 diff。仅 working tree 修改不参与 Review，以及不自动修改源码/Commit/Push/PR，均属于产品设计边界。
