# Token efficiency

Codex Review Safe uses Codex Safe Core v4.3 efficiency primitives. The staged review now applies one bounded evidence budget across all chunks instead of allowing every chunk to consume the full cap independently. By default the total evidence allowance is at most two per-chunk budgets (and never more than 2 MiB); higher-risk evidence is selected first when that budget cannot cover every chunk, and any omission remains an explicit coverage gap so the verdict fails closed.

Each chunk is conservatively preflighted against a review-wide token budget, actual Codex token usage is accumulated, and execution metadata records planned/executed chunks, estimated tokens, actual usage and effective models. Safety, exact changed-line anchoring, deterministic review rules and Review Receipt semantics are unchanged.
