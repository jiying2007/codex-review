# Getting Started with Codex Review Safe

## 1. Install prerequisites

Install VS Code 1.90+, Git and OpenAI Codex CLI in the environment that hosts the workspace Extension Host:

```bash
codex --version
```

For the built-in OpenAI provider, authenticate Codex in that environment as usual:

```bash
codex login
```

Remote SSH, Dev Containers, Codespaces and WSL require Codex inside the remote environment. The Codex executable and provider credentials must be visible to the workspace Extension Host.

## 2. Install the extension

Install `jiying2007.codex-review-safe` from the VS Code Marketplace or install the immutable VSIX from a GitHub Release.

## 3. Use an OpenAI-compatible relay

Codex Review Safe intentionally runs Codex with `--ignore-user-config` to preserve the Safe Contract, so it **does not inherit relay/provider settings from `~/.codex/config.toml`**. Your normal terminal Codex may continue to use that file, but Review Safe requires an explicit provider configuration.

Configure VS Code User Settings JSON:

```json
{
  "safeCodexReview.providerMode": "openai-compatible",
  "safeCodexReview.providerBaseUrl": "https://relay.example.com/v1",
  "safeCodexReview.providerApiKeyEnv": "CODEX_RELAY_API_KEY",
  "safeCodexReview.model": "gpt-5.2"
}
```

Rules:

- `providerBaseUrl` must be an HTTPS base URL without embedded credentials, query parameters or fragments;
- `providerApiKeyEnv` is the **name of an environment variable**, never the API key value itself;
- `model` may be empty to use the provider default, but set it explicitly when the relay exposes its own model aliases;
- the relay must implement the OpenAI **Responses API** (`/v1/responses`) with SSE/Structured Output compatibility; supporting only `/v1/chat/completions` is not sufficient;
- compatible providers use Responses HTTP/SSE and do not use WebSocket transport.

### Make the key visible to the VS Code Extension Host

Linux/macOS:

```bash
export CODEX_RELAY_API_KEY="sk-xxxx"
code .
```

Windows PowerShell:

```powershell
$env:CODEX_RELAY_API_KEY="sk-xxxx"
code .
```

Exporting a variable later inside an already-open VS Code integrated terminal does not inject it back into the running Extension Host. Fully exit VS Code and restart it from an environment that already contains the variable.

For Remote SSH, WSL, Dev Containers and Codespaces, configure the key in the **remote Extension Host environment**, not only on the desktop host.

Commit Safe, Review Safe and PR Safe may all point `providerApiKeyEnv` at the same `CODEX_RELAY_API_KEY` when they use the same relay.

## 4. Check the environment

Open a trusted Git workspace and run:

**Codex Review Safe: Check Codex Environment**

The current check does more than inspect the Codex executable and CLI flags. It performs a minimal structured model round-trip through the exact Safe Runtime/provider configuration used by a real review. Treat the environment as ready only after this check succeeds.

Provider failures are classified separately for DNS, connect, TLS, authentication, rate limiting, model selection and request timeout. Do not hide provider/DNS failures by only increasing the whole-review timeout.

## 5. Run the first review

```bash
git status --short
git add <files>
git diff --cached --stat
```

Then run **Review Staged Changes**. Only the staged snapshot is reviewed; unstaged edits are intentionally ignored.

## 6. Optional repository policy

Commit `.codex-safe.json` to the repository target branch to set language, evidence budget, thresholds and deterministic rules. Policy changes take effect only after they are committed.

## Common problems

### Terminal Codex works, but relay-backed Review still fails

Verify that `safeCodexReview.providerMode` is `openai-compatible` instead of relying only on `~/.codex/config.toml`. Then verify that the configured key environment variable is visible to the Extension Host and rerun **Check Codex Environment**.

### Logs still show `api.openai.com`

Relay mode should not fall back to the built-in OpenAI endpoint. Recheck `providerMode`, `providerBaseUrl`, `providerApiKeyEnv`, restart the Extension Host environment and run the environment check again. Do not merely raise the timeout.

### Relay supports Chat Completions only

The compatible provider requires the Responses API. A relay exposing only `/v1/chat/completions` needs a Responses-compatible layer before Review Safe can use it.

### No staged changes

Stage the intended files with `git add`. Review Safe does not review working-tree-only edits.

### Codex executable not found

Run `codex --version` in the same local/remote environment as the VS Code workspace. Set `safeCodexReview.codexPath` if needed.

### Restricted Mode

Trust the workspace first. Review execution is intentionally disabled in Restricted Mode.

### Coverage incomplete

The review fails closed when a changed hunk cannot be covered within the configured evidence limits. Reduce the change or adjust the reviewed repository policy after evaluating the risk.

## Upgrade

Upgrade from Marketplace or replace the VSIX with a newer immutable release, reload VS Code, then run **Check Codex Environment** before the first review.
