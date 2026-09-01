# Token 效率

Review 4.4.3 持久化复用确定性的结构 Evidence Cache，但模型 Judgment Replay 只存在于当前会话。同一 ReviewSubject 默认节奏为 `fresh → replay → replay → fresh`，并受 10 分钟 replay age 上限约束。Fresh run 可以复用结构证据，但对历史 Judgment 保持 blind；Analyzer/SARIF 每次重新组合。这样既能周期性重新发现问题，又避免重复 index/symbol/impact 扫描，并在快速重复 Review 时节省约三分之二的模型调用。
