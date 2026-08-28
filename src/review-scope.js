'use strict';

const { canonicalJson, sha256 } = require('./codex-safe-core/semantic-review');

const REVIEW_SCOPE_FILE = '.codex-review-scope.json';
const REVIEW_SCOPE_SCHEMA_VERSION = 1;
const MAX_SCOPE_BYTES = 32 * 1024;
const ARRAY_LIMITS = Object.freeze({ goals: 24, invariants: 48, nonGoals: 48, managedPaths: 48 });
const COMPLEXITY_BUDGETS = Object.freeze(['minimal', 'balanced', 'extended']);

function boundedString(value, name, max = 500) {
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  const text = value.trim();
  if (!text || text.length > max || /[\0]/.test(text)) throw new Error(`${name} is invalid.`);
  return text;
}
function boundedArray(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > ARRAY_LIMITS[name]) throw new Error(`${name} is invalid.`);
  return [...new Set(value.map((item, index) => boundedString(item, `${name}[${index}]`)))];
}
function normalizeReviewScope(raw, { present = true, source = REVIEW_SCOPE_FILE } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Review scope must be a JSON object.');
  const allowed = new Set(['schemaVersion','phase','goals','invariants','nonGoals','managedPaths','complexityBudget','notes']);
  const unknown = Object.keys(raw).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`Review scope contains unsupported fields: ${unknown.join(', ')}`);
  if (Number(raw.schemaVersion ?? REVIEW_SCOPE_SCHEMA_VERSION) !== REVIEW_SCOPE_SCHEMA_VERSION) throw new Error(`Unsupported review scope schemaVersion: ${raw.schemaVersion}`);
  const complexityBudget = String(raw.complexityBudget || 'balanced');
  if (!COMPLEXITY_BUDGETS.includes(complexityBudget)) throw new Error(`Unsupported complexityBudget: ${complexityBudget}`);
  const scope = {
    schemaVersion: REVIEW_SCOPE_SCHEMA_VERSION,
    present: Boolean(present),
    source,
    phase: raw.phase ? boundedString(raw.phase, 'phase', 160) : 'unspecified',
    goals: boundedArray(raw.goals, 'goals'),
    invariants: boundedArray(raw.invariants, 'invariants'),
    nonGoals: boundedArray(raw.nonGoals, 'nonGoals'),
    managedPaths: boundedArray(raw.managedPaths, 'managedPaths'),
    complexityBudget,
    notes: raw.notes ? boundedString(raw.notes, 'notes', 1200) : ''
  };
  scope.fingerprint = sha256(canonicalJson({
    schemaVersion: scope.schemaVersion,
    phase: scope.phase,
    goals: scope.goals,
    invariants: scope.invariants,
    nonGoals: scope.nonGoals,
    managedPaths: scope.managedPaths,
    complexityBudget: scope.complexityBudget,
    notes: scope.notes
  }));
  return Object.freeze(scope);
}
function defaultReviewScope() {
  return normalizeReviewScope({ schemaVersion: 1, phase: 'unspecified', complexityBudget: 'balanced' }, { present: false, source: 'default' });
}
async function loadReviewScope(repoRoot, headOid, token) {
  if (!headOid || headOid === '<unborn>') return defaultReviewScope();
  const { git } = require('./git');
  try {
    const { stdout } = await git(['show', `${headOid}:${REVIEW_SCOPE_FILE}`], repoRoot, token, { maxStdoutBytes: MAX_SCOPE_BYTES + 1, maxStderrBytes: 128 * 1024 });
    if (Buffer.byteLength(stdout, 'utf8') > MAX_SCOPE_BYTES) throw new Error(`${REVIEW_SCOPE_FILE} exceeds ${MAX_SCOPE_BYTES} bytes.`);
    return normalizeReviewScope(JSON.parse(stdout));
  } catch (error) {
    if (error?.code === 'ECANCELLED') throw error;
    const stderr = String(error?.stderr || '');
    if (Number(error?.code) === 128 || /does not exist|exists on disk, but not in/i.test(stderr)) return defaultReviewScope();
    if (error instanceof SyntaxError) throw new Error(`${REVIEW_SCOPE_FILE} is not valid JSON.`);
    throw error;
  }
}
function scopePromptBlock(scope) {
  if (!scope?.present) return 'Review Scope Contract: none supplied. Do not invent product non-goals or widen the task beyond the staged change.';
  return [
    '--- REVIEW SCOPE CONTRACT (TRUSTED CONTROLLER METADATA) ---',
    `Phase: ${scope.phase}`,
    `Complexity budget: ${scope.complexityBudget}`,
    `Goals: ${scope.goals.length ? scope.goals.join(' | ') : '<none>'}`,
    `Explicit invariants: ${scope.invariants.length ? scope.invariants.join(' | ') : '<none>'}`,
    `Non-goals: ${scope.nonGoals.length ? scope.nonGoals.join(' | ') : '<none>'}`,
    `Managed paths: ${scope.managedPaths.length ? scope.managedPaths.join(' | ') : '<unspecified>'}`,
    'Do not turn a non-goal into a blocker merely because a broader redesign could reduce risk. A changed line that violates an explicit invariant remains in scope.',
    '--- END REVIEW SCOPE CONTRACT ---'
  ].join('\n');
}
function invariantMatches(scope, value) {
  const target = String(value || '').trim();
  return Boolean(scope?.present && target && scope.invariants.includes(target));
}
function scopeDispositionAllowsPublish(scope, disposition, invariant) {
  if (!scope?.present) return true;
  if (String(disposition || 'in_scope') === 'in_scope') return true;
  return invariantMatches(scope, invariant);
}

module.exports = {
  REVIEW_SCOPE_FILE,
  REVIEW_SCOPE_SCHEMA_VERSION,
  MAX_SCOPE_BYTES,
  COMPLEXITY_BUDGETS,
  normalizeReviewScope,
  defaultReviewScope,
  loadReviewScope,
  scopePromptBlock,
  invariantMatches,
  scopeDispositionAllowsPublish
};
