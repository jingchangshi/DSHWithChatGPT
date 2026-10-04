# Producer Windows Git gate — 2026-10-04

Consumer production candidate: 2fef84407d1e2c41e2b093b683345a56987530bd. Producer: 0afd708c288b079096affbfeff4626dcf9a19bf1, unchanged worktree.

The original native suite failed: 1 failed / 2 passed. The test containing all 13 fixed allowed Git reads exceeded its existing 5,000 ms total test deadline (reported 5,127 ms); each operation separately has a 20,000 ms authorized ceiling. This outcome does not identify which stage consumed the budget or prove an environment/per-query failure. No timeout, query, assertion, tripwire, snapshot or policy was changed. Root cause remains unclassified; this is a failed global gate, distinct from profile composition evidence.

The first attempted launcher used the consumer pnpm version and failed before executing tests because the Producer pins pnpm 11.7.0. The actual suite used npx --yes pnpm@11.7.0; both outputs are [retained](../evidence/consolidation-2026-10-04/README.md). This invocation failure is not a source/test failure and is not included in the test counts.

Future work should time fixture/provider setup, each original query, snapshot checks and cleanup under unchanged security limits, before choosing a production performance/lifecycle change. This consolidation does not claim to repair the pre-existing Producer gate.
