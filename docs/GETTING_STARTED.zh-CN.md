# Codex Review Safe 快速开始

## 1. 安装环境

在 VS Code workspace Extension Host 所在环境安装 VS Code 1.90+、Git 和 OpenAI Codex CLI，并完成登录：

```bash
codex --version
codex login
```

Remote SSH、Dev Containers、Codespaces、WSL 必须在对应远端环境安装 Codex。

## 2. 安装插件

从 VS Code Marketplace 安装 `jiying2007.codex-review-safe`，或安装 GitHub Release 中 immutable VSIX。

## 3. 先检查环境

打开可信 Git workspace，运行：

**Codex Review Safe: 检查 Codex 环境**

Git/Codex/capability 有问题时先修复，不进入 Review。

## 4. 第一次 Review

```bash
git status --short
git add <files>
git diff --cached --stat
```

然后执行 **Review Staged Changes**。只审查 staged snapshot；未 stage 的修改刻意忽略。

## 5. 可选仓库 Policy

可在目标分支提交 `.codex-safe.json`，配置语言、Evidence Budget、阈值与确定性 Rules。Policy 修改只有 Commit 后才生效。

## 常见问题

### 没有 staged changes

先 `git add`。Review Safe 不审查 working-tree-only 修改。

### 找不到 Codex

在 VS Code workspace 相同 local/remote 环境执行 `codex --version`；必要时设置 `safeCodexReview.codexPath`。

### Restricted Mode

先信任 workspace。Restricted Mode 下 Review 被设计为直接拒绝。

### Coverage incomplete

某个 changed hunk 无法在当前 Evidence Limits 内覆盖时会 fail closed。应拆小变更，或在评估风险后调整仓库 Policy。

## 升级

Marketplace 更新或替换为新版 immutable VSIX，Reload VS Code 后先运行一次 **检查 Codex 环境**，再开始 Review。
