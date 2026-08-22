'use strict';

const { runProcess } = require('./process');
const { isCliCompatibilityError } = require('./codex-safe-core/safe-contract');
const { createCodexCli } = require('./codex-safe-core/codex-cli');
const { buildReviewEvidenceChunks } = require('./codex-safe-core/context-builder');
const {
  outputSchema,
  buildPrompt,
  parseChangedLineRanges,
  validateReviewResult,
  consolidateReviewResults
} = require('./review');

const REVIEW_CHUNK_LIMIT = 8;
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
  const evidence = buildReviewEvidenceChunks({
    diff,
    maxBytes: options.contextBudgetBytes || options.maxDiffBytes,
    maxChunks: REVIEW_CHUNK_LIMIT
  });
  const changedLineRanges = parseChangedLineRanges(diff);
  const results = [];
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  let resolvedVersion = 'not-run';

  for (const chunk of evidence.chunks) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      const error = new Error('Codex review timed out before all review chunks completed.');
      error.code = 'ETIMEDOUT';
      throw error;
    }
    const prompt = buildPrompt(options, chunk.paths, chunk.index, evidence.chunks.length);
    const input = [
      prompt,
      '',
      '--- STAGED REVIEW EVIDENCE START ---',
      chunk.text,
      '--- STAGED REVIEW EVIDENCE END ---',
      ''
    ].join('\n');
    const { parsed, resolved } = await sharedCodexCli.runStructuredCodex({
      codexPath: options.codexPath,
      model: options.model,
      timeoutMs: remainingMs,
      schema: outputSchema(options),
      input,
      schemaFileName: 'review-schema.json',
      token,
      maxStdoutBytes: 6 * 1024 * 1024,
      maxStderrBytes: 1024 * 1024,
      processOptions: { detached: process.platform !== 'win32' }
    });
    resolvedVersion = resolved.version || resolvedVersion;
    results.push(validateReviewResult(parsed, options, chunk.paths, changedLineRanges));
  }

  const review = consolidateReviewResults(results, options, stagedPaths, changedLineRanges, evidence);
  review.executionMeta = {
    codexVersion: resolvedVersion,
    model: options.model || 'cli-default',
    contextBudgetBytes: evidence.budgetBytes,
    inputDiffBytes: evidence.inputDiffBytes,
    reviewChunkCount: evidence.chunks.length,
    reviewChunkLimit: evidence.maxChunks,
    coverageVerdict: review.coverageVerdict,
    coverageGaps: review.coverageGaps,
    excludedEvidence: evidence.excluded
  };
  return review;
}

module.exports = {
  REVIEW_CHUNK_LIMIT,
  findWindowsCodexCandidates,
  resolveCodexExecutable,
  probeCodexCapabilities,
  buildCodexArgs,
  withTemporaryDirectory,
  runCodexReview,
  isCliCompatibilityError,
  _capabilityCache: capabilityCache
};
