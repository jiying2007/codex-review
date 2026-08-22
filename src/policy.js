'use strict';

const vscode = require('vscode');
const { git } = require('./git');
const {
  PROJECT_RULE_KEYS,
  SEVERITY_ORDER,
  clampNumber,
  validateExtraInstructions,
  getUserOnlySetting
} = require('./core');
const {
  POLICY_FILE,
  readPolicySectionAtHead
} = require('./codex-safe-core/policy');
const { fingerprintPolicy } = require('./codex-safe-core/safe-contract');
const { t } = require('./i18n');

async function readProjectRulesAtHead(repoRoot, headOid, token) {
  const result = await readPolicySectionAtHead({
    git,
    repoRoot,
    headOid,
    section: 'review',
    token
  });
  const unknown = Object.keys(result.rules).filter(key => !PROJECT_RULE_KEYS.has(key));
  if (unknown.length) {
    throw new Error(t('{0}.review contains unsupported fields: {1}', POLICY_FILE, unknown.join(', ')));
  }
  return result;
}

async function getEffectiveOptions(repoRoot, headOid, token) {
  const config = vscode.workspace.getConfiguration('safeCodexReview', vscode.Uri.file(repoRoot));
  const { rules: project, source: policySource, fingerprint: policyFingerprint } = await readProjectRulesAtHead(repoRoot, headOid, token);

  const codexPath = String(getUserOnlySetting(config, 'codexPath', 'codex') || 'codex').trim();
  const model = String(getUserOnlySetting(config, 'model', '') || '').trim();
  if (!codexPath || codexPath.length > 1024 || /[\r\n\0]/.test(codexPath)) throw new Error(t('User-level safeCodexReview.codexPath is invalid.'));
  if (model.length > 128 || /[\r\n\0]/.test(model)) throw new Error(t('User-level safeCodexReview.model is invalid.'));

  const language = project.language ?? getUserOnlySetting(config, 'language', 'zh-CN');
  if (!['zh-CN', 'en'].includes(language)) throw new Error(t('Unsupported language: {0}', language));

  const severityThreshold = project.severityThreshold ?? getUserOnlySetting(config, 'severityThreshold', 'low');
  if (!(severityThreshold in SEVERITY_ORDER)) throw new Error(t('Unsupported severityThreshold: {0}', severityThreshold));

  const confidenceThreshold = clampNumber(
    project.confidenceThreshold ?? getUserOnlySetting(config, 'confidenceThreshold', 0.7),
    0.7, 0, 1, 'confidenceThreshold'
  );

  const extraInstructions = [
    validateExtraInstructions(getUserOnlySetting(config, 'extraInstructions', '')),
    validateExtraInstructions(project.extraInstructions)
  ].filter(Boolean).join('\n');
  if (extraInstructions.length > 5000) throw new Error(t('The combined extraInstructions must not exceed 5000 characters.'));

  const options = {
    codexPath,
    model,
    language,
    maxDiffBytes: clampNumber(project.maxDiffBytes ?? getUserOnlySetting(config, 'maxDiffBytes', 524288), 524288, 4096, 2097152, 'maxDiffBytes'),
    maxFindings: Math.round(clampNumber(project.maxFindings ?? getUserOnlySetting(config, 'maxFindings', 40), 40, 1, 100, 'maxFindings')),
    severityThreshold,
    confidenceThreshold,
    timeoutSeconds: Math.round(clampNumber(project.timeoutSeconds ?? getUserOnlySetting(config, 'timeoutSeconds', 120), 120, 10, 300, 'timeoutSeconds')),
    extraInstructions,
    policySource,
    projectPolicyFingerprint: policyFingerprint
  };

  options.policyFingerprint = fingerprintPolicy({
    language: options.language,
    maxDiffBytes: options.maxDiffBytes,
    maxFindings: options.maxFindings,
    severityThreshold: options.severityThreshold,
    confidenceThreshold: options.confidenceThreshold,
    timeoutSeconds: options.timeoutSeconds,
    extraInstructions: options.extraInstructions,
    projectPolicyFingerprint: options.projectPolicyFingerprint
  });
  return options;
}

module.exports = { readProjectRulesAtHead, getEffectiveOptions };
