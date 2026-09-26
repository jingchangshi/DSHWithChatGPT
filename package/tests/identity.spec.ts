import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonicalWorkspaceRoot, observedWorkspaceRoot, sessionWorkspaceRoot, workspaceIdentity } from '../src/workspace/identity.ts'
import { WorkspaceError, resolveContained } from '../src/workspace/boundary.ts'
import { WorkspaceError as IdentityError } from '../src/workspace/errors.ts'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'
import { loadWorkspaceSpec } from '../src/bridge/tools.ts'
import { ExecutionRecorder } from '../src/execution/recorder.ts'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-identity-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('canonical workspace identity', () => {
  it('shares workspace failure codes and error identity with containment', () => {
    expect(WorkspaceError).toBe(IdentityError)
    expect(() => sessionWorkspaceRoot(undefined)).toThrow(IdentityError)
    const error = new IdentityError('INVALID_WORKSPACE_ROOT', 'workspace root must be an accessible directory')
    expect(error.name).toBe('WorkspaceError')
    expect(error.reason).toBe('INVALID_WORKSPACE_ROOT')
    expect(error.message).toBe('INVALID_WORKSPACE_ROOT: workspace root must be an accessible directory')
  })

  it('requires a Session cwd and an accessible directory', () => {
    expect(() => sessionWorkspaceRoot(undefined)).toThrow(/SESSION_WORKSPACE_UNAVAILABLE/)
    expect(() => sessionWorkspaceRoot('')).toThrow(/SESSION_WORKSPACE_UNAVAILABLE/)
    expect(() => canonicalWorkspaceRoot(path.join(root, 'missing'))).toThrow(WorkspaceError)
    const file = path.join(root, 'file.txt')
    fs.writeFileSync(file, 'x')
    expect(() => canonicalWorkspaceRoot(file)).toThrow(/INVALID_WORKSPACE_ROOT/)
    expect(() => resolveContained(file, '.')).toThrow(/INVALID_WORKSPACE_ROOT/)
    expect(observedWorkspaceRoot(undefined)).toBeUndefined()
    expect(observedWorkspaceRoot(file)).toBeUndefined()
    expect(observedWorkspaceRoot(root)).toBe(canonicalWorkspaceRoot(root).root)
  })

  it('maps directory aliases to one root and bridge identity', () => {
    const alias = path.join(path.dirname(root), path.basename(root) + '-alias')
    try {
      fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return
    }
    try {
      expect(canonicalWorkspaceRoot(alias)).toEqual(canonicalWorkspaceRoot(root))
      expect(workspaceIdentity(alias)).toBe(workspaceIdentity(root))
      expect(resolveContained(alias, '.').rel).toBe('')
      const recorder = new ExecutionRecorder({ stateDir: path.join(root, 'records') })
      expect(loadWorkspaceSpec(alias, recorder).root).toBe(loadWorkspaceSpec(root, recorder).root)
      const namespaces = new Map([[sessionWorkspaceRoot(root), 'existing bridge']])
      expect(namespaces.get(sessionWorkspaceRoot(alias))).toBe('existing bridge')
      expect(observedWorkspaceRoot(alias)).toBe(sessionWorkspaceRoot(root))
    } finally {
      fs.rmSync(alias, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'win32')('normalizes Windows case variants', () => {
    expect(canonicalWorkspaceRoot(root.toUpperCase())).toEqual(canonicalWorkspaceRoot(root))
  })

  it('uses canonical aliases for durable workspace bindings', async () => {
    const state = new CoordinatorState(createMemoryStore())
    const canonical = sessionWorkspaceRoot(root)
    await state.bindWorkspace(canonical, { workspaceRoot: canonical, conversationId: null, lastTaskId: 'd2c_1234' })
    expect((await state.loadWorkspace(sessionWorkspaceRoot(path.join(root, '.'))))?.lastTaskId).toBe('d2c_1234')
  })

  it.skipIf(process.platform === 'win32')('keeps case-distinct Linux directories distinct', () => {
    const sibling = root.toUpperCase()
    if (sibling === root || fs.existsSync(sibling)) return
    fs.mkdirSync(sibling)
    try {
      expect(canonicalWorkspaceRoot(sibling).key).not.toBe(canonicalWorkspaceRoot(root).key)
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true })
    }
  })
})
