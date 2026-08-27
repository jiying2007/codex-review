'use strict';

const { runProcess } = require('./process');
const { isCliCompatibilityError } = require('./codex-safe-core/safe-contract');
const { createCodexCli } = require('./codex-safe-core/codex-cli');
const { buildReviewEvidenceChunks } = require('./codex-safe-core/context-builder');
const {
  usageShape,
  usageAdd,
  estimateRequestTokens,
  scoreEvidenceRisk,
  selectModel,
  selectChunksWithinByteBudget
} = require('./codex-safe-core/efficiency-planner');
const {
  outputSchema,
  buildPrompt,
  parseChangedLineRanges,
  validateReviewResult,
  consolidateReviewResults
} = require('./review');

const REVIEW_CHUNK_LIMIT = 8;
const DEFAULT_REVIEW_TOKEN_BUDGET = 250000;
const DEFAULT_TOTAL_EVIDENCE_CAP_BYTES = 2 * 1024 * 1024;
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

function configuredTokenBudget(options) {
  return Number.isFinite(options?.maxTokenBudget)
    ? Math.max(0, Math.floor(options.maxTokenBudget))
    : DEFAULT_REVIEW_TOKEN_BUDGET;
}
function configuredTotalEvidenceBudget(options, chunkBudgetBytes) {
  if (Number.isFinite(options?.totalContextBudgetBytes)) return Math.max(0, Math.floor(options.totalContextBudgetBytes));
  return Math.min(DEFAULT_TOTAL_EVIDENCE_CAP_BYTES, Math.max(chunkBudgetBytes, chunkBudgetBytes * 2));
}

async function runCodexReview(diff, stagedPaths, options, token) {
  const chunkBudgetBytes = options.contextBudgetBytes || options.maxDiffBytes;
  const rawEvidence = buildReviewEvidenceChunks({
    diff,
    maxBytes: chunkBudgetBytes,
    maxChunks: REVIEW_CHUNK_LIMIT
  });
  const totalBudgetBytes = configuredTotalEvidenceBudget(options, chunkBudgetBytes);
  const bytePlan = selectChunksWithinByteBudget(rawEvidence.chunks, totalBudgetBytes);
  const coverageGaps = [...rawEvidence.coverageGaps];
  if (!bytePlan.complete) {
    for (const chunk of bytePlan.omitted) {
      coverageGaps.push(`cost_budget:${(chunk.paths || []).join(',') || `chunk-${Number(chunk.index) + 1}`}`);
    }
  }
  const evidence = {
    ...rawEvidence,
    chunks: bytePlan.chunks,
    complete: rawEvidence.complete && bytePlan.complete,
    coverageGaps
  };
  const changedLineRanges = parseChangedLineRanges(diff);
  const results = [];
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  const tokenBudget = configuredTokenBudget(options);
  const usage = { ...usageShape() };
  const models = new Set();
  let estimatedTokens = 0;
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
    const riskScore = scoreEvidenceRisk({ paths: chunk.paths, text: chunk.text });
    const model = selectModel({ model: options.model, fastModel: options.fastModel, riskScore });
    const estimatedOutputTokens = 512 + Math.max(1, Number(options.maxFindings) || 20) * 180;
    const estimate = estimateRequestTokens(input, { estimatedOutputTokens });
    if (tokenBudget > 0 && estimatedTokens + estimate.totalTokens > tokenBudget) {
      evidence.complete = false;
      coverageGaps.push(`token_budget:chunk-${chunk.index + 1}`);
      break;
    }
    const result = await sharedCodexCli.runStructuredCodex({
      codexPath: options.codexPath,
      model,
      timeoutMs: remainingMs,
      schema: outputSchema(options),
      input,
      schemaFileName: 'review-schema.json',
      token,
      maxStdoutBytes: 6 * 1024 * 1024,
      maxStderrBytes: 1024 * 1024,
      processOptions: { detached: process.platform !== 'win32' },
      maxEstimatedTokens: tokenBudget > 0 ? Math.max(1, tokenBudget - estimatedTokens) : 0,
      estimatedOutputTokens
    });
    estimatedTokens += result.requestEstimate?.totalTokens || estimate.totalTokens;
    usageAdd(usage, result.usage);
    resolvedVersion = result.resolved.version || resolvedVersion;
    models.add(model || 'cli-default');
    results.push(validateReviewResult(result.parsed, options, chunk.paths, changedLineRanges));
  }

  evidence.coverageGaps = coverageGaps;
  const review = consolidateReviewResults(results, options, stagedPaths, changedLineRanges, evidence);
  review.executionMeta = {
    codexVersion: resolvedVersion,
    model: [...models].join(',') || options.model || 'cli-default',
    contextBudgetBytes: evidence.budgetBytes,
    totalContextBudgetBytes: totalBudgetBytes,
    inputDiffBytes: evidence.inputDiffBytes,
    reviewChunkCount: results.length,
    plannedChunkCount: evidence.chunks.length,
    reviewChunkLimit: evidence.maxChunks,
    tokenBudget,
    estimatedTokens,
    usage,
    coverageVerdict: review.coverageVerdict,
    coverageGaps: review.coverageGaps,
    excludedEvidence: evidence.excluded
  };
  return review;
}

module.exports = {
  REVIEW_CHUNK_LIMIT,
  DEFAULT_REVIEW_TOKEN_BUDGET,
  DEFAULT_TOTAL_EVIDENCE_CAP_BYTES,
  configuredTokenBudget,
  configuredTotalEvidenceBudget,
  findWindowsCodexCandidates,
  resolveCodexExecutable,
  probeCodexCapabilities,
  buildCodexArgs,
  withTemporaryDirectory,
  runCodexReview,
  isCliCompatibilityError,
  _capabilityCache: capabilityCache
};
