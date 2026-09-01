# Token Efficiency

Review 4.4.3 keeps deterministic structural Evidence Cache persistent while model Judgment Replay is session-only. For an unchanged ReviewSubject the default cadence is `fresh → replay → replay → fresh`, bounded by a 10-minute replay age. Fresh runs reuse structural evidence but remain blind to prior judgments. Analyzer/SARIF evidence is recomposed each invocation. This preserves periodic independent model discovery while avoiding repeated index/symbol/impact scans and two out of every three model calls during rapid repeated Review.
