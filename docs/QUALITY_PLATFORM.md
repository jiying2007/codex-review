# Quality Platform

Codex Review Safe 4.1 consumes Safe Core 4.4 quality primitives. `quick`, `standard`, `deep`, `security`, and `embedded` are user execution profiles rather than repository policy. Impact evidence is collected locally from bounded tracked-file candidates and scored by Core. SARIF is imported only from pre-generated repository files; the extension never executes analyzer commands.

Fixes are opt-in: a validated finding can request one structured unified-diff proposal, Core rejects binary/out-of-evidence patches, VS Code opens a read-only diff preview, and the patch is applied to the working tree only after explicit user confirmation. The extension never commits, pushes, or merges. Re-review remains a separate explicit action after the user inspects/stages the intended change.
