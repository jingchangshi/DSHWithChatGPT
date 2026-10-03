import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { sidecarProcess } from 'file:///C:/Users/jingc/workspace/DSHWithChatGPT/package/tests/fixtures/sidecar-process.ts'

const start = performance.now()
const results = await Promise.allSettled([
  sidecarProcess(undefined, { bootstrap: true, recoveryView: 'exact' }),
  sidecarProcess(undefined, { bootstrap: true, recoveryView: 'exact' }),
])
const ready = results.filter(result => result.status === 'fulfilled').map(result => result.value)
if (ready.length === 2) {
  assert.notEqual(ready[0].pid, ready[1].pid)
  assert.notEqual(ready[0].stateDirectory, ready[1].stateDirectory)
}
const rows = results.map((result, index) => ({
  index, status: result.status,
  ...(result.status === 'fulfilled' ? { pid: result.value.pid } : {
    errorType: result.reason.name,
    startupDeadlineExceeded: result.reason.message === 'Sidecar child startup deadline exceeded',
  }),
}))
await Promise.all(ready.map(child => child.close()))
const report = { case: 'two-independent-concurrent-startups', elapsedMs: performance.now() - start,
  rows, allReady: ready.length === 2, separateStates: ready.length === 2,
  budgets: { startupMs: 5000, fixturePhaseMs: 2000, nativeAclMs: 10000 },
  scope: 'Original synthetic fixture concurrent startup only; no RPC, browser or real product evidence' }
await writeFile(process.argv[2], JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
process.exitCode = ready.length === 2 ? 0 : 1
