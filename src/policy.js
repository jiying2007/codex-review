'use strict';

const vscode = require('vscode');
const { git } = require('./git');
const {
  SEVERITY_ORDER,
  clampNumber,
  validateExtraInstructions,
  getUserOnlySetting
} = require('./review-support');
const { readPolicySectionAtHead } = require('./codex-safe-core/policy');
const { fingerprintPolicy } = require('./codex-safe-core/safe-contract');
const { normalizeCodexRuntimeOptions } = require('./codex-safe-core/codex-runtime');
const { resolveReviewProfile } = require('./codex-safe-core/quality-platform');
const { t } = require('./i18n');

const RAW_DIFF_HARD_LIMIT_BYTES = 8 * 1024 * 1024;

function readProjectRulesAtHead(repoRoot, headOid, token) {
  return readPolicySectionAtHead({
    git,
    repoRoot,
    headOid,
    section: 'review',
    token
  });
}

function runtimeOptions(config, project) {
  const providerMode = String(getUserOnlySetting(config, 'providerMode', 'openai') || 'openai').trim();
  const provider = providerMode === 'openai-compatible'
    ? {
        mode: providerMode,
        baseUrl: String(getUserOnlySetting(config, 'providerBaseUrl', '') || '').trim(),
        apiKeyEnv: String(getUserOnlySetting(config, 'providerApiKeyEnv', 'OPENAI_API_KEY') || '').trim()
      }
    : { mode: providerMode };
  const projectOperationSeconds = project.timeoutSeconds === undefined
    ? undefined
    : Math.round(clampNumber(project.timeoutSeconds, 120, 10, 300, 'timeoutSeconds'));
  const operationSeconds = projectOperationSeconds ?? Math.round(clampNumber(
    getUserOnlySetting(config, 'reviewTimeoutSeconds', 600), 600, 30, 1800, 'reviewTimeoutSeconds'
  ));
  const requestSeconds = Math.round(clampNumber(
    getUserOnlySetting(config, 'requestTimeoutSeconds', 180), 180, 10, Math.min(900, operationSeconds), 'requestTimeoutSeconds'
  ));
  return normalizeCodexRuntimeOptions({
    provider,
    timeouts: {
      connectMs: Math.round(clampNumber(getUserOnlySetting(config, 'connectTimeoutSeconds', 15), 15, 1, 120, 'connectTimeoutSeconds')) * 1000,
      requestMs: Math.min(requestSeconds, operationSeconds) * 1000,
      operationMs: operationSeconds * 1000,
      idleMs: Math.round(clampNumber(getUserOnlySetting(config, 'streamIdleTimeoutSeconds', 60), 60, 5, 600, 'streamIdleTimeoutSeconds')) * 1000
    }
  });
}

async function getEffectiveOptions(repoRoot, headOid, token) {
  const config = vscode.workspace.getConfiguration('safeCodexReview', vscode.Uri.file(repoRoot));
  const { rules: project, source: policySource, fingerprint: policyFingerprint } = await readProjectRulesAtHead(repoRoot, headOid, token);

  const codexPath = String(getUserOnlySetting(config, 'codexPath', 'codex') || 'codex').trim();
  const model = String(getUserOnlySetting(config, 'model', '') || '').trim();
  if (!codexPath || codexPath.length > 1024 || /[\r\n\0]/.test(codexPath)) throw new Error(t('User-level safeCodexReview.codexPath is invalid.'));
  if (model.length > 128 || /[\r\n\0]/.test(model)) throw new Error(t('User-level safeCodexReview.model is invalid.'));

  const profile = resolveReviewProfile(String(getUserOnlySetting(config, 'profile', 'standard') || 'standard'));
  const sarifRaw = getUserOnlySetting(config, 'sarifFiles', []);
  if (!Array.isArray(sarifRaw) || sarifRaw.length > 8 || sarifRaw.some(value => typeof value !== 'string' || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value))) throw new Error('User-level safeCodexReview.sarifFiles is invalid.');
  const sarifFiles = Object.freeze(sarifRaw.map(value => value.trim()));

  const language = project.language ?? getUserOnlySetting(config, 'language', 'zh-CN');
  if (!['zh-CN', 'en'].includes(language)) throw new Error(t('Unsupported language: {0}', language));

  const severityThreshold = project.severityThreshold ?? getUserOnlySetting(config, 'severityThreshold', 'low');
  if (!(severityThreshold in SEVERITY_ORDER)) throw new Error(t('Unsupported severityThreshold: {0}', severityThreshold));

  const confidenceThreshold = clampNumber(
    project.confidenceThreshold ?? getUserOnlySetting(config, 'confidenceThreshold', 0.7),
    0.7, 0, 1, 'confidenceThreshold'
  );

  const contextBudgetBytes = Math.round(clampNumber(
    project.maxDiffBytes ?? getUserOnlySetting(config, 'maxDiffBytes', 524288),
    524288, 4096, 2097152, 'maxDiffBytes'
  ));

  const extraInstructions = [
    validateExtraInstructions(getUserOnlySetting(config, 'extraInstructions', '')),
    validateExtraInstructions(project.extraInstructions)
  ].filter(Boolean).join('\n');
  if (extraInstructions.length > 5000) throw new Error(t('The combined extraInstructions must not exceed 5000 characters.'));

  const reviewRules = Object.freeze({ ...(project.rules || {}) });
  const codexRuntime = runtimeOptions(config, project);
  const options = {
    codexPath,
    model,
    codexRuntime,
    profile: profile.name,
    profileConfig: profile,
    sarifFiles,
    repoRoot,
    language,
    maxDiffBytes: RAW_DIFF_HARD_LIMIT_BYTES,
    contextBudgetBytes,
    maxFindings: Math.round(clampNumber(project.maxFindings ?? getUserOnlySetting(config, 'maxFindings', 40), 40, 1, 100, 'maxFindings')),
    severityThreshold,
    confidenceThreshold,
    extraInstructions,
    reviewRules,
    policySource,
    projectPolicyFingerprint: policyFingerprint
  };

  options.policyFingerprint = fingerprintPolicy({
    language: options.language,
    maxDiffBytes: options.contextBudgetBytes,
    maxFindings: options.maxFindings,
    severityThreshold: options.severityThreshold,
    confidenceThreshold: options.confidenceThreshold,
    codexRuntime: options.codexRuntime,
    extraInstructions: options.extraInstructions,
    reviewRules: options.reviewRules,
    projectPolicyFingerprint: options.projectPolicyFingerprint,
    reviewProfile: options.profile,
    sarifEvidenceEnabled: options.sarifFiles.length > 0
  });
  return options;
}

module.exports = {
  RAW_DIFF_HARD_LIMIT_BYTES,
  readProjectRulesAtHead,
  runtimeOptions,
  getEffectiveOptions
};
