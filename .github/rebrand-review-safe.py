from pathlib import Path
import json

root = Path('.')
package_path = root / 'package.json'
pkg = json.loads(package_path.read_text(encoding='utf-8'))

if pkg.get('name') != 'codex-review-safe':
    skip_names = {'package-lock.json', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md'}
    allowed_suffixes = {'.js', '.json', '.md', '.yml', '.yaml'}
    for path in root.rglob('*'):
        if not path.is_file() or '.git' in path.parts or 'node_modules' in path.parts:
            continue
        if path.name in skip_names:
            continue
        if path.suffix not in allowed_suffixes and path.name != '.vscodeignore':
            continue
        text = path.read_text(encoding='utf-8')
        text = text.replace('jiying2007.codex-review', 'jiying2007.codex-review-safe')
        text = text.replace('codexReview', 'safeCodexReview')
        text = text.replace('Codex Review', 'Codex Review Safe')
        text = text.replace('codex-review-', 'codex-review-safe-')
        path.write_text(text, encoding='utf-8')

    extension_path = root / 'extension.js'
    extension = extension_path.read_text(encoding='utf-8')
    extension = extension.replace("createDiagnosticCollection('codex-review')", "createDiagnosticCollection('codex-review-safe')")
    extension_path.write_text(extension, encoding='utf-8')

pkg = json.loads(package_path.read_text(encoding='utf-8'))
pkg['name'] = 'codex-review-safe'
pkg['version'] = '1.0.0'
pkg['license'] = 'SEE LICENSE IN LICENSE'

replace_command_id = lambda value: value.replace('codexReview.', 'safeCodexReview.') if isinstance(value, str) else value
pkg['activationEvents'] = [replace_command_id(x) for x in pkg.get('activationEvents', [])]
for command in pkg.get('contributes', {}).get('commands', []):
    command['command'] = replace_command_id(command.get('command', ''))
for entries in pkg.get('contributes', {}).get('menus', {}).values():
    for entry in entries:
        if 'command' in entry:
            entry['command'] = replace_command_id(entry['command'])
configuration = pkg.get('contributes', {}).get('configuration', {})
configuration['properties'] = {
    key.replace('codexReview.', 'safeCodexReview.'): value
    for key, value in configuration.get('properties', {}).items()
}
package_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

readme = '''# Codex Review Safe

English | [简体中文](README.zh-CN.md)

Review safe, structured findings from **staged Git changes only** in VS Code using the local Codex CLI.

> **Why “Safe”?** Codex Review Safe is the review-side companion to [Codex Commit Safe](https://github.com/jiying2007/codex-commit). Both extensions deliberately keep a narrow trust boundary: staged-only input, Structured Output, HEAD + raw-index consistency checks, minimal Codex capabilities, fail-closed behavior, and no automatic source edits/commit/push.

## Highlights

- One-click review from VS Code Source Control
- Uses **staged/index changes only** (`git diff --cached`)
- Review findings in **Simplified Chinese or English**
- VS Code commands, settings, progress, warnings, reports, and errors localized for **English and Simplified Chinese**
- UI language and review-result language are independent
- Codex Structured Output with strict local schema/path validation
- Conservative Problems publishing: only safely mappable findings become inline diagnostics
- HEAD + raw Git index snapshot protection against stale results and TOCTOU races
- HEAD-pinned `.codex-review.json` policy, so a staged policy change cannot weaken its own review
- Dirty editors, unstaged changes, deleted/binary/submodule files, symlink escapes, pure rename/copy changes, and unsafe line mappings fall back to report-only
- Windows `.exe` / `.cmd` / `.bat`, Linux, and macOS execution paths covered by CI
- Never automatically modifies source files, commits, pushes, or opens pull requests

## Language support

The VS Code UI automatically follows the editor locale:

- English VS Code → English commands/messages/reports
- Simplified Chinese VS Code → Simplified Chinese commands/messages/reports

The review-result language is controlled separately:

```json
{
  "safeCodexReview.language": "zh-CN"
}
```

or:

```json
{
  "safeCodexReview.language": "en"
}
```

A Chinese UI can request English findings, and an English UI can request Chinese findings.

## Workflow

```text
Stage changes
    ↓
VS Code Source Control
    ↓
Codex Review Safe
    ↓
local Codex CLI
    ↓
Structured review result
    ↓
local validation
    ↓
Problems + review report
```

## Safety model

Codex Review Safe deliberately keeps the execution boundary narrow:

- only the staged diff is sent for inference;
- Codex runs from a temporary directory, not the repository;
- user Codex config and project execution rules are ignored for the review request;
- unnecessary Codex capabilities are explicitly disabled where supported;
- sandbox mode is read-only and approvals are disabled;
- model output must pass strict local schema, path, and range validation;
- repository state is represented by **HEAD OID + SHA-256(raw `git ls-files --stage -z`)**;
- snapshots are checked before/after collection, after Codex returns, and after Problems publication;
- stale reviews are discarded if HEAD/index changes or a newer review supersedes them;
- workspace/folder settings cannot weaken review policy;
- `.codex-review.json` is read from the exact captured HEAD OID;
- operational logs do not contain source code, staged diff contents, review content, secrets, or absolute repository paths.

Organization-managed Codex requirements, MDM settings, managed hooks, and cloud policy may still apply. The extension does not attempt to bypass organization policy.

> The staged diff leaves the local machine for the configured Codex service. Use the extension only where your organization’s source-code and data policy permits it.

See [SECURITY.md](SECURITY.md) for details.

## Requirements

- VS Code `1.90.0` or later
- Git
- OpenAI Codex CLI installed and authenticated

Check Codex CLI first:

```bash
codex --version
```

## Installation

Download the VSIX from a GitHub Release and install it:

```bash
code --install-extension codex-review-safe-1.0.0.vsix
```

Or in VS Code:

```text
Extensions → ... → Install from VSIX...
```

Then run:

```text
Ctrl+Shift+P → Codex Review Safe: Check Codex Environment
```

## Usage

1. Stage the changes you want to review.
2. Open **Source Control**.
3. Run **Codex Review Safe: Review Staged Changes** or use the Source Control toolbar action.
4. Safely locatable findings appear in **Problems**.
5. Open **Codex Review Safe: Show Review Report** for the complete report, including report-only findings and reasons.
6. Fix issues, stage again, rerun the review, and commit manually.

## Project configuration

A repository may include `.codex-review.json`:

```json
{
  "language": "zh-CN",
  "maxDiffBytes": 524288,
  "maxFindings": 40,
  "severityThreshold": "low",
  "timeoutSeconds": 120,
  "extraInstructions": "Focus on correctness, resource leaks, concurrency, bounds checks, error handling, and long-running stability."
}
```

Project rules cannot configure the Codex executable, model, environment variables, working directory, or arbitrary commands. The repository policy is read from the exact HEAD captured for the review, so a staged policy edit takes effect only after commit.

All `safeCodexReview.*` VS Code settings are application-scoped User Settings.

## Extension identity

- Repository: `codex-review`
- Extension name: `codex-review-safe`
- Display name: **Codex Review Safe**
- Publisher/VSIX ID: `jiying2007.codex-review-safe`
- Command/settings namespace: `safeCodexReview.*`
- Repository policy: `.codex-review.json`
- Companion extension: **Codex Commit Safe** (`jiying2007.codex-commit-safe`)
- Marketplace status: **not published yet**; GitHub Releases are the current distribution channel

## Development

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run package
```

CI validates latest VS Code on Linux/Windows/macOS, VS Code `1.90.0` minimum compatibility, localization parity, official VSIX contents, and SHA-256 generation.

See [PUBLISHING.md](PUBLISHING.md) for release details.

## License

See [LICENSE](LICENSE).
'''

readme_zh = '''# Codex Review Safe

[English](README.md) | 简体中文

在 VS Code 中使用本地 Codex CLI，仅针对 **Git 暂存区变更**生成安全、结构化的代码审查结果。

> **为什么叫 “Safe”？** Codex Review Safe 是 [Codex Commit Safe](https://github.com/jiying2007/codex-commit) 的代码审查配套扩展。两者统一采用 staged-only 输入、Structured Output、HEAD + raw index 一致性校验、最小 Codex 能力集、fail-closed 行为，并且都不会自动修改源码、Commit 或 Push。

## 主要能力

- VS Code Source Control 一键审查 staged changes
- **只审查 Git 暂存区**（`git diff --cached`）
- 审查结果支持 **简体中文 / 英文**
- 命令、设置、进度、警告、报告、错误完整支持 **中英文 UI**
- VS Code UI 语言与审查结果语言相互独立
- Codex Structured Output + 本地严格 schema / path 校验
- Problems 保守发布：只有能安全映射到当前 working tree 的问题才发布 inline Diagnostic
- 使用 HEAD + raw Git index snapshot 防止 stale result 和 TOCTOU
- `.codex-review.json` 固定读取捕获到的 HEAD，因此 staged 规则修改不能降低对自身的审查
- dirty editor、unstaged changes、删除文件、binary、submodule、symlink 越界、纯 rename/copy、无法安全定位的行号全部 fail-safe 为 report-only
- Windows `.exe` / `.cmd` / `.bat`、Linux、macOS 均由 CI 覆盖
- 永远不会自动修改源码、Commit、Push 或创建 PR

## 中英文支持

VS Code UI 自动跟随编辑器语言：

- 英文 VS Code → 英文命令/提示/报告
- 简体中文 VS Code → 中文命令/提示/报告

审查结果语言独立配置：

```json
{
  "safeCodexReview.language": "zh-CN"
}
```

或：

```json
{
  "safeCodexReview.language": "en"
}
```

因此中文 VS Code 可以输出英文 Review，英文 VS Code 也可以输出中文 Review。

## 工作流

```text
Stage changes
    ↓
VS Code Source Control
    ↓
Codex Review Safe
    ↓
本地 Codex CLI
    ↓
Structured review result
    ↓
本地安全校验
    ↓
Problems + 完整审查报告
```

## 安全模型

Codex Review Safe 有意保持较小的执行和信任边界：

- 只把 staged diff 发送给 Codex 推理；
- Codex 在临时目录执行，而不是项目仓库目录；
- 本次 Review 忽略用户 Codex config 和项目执行规则；
- 在 CLI 支持的情况下显式关闭不需要的 Codex 能力；
- 使用 read-only sandbox，并关闭 approval；
- 模型输出必须通过严格的本地 schema、路径和范围校验；
- 仓库状态使用 **HEAD OID + SHA-256(raw `git ls-files --stage -z`)** 表示；
- 在输入采集前后、Codex 返回后、Problems 发布后都进行 snapshot 校验；
- HEAD/index 发生变化或新 Review 覆盖旧 Review 时，旧结果直接丢弃；
- workspace/folder settings 不能降低 Review policy；
- `.codex-review.json` 从捕获到的精确 HEAD OID 中读取；
- operational log 不记录源码、staged diff、审查内容、secret 或仓库绝对路径。

组织级 Codex 策略、MDM、managed hooks 和云端策略仍可能具有更高优先级，扩展不会尝试绕过组织策略。

> staged diff 会离开本机并发送到所配置的 Codex 服务。请确保符合所在组织的源码和数据使用规范。

完整说明见 [SECURITY.md](SECURITY.md)。

## 环境要求

- VS Code `1.90.0` 或更高版本
- Git
- 已安装并登录 OpenAI Codex CLI

先确认：

```bash
codex --version
```

## 安装

从 GitHub Release 下载 VSIX：

```bash
code --install-extension codex-review-safe-1.0.0.vsix
```

或在 VS Code 中：

```text
Extensions → ... → Install from VSIX...
```

然后运行：

```text
Ctrl+Shift+P → Codex Review Safe: 检查 Codex 环境
```

## 使用方法

1. Stage 需要审查的修改。
2. 打开 **Source Control**。
3. 运行 **Codex Review Safe: 审查 Staged Changes**，或点击 Source Control 工具栏按钮。
4. 能安全定位的问题会出现在 **Problems**。
5. 使用 **Codex Review Safe: 显示审查报告** 查看完整报告，包括 report-only 问题和原因。
6. 修复问题、重新 Stage，再重新 Review，最后手动 Commit。

## 项目配置

仓库可以提交 `.codex-review.json`：

```json
{
  "language": "zh-CN",
  "maxDiffBytes": 524288,
  "maxFindings": 40,
  "severityThreshold": "low",
  "timeoutSeconds": 120,
  "extraInstructions": "重点关注正确性、资源泄漏、并发、边界检查、错误处理和长期运行稳定性。"
}
```

项目规则不能设置 Codex 可执行文件、模型、环境变量、工作目录或任意命令。Review policy 从本次 Review 捕获到的精确 HEAD 中读取，因此 staged 的规则修改只会在提交后生效。

所有 `safeCodexReview.*` VS Code 设置都是 application-scoped User Settings。

## 扩展身份

- 仓库：`codex-review`
- Extension name：`codex-review-safe`
- Display name：**Codex Review Safe**
- Publisher/VSIX ID：`jiying2007.codex-review-safe`
- 命令/设置 namespace：`safeCodexReview.*`
- 仓库规则：`.codex-review.json`
- 配套扩展：**Codex Commit Safe**（`jiying2007.codex-commit-safe`）
- Marketplace：**暂未发布**，当前通过 GitHub Releases 分发

## 开发

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run package
```

CI 会验证 Linux/Windows/macOS 最新 VS Code、VS Code `1.90.0` 最低兼容、双语 key 一致性、官方 VSIX 内容和 SHA-256。

发布流程见 [PUBLISHING.md](PUBLISHING.md)。

## License

见 [LICENSE](LICENSE)。
'''

(root / 'README.md').write_text(readme, encoding='utf-8')
(root / 'README.zh-CN.md').write_text(readme_zh, encoding='utf-8')

(root / 'CHANGELOG.md').write_text('''# Changelog\n\n## 1.0.0\n\n- Initial public baseline as **Codex Review Safe**.\n- Staged-only code review with Structured Output and local validation.\n- Conservative Problems publishing with report-only safety fallbacks.\n- HEAD + raw INDEX consistency checks and HEAD-pinned `.codex-review.json` policy.\n- Complete English/Simplified-Chinese manifest and runtime localization.\n- Linux/Windows/macOS Extension Host coverage plus VS Code `1.90.0` minimum compatibility.\n- Reproducible lockfile, official VSIX content verification, immutable GitHub Actions, Dependabot, and SHA-256 release artifacts.\n''', encoding='utf-8')

publishing_path = root / 'PUBLISHING.md'
publishing = publishing_path.read_text(encoding='utf-8')
publishing = publishing.replace('jiying2007.codex-review', 'jiying2007.codex-review-safe')
publishing = publishing.replace('`codex-review`', '`codex-review-safe`')
publishing = publishing.replace('`codexReview.*`', '`safeCodexReview.*`')
publishing = publishing.replace('Codex Review', 'Codex Review Safe')
publishing = publishing.replace('codex-review-', 'codex-review-safe-')
publishing_path.write_text(publishing, encoding='utf-8')

for temp in [root / 'REBRAND_TRIGGER', root / '.github/workflows/rebrand-review-safe.yml', root / '.github/rebrand-review-safe.py']:
    try:
        temp.unlink()
    except FileNotFoundError:
        pass

for target in [root / 'extension.js', root / 'package.json', root / 'test.js']:
    text = target.read_text(encoding='utf-8')
    for needle in ['codexReview.', 'jiying2007.codex-review"', "createDiagnosticCollection('codex-review')"]:
        if needle in text:
            raise SystemExit(f'legacy identity remains in {target}: {needle}')

print('Codex Review Safe identity prepared.')
