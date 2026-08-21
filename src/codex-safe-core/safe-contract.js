'use strict';

const crypto = require('crypto');

const SAFE_CORE_VERSION = 1;
const SAFE_CONTRACT_VERSION = 1;
const REVIEW_RECEIPT_SCHEMA_VERSION = 1;

const REQUIRED_CODEX_TOP_LEVEL_FLAGS = Object.freeze(['--ask-for-approval']);
const REQUIRED_CODEX_EXEC_FLAGS = Object.freeze([
  '--json',
  '--ephemeral',
  '--skip-git-repo-check',
  '--ignore-user-config',
  '--ignore-rules',
  '--sandbox',
  '--output-schema',
  '--config'
]);
const SAFE_CODEX_CONFIG_OVERRIDES = Object.freeze([
  'web_search="disabled"',
  'features.shell_tool=false',
  'features.unified_exec=false',
  'features.shell_snapshot=false',
  'features.apps=false',
  'features.multi_agent=false',
  'features.remote_plugin=false',
  'features.hooks=false',
  'features.goals=false',
  'features.memories=false',
  'features.skill_mcp_dependency_install=false'
]);

function buildSafeCodexArgs(schemaPath, model = '') {
  const args = [
    '--ask-for-approval', 'never',
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--output-schema', schemaPath
  ];
  for (const value of SAFE_CODEX_CONFIG_OVERRIDES) args.push('--config', value);
  if (model) args.push('--model', model);
  args.push('-');
  return args;
}

function missingHelpFlags(helpText, requiredFlags) {
  const text = String(helpText || '');
  return requiredFlags.filter(flag => !text.includes(flag));
}

function isCliCompatibilityError(error) {
  const text = `${error?.stderr || ''}\n${error?.stdout || ''}\n${error?.message || ''}`.toLowerCase();
  return [
    'unexpected argument',
    'unknown argument',
    'unrecognized option',
    'unknown option',
    'unknown feature',
    'unknown config key',
    'unrecognized config key'
  ].some(fragment => text.includes(fragment));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function fingerprintPolicy(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

function validateReviewReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== REVIEW_RECEIPT_SCHEMA_VERSION || value.kind !== 'codex-review-safe') return null;
  for (const key of ['headOid', 'indexFingerprint', 'diffFingerprint', 'policyFingerprint', 'qualityVerdict', 'readinessVerdict', 'mechanicalGate', 'createdAt']) {
    if (typeof value[key] !== 'string' || !value[key]) return null;
  }
  if (value.headOid !== '<unborn>' && !/^[0-9a-f]{40,64}$/i.test(value.headOid)) return null;
  if (!/^[0-9a-f]{64}$/i.test(value.indexFingerprint) || !/^[0-9a-f]{64}$/i.test(value.diffFingerprint)) return null;
  if (value.policyFingerprint !== '<none>' && !/^[0-9a-f]{64}$/i.test(value.policyFingerprint)) return null;
  if (!['no_findings', 'findings_open', 'blocked'].includes(value.qualityVerdict)) return null;
  if (!['needs_evidence', 'blocked', 'ready'].includes(value.readinessVerdict)) return null;
  if (!['not_run', 'pass', 'fail'].includes(value.mechanicalGate)) return null;
  if (!Number.isInteger(value.stagedFileCount) || value.stagedFileCount < 0 || value.stagedFileCount > 5000) return null;
  if (!Number.isFinite(Date.parse(value.createdAt))) return null;
  for (const key of ['model', 'codexVersion']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 256 || /[\r\n\0]/.test(value[key]))) return null;
  }
  return Object.freeze({ ...value });
}

module.exports = {
  SAFE_CORE_VERSION,
  SAFE_CONTRACT_VERSION,
  REVIEW_RECEIPT_SCHEMA_VERSION,
  REQUIRED_CODEX_TOP_LEVEL_FLAGS,
  REQUIRED_CODEX_EXEC_FLAGS,
  SAFE_CODEX_CONFIG_OVERRIDES,
  buildSafeCodexArgs,
  missingHelpFlags,
  isCliCompatibilityError,
  fingerprintPolicy,
  validateReviewReceipt
};
