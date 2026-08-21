# Safe Core

Codex Review Safe 从产品族唯一规范来源 `jiying2007/codex-commit:safe-core-v1` vendor **Safe Core v1**。

共享运行时统一负责 Codex 安全参数契约、CLI 可执行文件解析、能力探测、JSONL 解析、临时 Schema 执行和 Structured Output 进程编排。Review 自己的 Git 数据采集、策略、Prompt、审查 Schema、Finding 校验、Problems 发布和 Review Receipt 继续保留在本仓库。

vendored 文件由 `safe-core.lock.json` 和 `src/codex-safe-core/manifest.json` 双重锁定。

```bash
node scripts/safe-core.js verify
node scripts/safe-core.js upstream
node scripts/safe-core.js sync
```

- `verify` 完全离线，校验本地 vendored 文件、manifest 与 lock 的 SHA-256。
- `upstream` 校验锁定版本是否仍与规范来源一致；CI 使用这个 fail-closed 漂移门禁。
- `sync` 显式下载规范来源的 manifest/文件，先校验上游 hash，再更新 vendored 副本和 lock，最终差异仍需人工 Review 后提交。

不使用 Git submodule，插件运行时也不依赖规范仓库网络连接。
