# Validation scope

`npm run check` runs syntax, manifest, module boundary, localization, UI-contract and governance checks, product behavior tests, and the production build. `npm run test:integration` and `npm run test:trust` launch real VS Code Extension Hosts. These tests use controlled local CLI responses and require no paid model.

## Executable semantic fixtures

`quality/semantic-review-corpus.json` contains before/after source files, causal anchors, and the expected verification disposition for each fixture. `test/semantic-corpus.test.js` creates a real temporary Git repository per case, commits the baseline, stages the change, and runs the production structural-evidence collector and Review pipeline.

The model adapter returns a predetermined candidate and verification result. Tests inspect the actual generated requests, including staged before/after text, dependency source, selected Profile Pack checks, and exact evidence IDs. Production validation then computes findings, coverage, fresh-run lineage, convergence, Review Receipt v5, and downstream delivery qualification. Positive cases must remain blocked; the ownership-transfer negative must be contradicted by supplied caller/callee evidence before a complete fresh result can contribute to readiness.

This is a controller regression corpus with synthetic source fixtures. It is not a live-model recall, precision, or security-effectiveness benchmark. The count of fixtures is not a quality score, and metadata labels alone are not test evidence.

`test/verification-behavior.test.js` additionally exercises missing or insufficient verifier output, missing staged IDs, unknown evidence IDs, missing required symbols, evidence-budget omission, Profile Pack propagation, genuine `a/` and `b/` directory identity, removed-line/rename parsing, and failed mechanical gates. Unresolved mandatory evidence must remain incomplete after repeated fresh runs and must not qualify for delivery.

## Packaging dependencies

The VSIX contains explicit production modules without development `node_modules`. `@vscode/vsce` remains on 3.9.2. Development-only `@azure/identity` is constrained to 4.13.0, within VSCE's declared `^4.1.0` range, to avoid GHSA-xcx6-jx8p-x3h5 in Identity 4.13.1–4.14.0's MSAL 5.x/6.x dependency. Remove this constraint after a compatible upstream patch is available and package validation passes; do not force an incompatible MSAL major.

MSAL 3.x only uses the named CommonJS `uuid.v4()` API. Its UUID dependency is narrowly overridden to fixed 11.1.1 to address GHSA-w5hq-g745-h8pq without replacing MSAL. `test/packaging-dependencies.test.js` resolves the actual VSCE → Identity → MSAL dependency chain and executes `CryptoProvider.createNewGuid()`; VSIX packaging remains a required check. This targeted override must be reconsidered together with the Identity constraint on the next upstream update.

## 中文说明

语义 corpus 已由标签清单变成可执行源码 fixture：真实 Git 建立基线并暂存修改，生产代码构造证据和实际模型请求，然后用受控回答经过真实 finding、coverage、lineage、receipt 和交付资格判定。测试会核对 verifier 确实拿到 staged 前后变化和引用 ID；缺失必需证据即使重复 fresh review 也不能 ready。该 corpus 检验控制链路，不衡量真实模型召回率、精度或安全审查效果。
