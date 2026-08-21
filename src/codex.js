'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runProcess } = require('./process');
const {
  REQUIRED_CODEX_TOP_LEVEL_FLAGS,
  REQUIRED_CODEX_EXEC_FLAGS,
  buildSafeCodexArgs,
  missingHelpFlags,
  isCliCompatibilityError
} = require('./safe-contract');
const {
  outputSchema,
  buildPrompt,
  parseCodexJsonl,
  validateReviewResult
} = require('./review');
const { t } = require('./i18n');

const capabilityCache = new Map();

async function findWindowsCodexCandidates(codexPath) {
  if (process.platform !== 'win32' || codexPath !== 'codex') return [codexPath];

  const candidates = [];
  try {
    const { stdout } = await runProcess(
      'where.exe',
      ['codex'],
      { timeoutMs: 5000, prepared: false }
    );
    for (const line of stdout.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
      if (!candidates.includes(line)) candidates.push(line);
    }
  } catch {}

  for (const fallback of ['codex.exe', 'codex.cmd', 'codex.bat', 'codex']) {
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }

  candidates.sort((a, b) => {
    const rank = x => /\.exe$/i.test(x) ? 0 : /\.(cmd|bat)$/i.test(x) ? 1 : 2;
    return rank(a) - rank(b);
  });

  return candidates;
}

async function resolveCodexExecutable(codexPath) {
  const candidates = await findWindowsCodexCandidates(codexPath);
  const windowsDefaultLookup = process.platform === 'win32' && codexPath === 'codex';
  let lastError;

  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await runProcess(
        candidate,
        ['--version'],
        { timeoutMs: 10000 }
      );
      const version = (stdout || stderr).trim();
      if (!version) {
        throw new Error(t('Codex CLI {0} returned no version information from --version.', candidate));
      }
      return { executable: candidate, version };
    } catch (error) {
      lastError = error;
      if (windowsDefaultLookup) continue;
      if (error?.code === 'ENOENT') break;

      const detail = error?.stderr || error?.stdout || error?.message || String(error);
      const wrapped = new Error(
        t(
          'Codex CLI failed to run: {0}. Make sure "{0} --version" succeeds. Original error: {1}',
          candidate,
          detail
        )
      );
      wrapped.code = 'ECODEXUNUSABLE';
      wrapped.cause = error;
      throw wrapped;
    }
  }

  const detail = lastError?.stderr || lastError?.stdout || lastError?.message || '';
  const suffix = detail ? t(' Original error: {0}', detail) : '';
  const error = new Error(
    t(
      'No usable Codex CLI was found for: {0}. Make sure "codex --version" succeeds, or set safeCodexReview.codexPath in User Settings.{1}',
      codexPath,
      suffix
    )
  );
  error.code = 'ECODEXNOTFOUND';
  error.cause = lastError;
  throw error;
}

async function probeCodexCapabilities(resolved, model = '') {
  const cacheKey = `${resolved.executable}\n${resolved.version}\n${model ? 'model' : 'default'}`;
  if (capabilityCache.has(cacheKey)) return capabilityCache.get(cacheKey);

  let topHelp;
  let execHelp;
  try {
    const [top, exec] = await Promise.all([
      runProcess(resolved.executable, ['--help'], { timeoutMs: 10000, maxStdoutBytes: 512 * 1024, maxStderrBytes: 256 * 1024 }),
      runProcess(resolved.executable, ['exec', '--help'], { timeoutMs: 10000, maxStdoutBytes: 512 * 1024, maxStderrBytes: 256 * 1024 })
    ]);
    topHelp = `${top.stdout}\n${top.stderr}`;
    execHelp = `${exec.stdout}\n${exec.stderr}`;
  } catch (error) {
    const wrapped = new Error(
      t('Unable to inspect Codex CLI capabilities for {0}. Make sure "codex --help" and "codex exec --help" succeed.', resolved.version)
    );
    wrapped.code = 'ECODEXCAPABILITY';
    wrapped.cause = error;
    throw wrapped;
  }

  const missing = [
    ...missingHelpFlags(topHelp, REQUIRED_CODEX_TOP_LEVEL_FLAGS).map(flag => `top-level ${flag}`),
    ...missingHelpFlags(execHelp, REQUIRED_CODEX_EXEC_FLAGS).map(flag => `exec ${flag}`)
  ];
  if (model && !`${topHelp}\n${execHelp}`.includes('--model')) missing.push('--model');
  if (missing.length) {
    const error = new Error(t('Codex CLI {0} does not expose required capabilities: {1}.', resolved.version, missing.join(', ')));
    error.code = 'ECODEXCAPABILITY';
    error.missingFlags = missing;
    throw error;
  }

  const result = { ...resolved, capabilitiesVerified: true };
  capabilityCache.set(cacheKey, result);
  return result;
}

function buildCodexArgs(schemaPath, model) {
  return buildSafeCodexArgs(schemaPath, model);
}

async function withTemporaryDirectory(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-'));
  try {
    return await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function runCodexReview(diff, stagedPaths, options, token) {
  const resolved = await resolveCodexExecutable(options.codexPath);
  await probeCodexCapabilities(resolved, options.model);
  const prompt = buildPrompt(options, stagedPaths);
  const stdin = [
    prompt,
    '',
    '--- STAGED GIT DIFF START ---',
    diff,
    '--- STAGED GIT DIFF END ---',
    ''
  ].join('\n');

  return withTemporaryDirectory(async tempDir => {
    const schemaPath = path.join(tempDir, 'review-schema.json');
    fs.writeFileSync(schemaPath, JSON.stringify(outputSchema(options)), {
      encoding: 'utf8',
      mode: 0o600
    });

    const args = buildCodexArgs(schemaPath, options.model);

    let processResult;
    try {
      processResult = await runProcess(
        resolved.executable,
        args,
        {
          cwd: tempDir,
          timeoutMs: options.timeoutSeconds * 1000,
          detached: process.platform !== 'win32'
        },
        stdin,
        token
      );
    } catch (error) {
      if (isCliCompatibilityError(error)) {
        const wrapped = new Error(
          t('The installed Codex CLI rejected one or more arguments required by Codex Review Safe. Check Codex CLI compatibility or update Codex Review Safe. Original error: {0}', error.stderr || error.message)
        );
        wrapped.code = 'ECODEXVERSION';
        throw wrapped;
      }
      throw error;
    }

    const agentText = parseCodexJsonl(processResult.stdout);
    let parsed;
    try {
      parsed = JSON.parse(agentText);
    } catch {
      throw new Error(t('Codex final agent_message is not JSON matching the output schema.'));
    }

    const review = validateReviewResult(parsed, options, stagedPaths);
    review.executionMeta = {
      codexVersion: resolved.version || 'unknown',
      model: options.model || 'cli-default'
    };
    return review;
  });
}

module.exports = {
  findWindowsCodexCandidates,
  resolveCodexExecutable,
  probeCodexCapabilities,
  buildCodexArgs,
  withTemporaryDirectory,
  runCodexReview,
  isCliCompatibilityError,
  _capabilityCache: capabilityCache
};
