#!/usr/bin/env bash
set -euo pipefail

base64 --decode .bootstrap/runtime-i18n.patch.gz.b64 | gzip -dc > /tmp/runtime.patch
sed -i 's/Codex Review 1\.0\.6/Codex Review 1.0.0/g' /tmp/runtime.patch
sed -n '1,/^--- .*test\.js/ p' /tmp/runtime.patch | sed '$d' > /tmp/extension.patch

set +e
patch -p4 --fuzz=3 < /tmp/extension.patch
patch_rc=$?
set -e
if [[ $patch_rc -gt 1 ]]; then
  echo "unexpected patch failure: $patch_rc" >&2
  exit "$patch_rc"
fi

base64 --decode .bootstrap/l10n.tgz.b64 | tar -xz

python3 - <<'PY'
from pathlib import Path
import json

extension = Path('extension.js')
text = extension.read_text()
start = text.index("    if (result.review.verdict === 'pass') {")
end = text.index("\n\n    log('review completed');", start)
localized_notification = '''    if (result.review.verdict === 'pass') {
      vscode.window.showInformationMessage(t('Codex Review: no substantive issues found.'));
    } else {
      const rejectedCount = result.review.rejectedFindings?.length || 0;
      const allRejected =
        result.review.findings.length === 0 &&
        rejectedCount > 0;

      const thresholdNote = hiddenFindings > 0
        ? t(', with {0} additional findings below the current threshold', hiddenFindings)
        : '';

      const message = allRejected
        ? t('Codex Review: the model returned {0} findings, but all were rejected by format/path validation. See the report.', rejectedCount)
        : t('Codex Review: {0}; showing {1} findings{2}.', result.review.verdict, visibleFindings, thresholdNote);

      const viewReportAction = t('View Report');
      const openProblemsAction = t('Open Problems');
      void vscode.window.showWarningMessage(
        message,
        viewReportAction,
        openProblemsAction
      ).then(action => {
        if (action === viewReportAction) outputChannel.show(true);
        if (action === openProblemsAction) {
          void vscode.commands.executeCommand('workbench.actions.view.problems');
        }
      }, error => {
        log(`warning notification failed: ${error?.message || error}`);
      });
    }'''
extension.write_text(text[:start] + localized_notification + text[end:])
Path('extension.js.rej').unlink(missing_ok=True)
Path('extension.js.orig').unlink(missing_ok=True)

test = Path('test.js')
value = test.read_text()
value = value.replace('/Problems: 已定位到 src\\/a\\.c:10/', '/Problems: published at src\\/a\\.c:10/')
value = value.replace('All Codex Review 1.0.0 unit/regression tests passed.', 'All Codex Review 1.1.0 unit/regression tests passed.')
test.write_text(value)

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text())
pkg['l10n'] = './l10n'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

readme = Path('README.md')
value = readme.read_text().replace(
    'Command titles, configuration descriptions, capability descriptions, and Marketplace metadata follow the VS Code UI locale.',
    'Command titles, configuration descriptions, capability descriptions, Marketplace metadata, progress notifications, reports, environment checks, and runtime errors follow the VS Code UI locale through VS Code NLS and `vscode.l10n`.'
)
readme.write_text(value)

readme_zh = Path('README.zh-CN.md')
value = readme_zh.read_text().replace(
    '命令标题、配置说明、Capability 描述和 Marketplace 元数据会跟随 VS Code UI 语言自动切换。',
    '命令标题、配置说明、Capability 描述、Marketplace 元数据、进度提示、报告说明、环境检查和运行时错误都会通过 VS Code NLS 与 `vscode.l10n` 跟随 VS Code UI 语言自动切换。'
)
readme_zh.write_text(value)

changelog = Path('CHANGELOG.md')
value = changelog.read_text()
needle = '- Add English and Simplified Chinese Marketplace/manifest localization with `package.nls.json` and `package.nls.zh-cn.json`.\n'
runtime_line = '- Add English and Simplified Chinese runtime UI localization through `vscode.l10n`.\n'
if runtime_line not in value:
    value = value.replace(needle, needle + runtime_line)
changelog.write_text(value)
PY

node --check extension.js
node test.js
node -e "const p=require('./package.json'); if(p.l10n!=='./l10n') process.exit(1)"
test -f l10n/bundle.l10n.json
test -f l10n/bundle.l10n.zh-cn.json
