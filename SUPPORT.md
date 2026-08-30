# Support

Before opening an issue, run **Codex Review Safe: Check Codex Environment** and capture the Review Safe Output channel.

Current runtime trust root: Codex Safe Core v4.9.3 at exact commit `2011591e76cf73c0890b702a5bcd3499de91bbbc`. `product-contract.json` and the `src/codex-safe-core` gitlink are authoritative; immutable historical schema URLs and release notes remain provenance records, not moving dependencies.

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

中文：提 Issue 前先运行 **检查 Codex 环境** 并查看 Output。当前运行时 Trust Root 为 Codex Safe Core v4.9.3，精确提交 `2011591e76cf73c0890b702a5bcd3499de91bbbc`；以 `product-contract.json` 与 `src/codex-safe-core` gitlink 为准。请提供插件/VS Code/Codex/Git/OS 版本、远端环境类型、Workspace Trust 状态和错误码/消息；不要上传凭据、私有源码或完整专有 diff。仅 working tree 修改不参与 Review，以及不自动修改源码/Commit/Push/PR，均属于产品设计边界。
