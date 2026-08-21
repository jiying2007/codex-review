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

  const { stdout } = await git(['show', `${headOid}:${PROJECT_RULES_FILE}`], repoRoot, token);
  if (Buffer.byteLength(stdout, 'utf8') > 128 * 1024) {
    throw new Error(t('{0} is too large.', PROJECT_RULES_FILE));
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(t('Cannot parse {0}: {1}', PROJECT_RULES_FILE, error.message));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(t('{0} must contain a JSON object.', PROJECT_RULES_FILE));
  }

  for (const key of Object.keys(parsed)) {
    if (!PROJECT_RULE_KEYS.has(key)) throw new Error(t('Unknown project rule: {0}', key));
  }

  return {
    rules: parsed,
    source: 'head-policy',
    fingerprint: crypto.createHash('sha256').update(stdout, 'utf8').digest('hex')
  };
}

async function getEffectiveOptions(repoRoot, headOid, token) {
  const config = vscode.workspace.getConfiguration('safeCodexReview');
  const userOptions = {
    codexPath: String(getUserOnlySetting(config, 'codexPath', 'codex')).trim() || 'codex',
    model: String(getUserOnlySetting(config, 'model', '')).trim(),
    language: String(getUserOnlySetting(config, 'language', 'zh-CN')),
    maxDiffBytes: clampNumber(getUserOnlySetting(config, 'maxDiffBytes', 524288), 524288, 4096, 2097152, 'maxDiffBytes'),
    maxFindings: clampNumber(getUserOnlySetting(config, 'maxFindings', 40), 40, 1, 100, 'maxFindings'),
    severityThreshold: String(getUserOnlySetting(config, 'severityThreshold', 'low')),
    timeoutSeconds: clampNumber(getUserOnlySetting(config, 'timeoutSeconds', 120), 120, 10, 300, 'timeoutSeconds'),
    extraInstructions: validateExtraInstructions(getUserOnlySetting(config, 'extraInstructions', ''))
  };

  if (!['zh-CN', 'en'].includes(userOptions.language)) userOptions.language = 'zh-CN';
  if (!(userOptions.severityThreshold in SEVERITY_ORDER)) userOptions.severityThreshold = 'low';

  const projectPolicy = await readProjectRulesAtHead(repoRoot, headOid, token);
  const project = projectPolicy.rules;
  const options = { ...userOptions };

  if (project.language !== undefined) {
    if (!['zh-CN', 'en'].includes(project.language)) throw new Error(t('Invalid project language.'));
    options.language = project.language;
  }
  if (project.maxDiffBytes !== undefined) {
    options.maxDiffBytes = clampNumber(project.maxDiffBytes, options.maxDiffBytes, 4096, 2097152, 'maxDiffBytes');
  }
  if (project.maxFindings !== undefined) {
    options.maxFindings = clampNumber(project.maxFindings, options.maxFindings, 1, 100, 'maxFindings');
  }
  if (project.severityThreshold !== undefined) {
    if (!(project.severityThreshold in SEVERITY_ORDER)) throw new Error(t('Invalid project severityThreshold.'));
    options.severityThreshold = project.severityThreshold;
  }
  if (project.timeoutSeconds !== undefined) {
    options.timeoutSeconds = clampNumber(project.timeoutSeconds, options.timeoutSeconds, 10, 300, 'timeoutSeconds');
  }
  if (project.extraInstructions !== undefined) {
    options.extraInstructions = validateExtraInstructions(project.extraInstructions);
  }

  options.policySource = projectPolicy.source;
  options.policyFingerprint = projectPolicy.fingerprint === '<none>'
    ? '<none>'
    : fingerprintPolicy(project);
  return options;
}

module.exports = {
  readProjectRulesAtHead,
  getEffectiveOptions
};
