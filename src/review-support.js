'use strict';

const path = require('path');
const { POLICY_FILE } = require('./codex-safe-core/policy');
const { t } = require('./i18n');

const PROJECT_RULES_FILE = POLICY_FILE;

const SEVERITY_ORDER = Object.freeze({
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
});

function normalizeFsPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizeGitPathForComparison(value) {
  const text = String(value || '');
  return process.platform === 'win32' ? text.replace(/\\/g, '/') : text;
}

function clampNumber(value, fallback, min, max, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) {
    throw new Error(t('{0} is outside the allowed range: {1} (allowed {2}–{3}).', name, n, min, max));
  }
  return n;
}

function validateExtraInstructions(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(t('extraInstructions must be a string.'));
  const text = value.trim();
  if (text.length > 5000) throw new Error(t('extraInstructions must not exceed 5000 characters.'));
  return text;
}

function getUserOnlySetting(config, key, fallback) {
  const inspected = config.inspect(key);
  if (!inspected) return fallback;
  if (inspected.globalLanguageValue !== undefined) return inspected.globalLanguageValue;
  if (inspected.globalValue !== undefined) return inspected.globalValue;
  return inspected.defaultValue !== undefined ? inspected.defaultValue : fallback;
}

module.exports = Object.freeze({
  PROJECT_RULES_FILE,
  SEVERITY_ORDER,
  normalizeFsPath,
  normalizeGitPathForComparison,
  clampNumber,
  validateExtraInstructions,
  getUserOnlySetting
});
