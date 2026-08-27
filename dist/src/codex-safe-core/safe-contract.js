'use strict';

const crypto = require('crypto');
const CORE_CONTRACT = Object.freeze(require('./core-contract.json'));

const SAFE_CORE_VERSION = Number(CORE_CONTRACT.safeCoreMajorVersion);
const SAFE_CONTRACT_VERSION = Number(CORE_CONTRACT.safeContractVersion);
const REVIEW_RECEIPT_SCHEMA_VERSION = Number(CORE_CONTRACT.reviewReceiptVersion);
const COMMIT_RECEIPT_SCHEMA_VERSION = Number(CORE_CONTRACT.commitReceiptVersion);
const REVIEW_PROMPT_CONTRACT_VERSION = Number(CORE_CONTRACT.reviewPromptContractVersion);
const COMMIT_PROMPT_CONTRACT_VERSION = Number(CORE_CONTRACT.commitPromptContractVersion);
const PR_PROMPT_CONTRACT_VERSION = Number(CORE_CONTRACT.prPromptContractVersion);
const CURRENT_POLICY_SCHEMA_VERSION = Number(CORE_CONTRACT.policySchemaVersion);

const REQUIRED_CODEX_TOP_LEVEL_FLAGS = Object.freeze(['--ask-for-approval']);
const REQUIRED_CODEX_EXEC_FLAGS = Object.freeze([
  '--json','--ephemeral','--skip-git-repo-check','--ignore-user-config','--ignore-rules','--sandbox','--output-schema','--config'
]);
const SAFE_CODEX_CONFIG_OVERRIDES = Object.freeze([
  'web_search="disabled"','features.shell_tool=false','features.unified_exec=false','features.shell_snapshot=false',
  'features.apps=false','features.multi_agent=false','features.remote_plugin=false','features.hooks=false',
  'features.goals=false','features.memories=false','features.skill_mcp_dependency_install=false'
]);

const SAFE_CONTRACT_MANIFEST = Object.freeze({
  safeContractVersion: SAFE_CONTRACT_VERSION,
  approval: 'never',
  execution: 'ephemeral',
  sandbox: 'read-only',
  structuredOutput: true,
  ignoreUserConfig: true,
  ignoreRepositoryRules: true,
  skipGitRepoCheck: true,
  disabledCapabilities: Object.freeze([
    'web_search','shell_tool','unified_exec','shell_snapshot','apps','multi_agent','remote_plugin','hooks','goals','memories','skill_mcp_dependency_install'
  ])
});
const SAFE_CONTRACT_DIGEST = crypto.createHash('sha256').update(JSON.stringify(SAFE_CONTRACT_MANIFEST),'utf8').digest('hex');

const REVIEW_RECEIPT_KEYS = Object.freeze([
  'schemaVersion','kind','subject','diffFingerprint','policyFingerprint','qualityVerdict','readinessVerdict',
  'mechanicalGate','coverageVerdict','safeCoreVersion','safeContractVersion','policySchemaVersion','promptContractVersion',
  'model','requestedModel','resolvedModel','codexVersion','createdAt'
]);
const COMMIT_RECEIPT_KEYS = Object.freeze([
  'schemaVersion','kind','headOid','indexFingerprint','diffFingerprint','messageFingerprint','policyFingerprint',
  'reviewReceiptFingerprint','safeCoreVersion','safeContractVersion','policySchemaVersion','promptContractVersion',
  'model','requestedModel','resolvedModel','codexVersion','createdAt','commitOid'
]);
const REVIEW_RECEIPT_INPUT_KEYS = Object.freeze(REVIEW_RECEIPT_KEYS);
const COMMIT_RECEIPT_INPUT_KEYS = Object.freeze(COMMIT_RECEIPT_KEYS);
const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function buildSafeCodexArgs(schemaPath, model = '') {
  const args = ['--ask-for-approval','never','exec','--json','--ephemeral','--skip-git-repo-check','--ignore-user-config','--ignore-rules','--sandbox','read-only','--output-schema',schemaPath];
  for (const value of SAFE_CODEX_CONFIG_OVERRIDES) args.push('--config', value);
  if (model) args.push('--model', model);
  args.push('-');
  return args;
}
function missingHelpFlags(helpText, requiredFlags) { const text = String(helpText || ''); return requiredFlags.filter(flag => !text.includes(flag)); }
function isCliCompatibilityError(error) {
  const text = `${error?.stderr || ''}\n${error?.stdout || ''}\n${error?.message || ''}`.toLowerCase();
  return ['unexpected argument','unknown argument','unrecognized option','unknown option','unknown feature','unknown config key','unrecognized config key'].some(fragment => text.includes(fragment));
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex'); }
const fingerprintPolicy = fingerprint;
function validCommitOid(value) { return /^[0-9a-f]{40,64}$/i.test(String(value || '')); }
function validOid(value) { return value === '<unborn>' || validCommitOid(value); }
function validHash(value, allowNone = false) { return (allowNone && value === '<none>') || /^[0-9a-f]{64}$/i.test(String(value || '')); }
function validMetadataString(value) { return value === undefined || (typeof value === 'string' && value.length <= 256 && !/[\r\n\0]/.test(value)); }
function validTimestamp(value) { if (typeof value !== 'string' || !ISO_UTC_TIMESTAMP.test(value)) return false; const time = Date.parse(value); return Number.isFinite(time) && new Date(time).toISOString() === value; }
function hasOnlyKeys(value, allowedKeys) { const allowed = new Set(allowedKeys); return Object.keys(value).every(key => allowed.has(key)); }
function copyAllowed(value, allowedKeys) { return Object.fromEntries(allowedKeys.filter(key => Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]])); }
function deepFreezeCopy(value) { if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeCopy)); if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v]) => [k, deepFreezeCopy(v)]))); return value; }
function matchesOptionalVersion(value, key, expected) { return value[key] === undefined || value[key] === expected; }
function canonicalProvenance(value, promptVersion) {
  if (!matchesOptionalVersion(value,'safeCoreVersion',SAFE_CORE_VERSION) || !matchesOptionalVersion(value,'safeContractVersion',SAFE_CONTRACT_VERSION) || !matchesOptionalVersion(value,'policySchemaVersion',CURRENT_POLICY_SCHEMA_VERSION) || !matchesOptionalVersion(value,'promptContractVersion',promptVersion)) return null;
  if (![value.model,value.requestedModel,value.resolvedModel,value.codexVersion].every(validMetadataString)) return null;
  const model = typeof value.model === 'string' && value.model ? value.model : 'cli-default';
  const requestedModel = typeof value.requestedModel === 'string' ? value.requestedModel : (model === 'cli-default' ? '' : model);
  const resolvedModel = typeof value.resolvedModel === 'string' && value.resolvedModel ? value.resolvedModel : model;
  const codexVersion = typeof value.codexVersion === 'string' && value.codexVersion ? value.codexVersion : 'unknown';
  return Object.freeze({safeCoreVersion:SAFE_CORE_VERSION,safeContractVersion:SAFE_CONTRACT_VERSION,policySchemaVersion:CURRENT_POLICY_SCHEMA_VERSION,promptContractVersion:promptVersion,model,requestedModel,resolvedModel,codexVersion});
}

function validateReviewSubject(subject) {
  if (!subject || typeof subject !== 'object' || Array.isArray(subject) || typeof subject.type !== 'string') return null;
  if (subject.type === 'git-index') {
    const keys = ['type','headOid','indexFingerprint','stagedFileCount'];
    if (!hasOnlyKeys(subject, keys) || !validOid(subject.headOid) || !validHash(subject.indexFingerprint)) return null;
    if (!Number.isInteger(subject.stagedFileCount) || subject.stagedFileCount < 0 || subject.stagedFileCount > 5000) return null;
    return deepFreezeCopy(subject);
  }
  if (subject.type === 'gitlab-mr') {
    const keys = ['type','projectId','mrIid','startSha','headSha'];
    if (!hasOnlyKeys(subject, keys)) return null;
    if (!Number.isInteger(subject.projectId) || subject.projectId <= 0 || !Number.isInteger(subject.mrIid) || subject.mrIid <= 0) return null;
    if (!validCommitOid(subject.startSha) || !validCommitOid(subject.headSha)) return null;
    return deepFreezeCopy(subject);
  }
  return null;
}
function validateReviewReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasOnlyKeys(value, REVIEW_RECEIPT_INPUT_KEYS)) return null;
  if (value.schemaVersion !== REVIEW_RECEIPT_SCHEMA_VERSION || value.kind !== 'codex-review') return null;
  const subject = validateReviewSubject(value.subject); if (!subject) return null;
  if (!validHash(value.diffFingerprint) || !validHash(value.policyFingerprint, true)) return null;
  if (!['no_findings','findings_open','blocked'].includes(value.qualityVerdict)) return null;
  if (!['needs_evidence','blocked','ready'].includes(value.readinessVerdict)) return null;
  if (!['not_run','pass','fail'].includes(value.mechanicalGate)) return null;
  if (!['complete','incomplete'].includes(value.coverageVerdict)) return null;
  const provenance = canonicalProvenance(value, REVIEW_PROMPT_CONTRACT_VERSION); if (!provenance) return null;
  if (!validTimestamp(value.createdAt)) return null;
  return deepFreezeCopy({...copyAllowed(value, REVIEW_RECEIPT_KEYS), ...provenance, subject});
}
function validateCommitReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasOnlyKeys(value, COMMIT_RECEIPT_INPUT_KEYS)) return null;
  if (value.schemaVersion !== COMMIT_RECEIPT_SCHEMA_VERSION || value.kind !== 'codex-commit-safe') return null;
  for (const key of ['headOid','indexFingerprint','diffFingerprint','messageFingerprint','policyFingerprint','reviewReceiptFingerprint','createdAt']) if (typeof value[key] !== 'string' || !value[key]) return null;
  if (!validOid(value.headOid) || !validHash(value.indexFingerprint) || !validHash(value.diffFingerprint) || !validHash(value.messageFingerprint)) return null;
  if (!validHash(value.policyFingerprint, true) || !validHash(value.reviewReceiptFingerprint, true)) return null;
  if (value.commitOid !== undefined && value.commitOid !== '<pending>' && !validCommitOid(value.commitOid)) return null;
  const provenance = canonicalProvenance(value, COMMIT_PROMPT_CONTRACT_VERSION); if (!provenance) return null;
  if (!validTimestamp(value.createdAt)) return null;
  return deepFreezeCopy({...copyAllowed(value, COMMIT_RECEIPT_KEYS), ...provenance});
}

module.exports = {
  CORE_CONTRACT,SAFE_CORE_VERSION,SAFE_CONTRACT_VERSION,REVIEW_RECEIPT_SCHEMA_VERSION,COMMIT_RECEIPT_SCHEMA_VERSION,
  REVIEW_PROMPT_CONTRACT_VERSION,COMMIT_PROMPT_CONTRACT_VERSION,PR_PROMPT_CONTRACT_VERSION,CURRENT_POLICY_SCHEMA_VERSION,
  REQUIRED_CODEX_TOP_LEVEL_FLAGS,REQUIRED_CODEX_EXEC_FLAGS,SAFE_CODEX_CONFIG_OVERRIDES,SAFE_CONTRACT_MANIFEST,SAFE_CONTRACT_DIGEST,
  REVIEW_RECEIPT_KEYS,COMMIT_RECEIPT_KEYS,buildSafeCodexArgs,missingHelpFlags,isCliCompatibilityError,
  fingerprint,fingerprintPolicy,validateReviewSubject,validateReviewReceipt,validateCommitReceipt
};
