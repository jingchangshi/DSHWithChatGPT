import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
export async function initializeAcceptanceWorkload(workspace) {
  await mkdir(workspace, { recursive: true })
  await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'interval-acceptance', private: true, type: 'module', scripts: { test: 'node run-tests.mjs' } }, null, 2) + '\n')
  await writeFile(path.join(workspace, 'intervals.js'), 'export function subtractIntervals(available, blocked) { return available }\n')
  await writeFile(path.join(workspace, 'intervals.test.js'), "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { subtractIntervals } from './intervals.js'\ntest('splits blocked interval', () => assert.deepEqual(subtractIntervals([[0, 10]], [[3, 7]]), [[0, 3], [7, 10]]))\n")
  await writeFile(path.join(workspace, 'REQUIREMENTS.md'), '# Interval subtraction\n\nImplement subtractIntervals(available, blocked) for finite numeric half-open intervals. Reject non-array inputs, malformed pairs, non-finite endpoints, and start >= end with TypeError. Validate blocked intervals even when available is empty. Do not coerce values or mutate inputs. Sort and union overlapping or touching available intervals and blocked intervals independently, subtract their union, return sorted disjoint nonempty intervals, coalescing touching output. Preserve negative and fractional values. Add tests for these requirements. No dependencies. Keep the random E2E_EVIDENCE stdout test marker; never persist its values in workspace files.\n')
  const requirements = await readFile(path.join(workspace, 'REQUIREMENTS.md'), 'utf8')
  const runTests = `import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
  const requirements = ${JSON.stringify(requirements)}
  const stageFiles = ${JSON.stringify(stageFiles)}
${runAcceptanceTests}
  await runAcceptanceTests(process.cwd())
`
  await writeFile(path.join(workspace, 'run-tests.mjs'), runTests)
  return Object.freeze({ initialFiles: Object.freeze({
    'REQUIREMENTS.md': requirements, 'run-tests.mjs': runTests,
    'package.json': await readFile(path.join(workspace, 'package.json'), 'utf8'),
  }), stageFiles })
}

const recoveryRequirements = '# Acceptance recovery stage\n\nThis is an acceptance-only extension activated after the original subtraction tests pass. Implement intervals.recovery.js exporting unionIntervals(intervals). Accept only arrays of finite numeric half-open pairs with start < end; reject invalid inputs with TypeError without coercion. Do not mutate input. Sort and union overlapping or touching intervals. Preserve negative and fractional values. No dependencies. Preserve this requirement and its tests exactly.\n'
const recoveryTests = `import test from 'node:test'
import assert from 'node:assert/strict'
import { unionIntervals } from './intervals.recovery.js'
test('recovery unions overlap and touching with immutable fractional input', () => {
  const input = [[3, 5], [-2.5, 0], [0, 3], [8, 9.5]]
  const before = structuredClone(input)
  assert.deepEqual(unionIntervals(input), [[-2.5, 5], [8, 9.5]])
  assert.deepEqual(input, before)
  assert.deepEqual(unionIntervals([]), [])
})
test('recovery rejects invalid intervals without coercion', () => {
  for (const input of [null, {}, [[0]], [[0, 1, 2]], [['0', 1]], [[NaN, 1]], [[0, Infinity]], [[1, 1]], [[2, 1]]]) {
    assert.throws(() => unionIntervals(input), TypeError)
  }
})
`
const stageFiles = Object.freeze({ 'RECOVERY_STAGE.md': recoveryRequirements, 'intervals.recovery.test.js': recoveryTests })

const runAcceptanceTests = String.raw`async function runAcceptanceTests(workspace) {
  assert.equal(await readFile(path.join(workspace, 'REQUIREMENTS.md'), 'utf8'), requirements, 'Acceptance requirements changed')
  const phase = process.env.PLANNER_EXECUTOR_PHASE
  assert.ok(phase === '1' || phase === '2', 'Acceptance phase must be explicit')
  const names = await readdir(workspace)
  const activated = names.includes('RECOVERY_STAGE.md')
  if (activated || phase === '2') {
    for (const [name, contents] of Object.entries(stageFiles)) {
      assert.equal(await readFile(path.join(workspace, name), 'utf8'), contents, 'Immutable recovery stage changed: ' + name)
    }
  } else {
    assert.ok(!names.includes('intervals.recovery.test.js') && !names.includes('intervals.recovery.js'), 'Recovery stage must not be pre-solved')
  }
  if (phase === '1') assert.ok(!names.includes('intervals.recovery.js'), 'Recovery implementation belongs to the fix round')
  assert.ok(names.includes('intervals.test.js'), 'Original subtraction tests required')
  const run = spawnSync(process.execPath, ['--test'], { cwd: workspace, stdio: 'inherit', windowsHide: true })
  if (run.status !== 0) { process.exitCode = run.status ?? 1; return }
  console.log('E2E_EVIDENCE=' + randomBytes(16).toString('hex'))
  if (phase === '1' && !activated) {
    for (const [name, contents] of Object.entries(stageFiles)) await writeFile(path.join(workspace, name), contents, { flag: 'wx' })
    console.log('RECOVERY_STAGE_ACTIVATED')
  }
}`

// Only the parent acceptance runner holds this contract. The disposable shell
// never reads a sibling contract or imports this source module at runtime.
export async function verifyAcceptanceWorkload(workspace, contract, state) {
  assert.ok(['initial', 'phase1', 'phase2'].includes(state), 'Unknown workload boundary')
  for (const [name, contents] of Object.entries(contract.initialFiles)) {
    assert.equal(await readFile(path.join(workspace, name), 'utf8'), contents, 'Acceptance contract changed: ' + name)
  }
  const names = await readdir(workspace)
  if (state === 'initial') {
    for (const name of [...Object.keys(contract.stageFiles), 'intervals.recovery.js']) assert.ok(!names.includes(name), 'Premature recovery file: ' + name)
  } else {
    for (const [name, contents] of Object.entries(contract.stageFiles)) {
      assert.equal(await readFile(path.join(workspace, name), 'utf8'), contents, 'Recovery contract changed: ' + name)
    }
    if (state === 'phase1') assert.ok(!names.includes('intervals.recovery.js'), 'Recovery implementation before restart')
  }
}
