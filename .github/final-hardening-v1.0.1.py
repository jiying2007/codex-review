from pathlib import Path
import json
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


# extension.js: move approval policy before exec, centralize argv construction,
# improve compatibility diagnostics, and expose argv helpers for regression tests.
ext = read('extension.js')
insert_after = """function isCliCompatibilityError(error) {
  const text = `${error?.stderr || ''}\\n${error?.stdout || ''}\\n${error?.message || ''}`.toLowerCase();
  return (
    text.includes('unexpected argument') ||
    text.includes('unknown argument') ||
    text.includes('unrecognized option') ||
    text.includes('unknown option')
  );
}
"""
build_args = insert_after + """

function buildCodexArgs(schemaPath, model) {
  const args = [
    '--ask-for-approval', 'never',
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--output-schema', schemaPath,
    '--config', 'web_search=\"disabled\"',
    '--config', 'features.shell_tool=false',
    '--config', 'features.unified_exec=false',
    '--config', 'features.shell_snapshot=false',
    '--config', 'features.apps=false',
    '--config', 'features.multi_agent=false',
    '--config', 'features.remote_plugin=false',
    '--config', 'features.hooks=false',
    '--config', 'features.goals=false',
    '--config', 'features.memories=false',
    '--config', 'features.skill_mcp_dependency_install=false'
  ];

  if (model) args.push('--model', model);
  args.push('-');
  return args;
}
"""
ext = replace_once(ext, insert_after, build_args, 'insert buildCodexArgs')

old_args = """    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox', 'read-only',
      '--ask-for-approval', 'never',
      '--output-schema', schemaPath,
      '--config', 'web_search=\"disabled\"',
      '--config', 'features.shell_tool=false',
      '--config', 'features.unified_exec=false',
      '--config', 'features.shell_snapshot=false',
      '--config', 'features.apps=false',
      '--config', 'features.multi_agent=false',
      '--config', 'features.remote_plugin=false',
      '--config', 'features.hooks=false',
      '--config', 'features.goals=false',
      '--config', 'features.memories=false',
      '--config', 'features.skill_mcp_dependency_install=false'
    ];

    if (options.model) args.push('--model', options.model);
    args.push('-');
"""
ext = replace_once(
    ext,
    old_args,
    "    const args = buildCodexArgs(schemaPath, options.model);\n",
    'replace inline Codex argv'
)

old_error = "The current Codex CLI is incompatible with the arguments required by Codex Review Safe. Upgrade the Codex CLI. Original error: {0}"
new_error = "The installed Codex CLI rejected one or more arguments required by Codex Review Safe. Check Codex CLI compatibility or update Codex Review Safe. Original error: {0}"
ext = ext.replace(old_error, new_error)
if new_error not in ext or old_error in ext:
    raise SystemExit('compatibility error message replacement failed')

ext = replace_once(
    ext,
    "    buildPrompt,\n    resolveCodexExecutable,\n",
    "    buildPrompt,\n    buildCodexArgs,\n    isCliCompatibilityError,\n    resolveCodexExecutable,\n",
    'export Codex argv helpers'
)
write('extension.js', ext)

# Runtime l10n: replace compatibility message key in both catalogs.
for path, value in [
    ('l10n/bundle.l10n.json', new_error),
    ('l10n/bundle.l10n.zh-cn.json', '已安装的 Codex CLI 拒绝了 Codex Review Safe 所需的一个或多个参数。请检查 Codex CLI 兼容性，或更新 Codex Review Safe。原始错误：{0}')
]:
    data = json.loads(read(path))
    if old_error not in data:
        raise SystemExit(f'{path}: old compatibility key not found')
    items = []
    for key, current in data.items():
        if key == old_error:
            items.append((new_error, value))
        else:
            items.append((key, current))
    write(path, json.dumps(dict(items), ensure_ascii=False, indent=2) + '\n')

# Version identity.
pkg = json.loads(read('package.json'))
pkg['version'] = '1.0.1'
write('package.json', json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

# README release references and final CI statement.
for path in ['README.md', 'README.zh-CN.md']:
    text = read(path).replace('codex-review-safe-1.0.0.vsix', 'codex-review-safe-1.0.1.vsix')
    if path == 'README.md':
        text = text.replace(
            'CI validates latest VS Code on Linux/Windows/macOS, VS Code `1.90.0` minimum compatibility, localization parity, official VSIX contents, and SHA-256 generation.',
            'CI validates latest VS Code on Linux/Windows/macOS, VS Code `1.90.0` minimum compatibility, a Simplified-Chinese runtime smoke test, localization source/bundle parity, official VSIX contents, and SHA-256 generation.'
        )
    else:
        text = text.replace(
            'CI 会验证 Linux/Windows/macOS 最新 VS Code、VS Code `1.90.0` 最低兼容、双语 key 一致性、官方 VSIX 内容和 SHA-256。',
            'CI 会验证 Linux/Windows/macOS 最新 VS Code、VS Code `1.90.0` 最低兼容、简体中文运行时 smoke、源码与双语 l10n key 一致性、官方 VSIX 内容和 SHA-256。'
        )
    write(path, text)

# Publishing migration residue.
publishing = read('PUBLISHING.md')
publishing = publishing.replace('Codex Review Safe Safe releases', 'Codex Review Safe releases')
publishing = publishing.replace('jiying2007.codex-review-safe-safe-safe', 'jiying2007.codex-review-safe')
write('PUBLISHING.md', publishing)

# Changelog: preserve clean public history and document the patch.
changelog = read('CHANGELOG.md')
entry = """## 1.0.1

- Fixed current Codex CLI compatibility by placing the global approval policy before the `exec` subcommand.
- Added a shared Codex argv builder plus regression and fake-CLI argument-order checks.
- Improved Codex CLI compatibility errors so they no longer incorrectly require an upgrade for every rejected argument.
- Added runtime localization source-to-bundle coverage and a Simplified-Chinese Extension Host smoke test.
- Removed remaining pre-release rebrand residue from publishing documentation and made integration test version output dynamic.

"""
if '## 1.0.1' not in changelog:
    changelog = changelog.replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
write('CHANGELOG.md', changelog)

# verify-l10n.js: ensure every literal runtime t('...') source key exists in both bundles.
verify = read('scripts/verify-l10n.js')
anchor = """if (pkg.l10n !== './l10n') {
  console.error('package.json must declare \"l10n\": \"./l10n\".');
  process.exit(5);
}

console.log('English/Simplified-Chinese localization bundles verified.');
"""
replacement = """if (pkg.l10n !== './l10n') {
  console.error('package.json must declare \"l10n\": \"./l10n\".');
  process.exit(5);
}

const extensionText = fs.readFileSync('extension.js', 'utf8');
const runtimeReferenced = [...extensionText.matchAll(/\\bt\\(\\s*'((?:\\\\.|[^'\\\\])*)'/g)]
  .map(match => match[1]
    .replace(/\\\\'/g, "'")
    .replace(/\\\\n/g, '\\n')
    .replace(/\\\\r/g, '\\r')
    .replace(/\\\\t/g, '\\t')
    .replace(/\\\\\\\\/g, '\\\\'));
for (const key of runtimeReferenced) {
  if (!(key in runtimeEn) || !(key in runtimeZh)) {
    console.error(`extension.js references missing runtime l10n key: ${key}`);
    process.exit(6);
  }
}

console.log('English/Simplified-Chinese localization bundles and runtime source references verified.');
"""
verify = replace_once(verify, anchor, replacement, 'extend l10n verification')
write('scripts/verify-l10n.js', verify)

# Unit tests: lock argv contract to current Codex CLI and make version output dynamic.
test = read('test.js')
test = replace_once(
    test,
    "const { __test } = require('./extension.js');\n",
    "const { __test } = require('./extension.js');\nconst pkg = require('./package.json');\n",
    'load package version in unit tests'
)
prompt_anchor = """  const chinesePrompt=__test.buildPrompt({language:'zh-CN',extraInstructions:''},['src/a.c']);
  assert.match(chinesePrompt,/Write summary, title, description, and suggestion in Simplified Chinese/);

"""
prompt_tests = prompt_anchor + """  const cliArgs=__test.buildCodexArgs('/tmp/schema.json','gpt-test');
  const execIndex=cliArgs.indexOf('exec');
  const approvalIndex=cliArgs.indexOf('--ask-for-approval');
  assert.ok(approvalIndex>=0 && approvalIndex<execIndex,'--ask-for-approval must be before exec');
  for(const flag of ['--json','--ephemeral','--skip-git-repo-check','--ignore-user-config','--ignore-rules','--sandbox','--output-schema','--config','--model']){
    assert.ok(cliArgs.indexOf(flag)>execIndex,`${flag} must remain after exec`);
  }
  assert.strictEqual(cliArgs.at(-1),'-');
  assert.strictEqual(__test.isCliCompatibilityError({stderr:'error: unexpected argument --output-schema'}),true);
  assert.strictEqual(__test.isCliCompatibilityError({stderr:'error: invalid value for model'}),false);

"""
test = replace_once(test, prompt_anchor, prompt_tests, 'add CLI argv unit tests')
test = test.replace(
    "console.log('All Codex Review Safe unit/regression tests passed.');",
    "console.log(`All Codex Review Safe ${pkg.version} unit/regression tests passed.`);"
)
write('test.js', test)

# Integration runner: fake CLI must reject the old invalid approval ordering; support locale selection.
runner = read('test/integration/runTest.js')
runner = replace_once(
    runner,
    "if(args.includes('--version')){console.log('codex-cli fake');process.exit(0);}\n",
    "if(args.includes('--version')){console.log('codex-cli fake');process.exit(0);}\nconst execIndex=args.indexOf('exec');\nconst approvalIndex=args.indexOf('--ask-for-approval');\nif(execIndex<0||approvalIndex<0||approvalIndex>execIndex||args[approvalIndex+1]!=='never'){console.error(\"error: unexpected argument '--ask-for-approval'\");process.exit(2);}\n",
    'make fake Codex enforce argv contract'
)
runner = replace_once(
    runner,
    "  if (process.env.VSCODE_TEST_VERSION) runOptions.version = process.env.VSCODE_TEST_VERSION;\n",
    "  if (process.env.VSCODE_TEST_VERSION) runOptions.version = process.env.VSCODE_TEST_VERSION;\n  if (process.env.VSCODE_TEST_LOCALE) runOptions.launchArgs.push(`--locale=${process.env.VSCODE_TEST_LOCALE}`);\n",
    'support VS Code test locale'
)
write('test/integration/runTest.js', runner)

# Integration suite: verify zh-CN runtime report and use package.json for version output.
it = read('test/integration/suite/integration.test.js')
it = replace_once(
    it,
    "const assert=require('assert');const fs=require('fs');const path=require('path');const {spawnSync}=require('child_process');const vscode=require('vscode');",
    "const assert=require('assert');const fs=require('fs');const path=require('path');const {spawnSync}=require('child_process');const vscode=require('vscode');const pkg=require(path.join(__dirname,'..','..','..','package.json'));",
    'load package version in integration suite'
)
it = replace_once(
    it,
    "assert.ok(d1.some(d=>d.source==='Codex Review Safe'),`first review produced no diagnostic; report=${await reportFor(repo1)}; fakeTrace=${fakeTrace()}`);",
    "assert.ok(d1.some(d=>d.source==='Codex Review Safe'),`first review produced no diagnostic; report=${await reportFor(repo1)}; fakeTrace=${fakeTrace()}`);if(process.env.VSCODE_TEST_LOCALE){assert.ok(/^zh(?:-|$)/i.test(vscode.env.language),`expected zh locale, got ${vscode.env.language}`);const localizedReport=await reportFor(repo1);assert.match(localizedReport,/结论：/);assert.match(localizedReport,/摘要：/);}",
    'add zh-CN runtime smoke'
)
it = re.sub(
    r"console\.log\('Codex Review Safe 1\.0\.0 Extension Host integration tests passed\.'\);",
    "console.log(`Codex Review Safe ${pkg.version} Extension Host integration tests passed.`);",
    it,
    count=1
)
write('test/integration/suite/integration.test.js', it)

# Remove this one-time migration script before the branch commit.
self_path = ROOT / '.github/final-hardening-v1.0.1.py'
if self_path.exists():
    self_path.unlink()

print('Codex Review Safe v1.0.1 final hardening applied.')
