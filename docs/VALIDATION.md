# Validation scope

`npm run check` runs syntax, manifest, module boundary, localization, Family UI and governance checks, the bounded unit entrypoint, and the production build. `npm run test:integration` and `npm run test:trust` launch real VS Code Extension Hosts with controlled local CLI responses.

## Executable semantic fixtures

`quality/semantic-review-corpus.json` contains before/after source, causal anchors, and expected verification dispositions. `test/semantic-corpus.test.js` creates a real temporary Git repository for each case, commits the baseline, stages the change, and runs the production structural-evidence collector and Review controller.

The model adapter returns predetermined hypotheses and verification results. Tests inspect the generated requests, staged before/after text, dependency source, selected profile checks and exact evidence IDs. Production validation computes findings, coverage, fresh-run lineage, convergence, Review Receipt v5 and downstream delivery qualification. Positive cases remain blocked; the ownership-transfer negative requires contradictory evidence before complete fresh results can contribute to readiness.

This is a controller regression corpus with synthetic source fixtures. It does not measure live-model recall, precision or security effectiveness. Fixture counts and metadata labels are not quality scores.

`test/verification-behavior.test.js` additionally covers missing or insufficient results, absent staged IDs, unknown evidence IDs, missing symbols, budget omissions, profile propagation, literal Git identities, removed-line/rename attribution and mechanical failures. Missing mandatory evidence prevents the verifier call and stays incomplete through repeated fresh runs. Candidate truncation and response saturation remain explicit coverage gaps.

`test/cache-upgrade.test.js` loads the production controller key functions and a persisted previous-protocol cache. Identical Git input must miss old structural evidence, and old subject continuity must not cross the upgrade boundary.

## Release and dependency qualification

`npm run package` builds the actual VSIX. The release helper uses real local Git fixtures to verify synchronized metadata, dry runs, and rejection of unrelated changes or contract drift. See [Packaging dependency qualification](DEPENDENCY_QUALIFICATION.md) for the supported locked VSCE/Identity/MSAL graph, the scoped minimatch fix, and deterministic credential-boundary tests. No real model or production credential is used by these suites.

## 中文说明

语义 corpus 使用真实 Git 暂存区、生产证据收集与控制器，以及受控模型回答验证 findings、coverage、lineage、receipt 和交付资格。它检验控制链路，不证明真实模型质量。缺失必需证据、候选被截断或机械门禁失败时，结果必须保持不完整或阻断。
