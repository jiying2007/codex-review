'use strict';

const { runProcess } = require('./process');
const { isCliCompatibilityError } = require('./codex-safe-core/safe-contract');
const { createCodexCli } = require('./codex-safe-core/codex-cli');
const { buildSemanticContext } = require('./codex-safe-core/context-builder');
const { outputSchema, buildPrompt, validateReviewResult } = require('./review');

const capabilityCache = new Map();
const sharedCodexCli = createCodexCli({
  runPreparedProcess: runProcess,
  tempPrefix: 'codex-review-safe-',
  capabilityCache
});

const findWindowsCodexCandidates = sharedCodexCli.findWindowsCodexCandidates;
const resolveCodexExecutable = sharedCodexCli.resolveCodexExecutable;
const probeCodexCapabilities = sharedCodexCli.probeCodexCapabilities;
const buildCodexArgs = sharedCodexCli.buildCodexArgs;
const withTemporaryDirectory = sharedCodexCli.withTemporaryDirectory;

async function runCodexReview(diff, stagedPaths, options, token) {
  const prompt = buildPrompt(options, stagedPaths);
  const semantic = buildSemanticContext({
    files: stagedPaths,
    diff,
    maxBytes: options.contextBudgetBytes || options.maxDiffBytes
  });
  const input = [
    prompt,
    '',
    '--- STAGED CHANGE CONTEXT START ---',
    semantic.text,
    '--- STAGED CHANGE CONTEXT END ---',
    ''
  ].join('\n');

  const { parsed, resolved } = await sharedCodexCli.runStructuredCodex({
    codexPath: options.codexPath,
    model: options.model,
    timeoutMs: options.timeoutSeconds * 1000,
    schema: outputSchema(options),
    input,
    schemaFileName: 'review-schema.json',
    token,
    maxStdoutBytes: 6 * 1024 * 1024,
    maxStderrBytes: 1024 * 1024,
    processOptions: { detached: process.platform !== 'win32' }
  });

  const review = validateReviewResult(parsed, options, stagedPaths);
  review.executionMeta = {
    codexVersion: resolved.version || 'unknown',
    model: options.model || 'cli-default',
    contextTruncated: semantic.truncated,
    contextBudgetBytes: semantic.budgetBytes,
    inputDiffBytes: semantic.inputDiffBytes,
    truncatedSourceFiles: semantic.truncatedSourceFiles
  };
  return review;
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
