# Security

Codex Review reviews only Git staged changes and treats inline diagnostics as a fail-safe projection of a stable staged snapshot.

## Trust boundaries

- A trusted VS Code workspace is required.
- Virtual workspaces are unsupported.
- Review settings are User/Application scoped; workspace/folder settings cannot weaken policy.
- Repository `.codex-review.json` is read from the exact HEAD OID captured for the review snapshot, so a staged policy change cannot alter the review of itself.
- Finding paths must belong to staged changes and must remain inside the repository after realpath resolution.

## Repository consistency

HEAD + raw INDEX identity is checked before and after input collection, after Codex returns, and after inline diagnostics are published. Any mismatch fails safe and stale Problems are removed.

Dirty editor buffers and unstaged disk changes suppress inline diagnostics. File state is also checked around Range construction and monitored after publication.

## Codex execution

Codex is invoked non-interactively with structured output and a read-only sandbox. User/project Codex configuration and rules are ignored for this operation, and unnecessary tools/features are disabled.

Staged diff content is sent to Codex for inference. Follow your organization's source-code and data-handling policies.
