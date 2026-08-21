'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { git } = require('./git');
const {
  PROJECT_RULES_FILE,
  PROJECT_RULE_KEYS,
  SEVERITY_ORDER,
  clampNumber,
  validateExtraInstructions,
  getUserOnlySetting
} = require('./core');
const { fingerprintPolicy } = require('./codex-safe-core/safe-contract');
const { t } = require('./i18n');

async function readProjectRulesAtHead(repoRoot, headOid, token) {
  if (headOid === '<unborn>') {
    return { rules: {}, source: 'unborn-default', fingerprint: '<none>' };
  }

  const { stdout: listed } = await git(
    ['ls-tree', '-z', '--name-only', headOid, '--', PROJECT_RULES_FILE],
    repoRoot,
    token
  );

  if (!listed.split('\0').filter(Boolean).includes(PROJECT_RULES_FILE)) {
    return { rules: {}, source: 'head-default', fingerprint: '<none>' };
  }

  let stdout;
  try {
    ({ stdout } = await git(
      ['show', `${headOid}:${PROJECT_RULES_FILE}`],
      repoRoot,
      token
    ));
  } catch (error) {
    throw new Error(
      t('Failed to read {0} from HEAD {1}: {2}', PROJECT_RULES_FILE, headOid.slice(0, 12), error?.message || error)
    );
  }

  if (Buffer.byteLength(stdout, 'utf8') > 64 * 1024) {
    throw new Error(t('{0} in HEAD must not exceed 64 KiB.', PROJECT_RULES_FILE));
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      t('Failed to parse {0} in HEAD: {1}', PROJECT_RULES_FILE, error.message)
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      t('The top level of {0} in HEAD must be a JSON object.', PROJECT_RULES_FILE)
    );
  }

  const unknown = Object.keys(parsed).filter(key => !PROJECT_RULE_KEYS.has(key));
  if (unknown.length) {
    throw new Error(
      t('{0} in HEAD contains unsupported fields: {1}', PROJECT_RULES_FILE, unknown.join(', '))
    );
  }

  return {
    rules: parsed,
    source: 'head-policy',
    fingerprint: crypto.createHash('sha256').update(stdout, 'utf8').digest('hex')
  };
}

async function getEffectiveOptions(repoRoot, headOid, token) {
  const config = vscode.workspace.getConfiguration(
    'safeCodexReview',
    vscode.Uri.file(repoRoot)
  );

  const { rules: project, source: policySource, fingerprint: policyFingerprint } =
    await readProjectRulesAtHead(repoRoot, headOid, token);

  const codexPath = String(
    getUserOnlySetting(config, 'codexPath', 'codex') || 'codex'
  ).trim();

  const model = String(
    getUserOnlySetting(config, 'model', '') || ''
  ).trim();

  if (!codexPath || codexPath.length > 1024 || /[\r\n\0]/.test(codexPath)) {
    throw new Error(t('User-level safeCodexReview.codexPath is invalid.'));
  }
  if (model.length > 128 || /[\r\n\0]/.test(model)) {
    throw new Error(t('User-level safeCodexReview.model is invalid.'));
  }

  const language = project.language ?? getUserOnlySetting(config, 'language', 'zh-CN');
  if (!['zh-CN', 'en'].includes(language)) {
    throw new Error(t('Unsupported language: {0}', language));
  }

  const severityThreshold =
    project.severityThreshold ?? getUserOnlySetting(config, 'severityThreshold', 'low');

  if (!(severityThreshold in SEVERITY_ORDER)) {
    throw new Error(t('Unsupported severityThreshold: {0}', severityThreshold));
  }

  const extraInstructions = [
    validateExtraInstructions(getUserOnlySetting(config, 'extraInstructions', '')),
    validateExtraInstructions(project.extraInstructions)
  ].filter(Boolean).join('\n');

  if (extraInstructions.length > 5000) {
    throw new Error(t('The combined extraInstructions must not exceed 5000 characters.'));
  }

  const options = {
    codexPath,
    model,
    language,
    maxDiffBytes: clampNumber(
      project.maxDiffBytes ?? getUserOnlySetting(config, 'maxDiffBytes', 524288),
      524288, 4096, 2097152, 'maxDiffBytes'
    ),
    maxFindings: clampNumber(
      project.maxFindings ?? getUserOnlySetting(config, 'maxFindings', 40),
      40, 1, 100, 'maxFindings'
    ),
    severityThreshold,
    timeoutSeconds: clampNumber(
      project.timeoutSeconds ?? getUserOnlySetting(config, 'timeoutSeconds', 120),
      120, 10, 300, 'timeoutSeconds'
    ),
    extraInstructions,
    policySource,
    projectPolicyFingerprint: policyFingerprint
  };

  options.policyFingerprint = fingerprintPolicy({
    language: options.language,
    maxDiffBytes: options.maxDiffBytes,
    maxFindings: options.maxFindings,
    severityThreshold: options.severityThreshold,
    timeoutSeconds: options.timeoutSeconds,
    extraInstructions: options.extraInstructions,
    projectPolicyFingerprint: options.projectPolicyFingerprint
  });
  return options;
}

module.exports = {
  readProjectRulesAtHead,
  getEffectiveOptions
};
