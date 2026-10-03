import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { initializeAcceptanceWorkload, verifyAcceptanceWorkload } from '../scripts/planner-executor-workload.mjs'

describe('isolated acceptance recovery workload', () => {
  it('rejects matching mutations of requirements and the sibling runtime contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plannerbridge-contract-red-'))
    const workspace = join(root, 'workspace')
    await initializeAcceptanceWorkload(workspace)
    await writeFile(join(workspace, 'intervals.js'), 'export function subtractIntervals() { return [[0,3],[7,10]] }\n')
    await writeFile(join(workspace, 'REQUIREMENTS.md'), 'weakened requirements\n')
    const contractPath = join(root, 'workload-contract.json')
    const contract = JSON.parse(await readFile(contractPath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return '{}'; throw error }))
    contract['REQUIREMENTS.md'] = 'weakened requirements\n'
    await writeFile(contractPath, JSON.stringify(contract))
    const result = spawnSync(process.execPath, ['run-tests.mjs'], { cwd: workspace, env: { ...process.env, PLANNER_EXECUTOR_PHASE: '1' }, encoding: 'utf8', windowsHide: true })
    expect(result.status, result.stdout + result.stderr).not.toBe(0)
    expect(result.stdout).not.toContain('E2E_EVIDENCE=')
  })
  it('uses the parent in-memory contract to reject runner and requirement bypasses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plannerbridge-parent-contract-'))
    const workspace = join(root, 'workspace')
    const contract = await initializeAcceptanceWorkload(workspace)
    await verifyAcceptanceWorkload(workspace, contract, 'initial')
    for (const [name, contents] of Object.entries(contract.initialFiles)) {
      await writeFile(join(workspace, name), 'bypassed')
      await expect(verifyAcceptanceWorkload(workspace, contract, 'initial')).rejects.toThrow('Acceptance contract changed')
      await writeFile(join(workspace, name), contents as string)
    }
    for (const [name, contents] of Object.entries(contract.stageFiles)) await writeFile(join(workspace, name), contents as string)
    await expect(verifyAcceptanceWorkload(workspace, contract, 'initial')).rejects.toThrow('Premature recovery file')
    await verifyAcceptanceWorkload(workspace, contract, 'phase1')
    for (const [name, contents] of Object.entries(contract.stageFiles)) {
      await writeFile(join(workspace, name), 'bypassed')
      for (const state of ['phase1', 'phase2']) await expect(verifyAcceptanceWorkload(workspace, contract, state)).rejects.toThrow('Recovery contract changed')
      await writeFile(join(workspace, name), contents as string)
    }
    await writeFile(join(workspace, 'intervals.recovery.js'), 'premature implementation')
    await expect(verifyAcceptanceWorkload(workspace, contract, 'phase1')).rejects.toThrow('Recovery implementation before restart')
    await verifyAcceptanceWorkload(workspace, contract, 'phase2')
  })

  it('has no runtime dependency on source or parent paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plannerbridge-external-red-'))
    const workspace = join(root, 'workspace')
    await initializeAcceptanceWorkload(workspace)
    const runner = await readFile(join(workspace, 'run-tests.mjs'), 'utf8')
    expect(runner).not.toContain('file:')
    expect(runner).not.toContain('workload-contract.json')
    expect(runner).not.toContain(JSON.stringify(root))
    expect(await readdir(root)).toEqual(['workspace'])
  })

  it('discovers nested Executor-added tests before activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plannerbridge-discovery-red-'))
    const workspace = join(root, 'workspace')
    const contract = await initializeAcceptanceWorkload(workspace)
    await verifyAcceptanceWorkload(workspace, contract, 'initial')
    await writeFile(join(workspace, 'intervals.js'), 'export function subtractIntervals() { return [[0,3],[7,10]] }\n')
    await mkdir(join(workspace, 'tests'))
    await writeFile(join(workspace, 'tests', 'nested.test.js'), "import test from 'node:test'; test('nested failure must run', () => { throw new Error('nested discovery witness') })\n")
    const result = spawnSync(process.execPath, ['run-tests.mjs'], { cwd: workspace, env: { ...process.env, PLANNER_EXECUTOR_PHASE: '1' }, encoding: 'utf8', windowsHide: true })
    expect(result.status, result.stdout + result.stderr).not.toBe(0)
    expect(result.stdout).toContain('nested discovery witness')
    expect(await readdir(workspace)).not.toContain('RECOVERY_STAGE.md')
  })
  it('activates only after base PASS, fails phase two without implementation, and preserves stdout-only nonce', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plannerbridge-recovery-stage-'))
    const workspace = join(root, 'workspace')
    const contract = await initializeAcceptanceWorkload(workspace)
    await verifyAcceptanceWorkload(workspace, contract, 'initial')
    const requirements = await readFile(join(workspace, 'REQUIREMENTS.md'), 'utf8')
    expect(requirements).toBe('# Interval subtraction\n\nImplement subtractIntervals(available, blocked) for finite numeric half-open intervals. Reject non-array inputs, malformed pairs, non-finite endpoints, and start >= end with TypeError. Validate blocked intervals even when available is empty. Do not coerce values or mutate inputs. Sort and union overlapping or touching available intervals and blocked intervals independently, subtract their union, return sorted disjoint nonempty intervals, coalescing touching output. Preserve negative and fractional values. Add tests for these requirements. No dependencies. Keep the random E2E_EVIDENCE stdout test marker; never persist its values in workspace files.\n')
    const run = (phase: string) => spawnSync(process.execPath, ['run-tests.mjs'], {
      cwd: workspace, env: { ...process.env, PLANNER_EXECUTOR_PHASE: phase }, encoding: 'utf8', windowsHide: true,
    })
    expect(await readdir(workspace)).not.toContain('RECOVERY_STAGE.md')
    expect(run('1').status).not.toBe(0)
    expect(await readdir(workspace)).not.toContain('RECOVERY_STAGE.md')
    await writeFile(join(workspace, 'intervals.js'), 'export function subtractIntervals() { return [[0,3],[7,10]] }\n')
    const first = run('1')
    expect(first.status, first.stdout + first.stderr).toBe(0)
    expect(first.stdout).toMatch(/E2E_EVIDENCE=[a-f0-9]{32}/)
    expect(first.stdout).toContain('RECOVERY_STAGE_ACTIVATED')
    expect(await readFile(join(workspace, 'REQUIREMENTS.md'), 'utf8')).toBe(requirements)
    await verifyAcceptanceWorkload(workspace, contract, 'phase1')
    const second = run('2')
    expect(second.status).not.toBe(0)
    expect(second.stdout + second.stderr).toContain('ERR_MODULE_NOT_FOUND')
    expect(second.stdout + second.stderr).toContain('intervals.recovery.js')
    expect(second.stdout).not.toContain('E2E_EVIDENCE=')
    const nonce = first.stdout.match(/E2E_EVIDENCE=([a-f0-9]{32})/)![1]!
    for (const file of await readdir(workspace)) expect(await readFile(join(workspace, file), 'utf8')).not.toContain(nonce)
    const stage = await readFile(join(workspace, 'RECOVERY_STAGE.md'), 'utf8')
    const repeated = run('1')
    expect(repeated.status).not.toBe(0)
    expect(repeated.stdout).not.toContain('E2E_EVIDENCE=')
    expect(repeated.stdout).not.toContain('RECOVERY_STAGE_ACTIVATED')
    await writeFile(join(workspace, 'intervals.recovery.js'), `export function unionIntervals(input) {
      if (!Array.isArray(input)) throw new TypeError()
      const sorted = input.map(pair => {
        if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(value => typeof value === 'number' && Number.isFinite(value)) || pair[0] >= pair[1]) throw new TypeError()
        return [...pair]
      }).sort((a, b) => a[0] - b[0])
      const output = []
      for (const pair of sorted) {
        const previous = output.at(-1)
        if (previous && pair[0] <= previous[1]) previous[1] = Math.max(previous[1], pair[1])
        else output.push(pair)
      }
      return output
    }\n`)
    const fixed = run('2')
    expect(fixed.status, fixed.stdout + fixed.stderr).toBe(0)
    await verifyAcceptanceWorkload(workspace, contract, 'phase2')
    const fixedNonce = fixed.stdout.match(/E2E_EVIDENCE=([a-f0-9]{32})/)![1]!
    expect(fixedNonce).not.toBe(nonce)
    for (const file of await readdir(workspace)) expect(await readFile(join(workspace, file), 'utf8')).not.toContain(fixedNonce)
    expect(run('1').status).not.toBe(0)
    await writeFile(join(workspace, 'intervals.js'), 'export function subtractIntervals(available) { return available }\n')
    expect(run('2').status).not.toBe(0)
    await writeFile(join(workspace, 'RECOVERY_STAGE.md'), stage + 'changed')
    const altered = run('2')
    expect(altered.status).not.toBe(0)
    expect(altered.stdout).not.toContain('E2E_EVIDENCE=')
  })
})
