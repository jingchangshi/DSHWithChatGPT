import { describe, expect, it } from 'vitest'
import { ChatGptCoordinator } from '../src/orchestrator/coordinator.ts'
import { formatEnvelope } from '../src/protocol/index.ts'
import type { PersistedTask, PersistedWorkspaceBinding } from '../src/core/model.ts'
import { StateRevisionConflictError, type StateStore, type TaskSnapshot } from '../src/core/ports/state-store.ts'
import type { ChatControl } from '../src/core/ports/chat-control.ts'
import type { ExecutionWorkspacePort, WorkspaceAuthority, WorkspaceCapability } from '../src/core/ports/execution-workspace.ts'
import type { McpExposureBinding, McpExposureProvider } from '../src/core/ports/mcp-exposure.ts'

function fakeState(): StateStore {
  const tasks = new Map<string, TaskSnapshot>()
  const bindings = new Map<string, PersistedWorkspaceBinding>()
  let ids: string[] = []
  return {
    async loadTask(id) { return structuredClone(tasks.get(id)?.value) },
    async loadTaskSnapshot(id) { return structuredClone(tasks.get(id)) },
    async createTask(value) {
      if (tasks.has(value.taskId)) throw new StateRevisionConflictError(value.taskId)
      const snapshot = { value: structuredClone(value), revision: 1 }
      tasks.set(value.taskId, snapshot)
      return structuredClone(snapshot)
    },
    async commitTask(id, expected, value) {
      if (tasks.get(id)?.revision !== expected) throw new StateRevisionConflictError(id)
      const next = { value: structuredClone(value), revision: expected + 1 }
      tasks.set(id, next)
      return structuredClone(next)
    },
    async listTaskIds() { return [...ids] },
    async saveTaskIndex(next) { ids = [...next] },
    async bindWorkspace(id, value) { bindings.set(id, { ...value, updatedAt: 1 }) },
    async loadWorkspace(id) { return structuredClone(bindings.get(id)) },
  }
}

function fakeWorkspace(allowed: readonly WorkspaceCapability[]): ExecutionWorkspacePort {
  return {
    async withOperation(request, callback, signal) {
      const active = new AbortController()
      let settled = false
      const identity = { workspaceId: String(request.locator), displayRoot: 'opaque display' }
      const authority: WorkspaceAuthority = {
        identity, signal: active.signal,
        has: capability => !settled && !signal?.aborted && allowed.includes(capability),
        require(capability) { if (!this.has(capability)) throw new Error('WORKSPACE_CAPABILITY_UNAVAILABLE') },
      }
      try {
        for (const capability of request.capabilities) authority.require(capability)
        return await callback(authority)
      } finally { settled = true; active.abort() }
    },
  }
}

describe('pure fake composition of the four outbound ports', () => {
  it.each(['success', 'missing-capability', 'exposure-failure'] as const)('%s gates state creation and collaboration sends', async outcome => {
    const store = fakeState()
    const sends: string[] = []
    const bindings: McpExposureBinding[] = []
    const replies = ['PLAN', 'DONE'].map((state, i) => formatEnvelope({
      state: state as 'PLAN' | 'DONE', sender: 'chatgpt', taskId: 'd2c_faketask', iteration: i + 1, inReplyTo: i,
      headers: { WORKSPACE_ID: 'world-a', ...(i === 1 ? { HEAD: '0123456789012345678901234567890123456789' } : {}) },
      sections: state === 'PLAN' ? { ACTIONS: 'execute' } : { SUMMARY: 'reviewed' },
    }))
    // Legacy v1 review echoes the EXECUTED iteration in both headers.
    replies[1] = formatEnvelope({ state: 'DONE', sender: 'chatgpt', taskId: 'd2c_faketask', iteration: 2, inReplyTo: 2, headers: { WORKSPACE_ID: 'world-a', HEAD: '0123456789012345678901234567890123456789' }, sections: { SUMMARY: 'reviewed' } })
    const chat: ChatControl = {
      async health() { return { ok: true, detail: 'fake' } },
      async ensureReady() {}, async openConversation() { return 'conversation' },
      async sendControlMessage(text) { sends.push(text) },
      async waitForReply() { return { text: replies.shift()!, complete: true } },
      async recover() {}, async currentConversation() { return 'conversation' },
    }
    const exposure: McpExposureProvider = {
      async ensure(binding) { bindings.push(binding); return { ready: outcome !== 'exposure-failure' } },
      async status() { return { ready: true } },
      async rebind(binding) { return this.ensure(binding) }, async close() {},
    }
    const workspace = fakeWorkspace(outcome === 'missing-capability' ? [] : ['workspaceContentRead', 'gitRead'])
    let retained: WorkspaceAuthority | undefined
    const run = workspace.withOperation({ locator: 'world-a', capabilities: ['workspaceContentRead', 'gitRead'] }, async authority => {
      retained = authority
      const binding = { workspaceId: authority.identity.workspaceId, loopbackEndpoint: 'http://127.0.0.1:1234/mcp', authorizationReference: 'opaque-reference' }
      if (!(await exposure.ensure(binding)).ready) throw new Error('MCP_EXPOSURE_NOT_READY')
      const coordinator = new ChatGptCoordinator({ browser: chat, store, workspaceId: authority.identity.workspaceId, workspaceRoot: authority.identity.displayRoot, plannerInstructions: 'generic planner policy' })
      await coordinator.startTask('d2c_faketask', 'fake-port collaboration', { signal: authority.signal })
      await coordinator.awaitPlan('d2c_faketask', authority.signal)
      return coordinator.reportExecuted('d2c_faketask', { changedFiles: ['fixture'], head: '0123456789012345678901234567890123456789', testsRecorded: true }, authority.signal)
    })
    if (outcome === 'success') {
      expect((await run).record.state).toBe('done')
      expect(sends).toHaveLength(2)
      expect(bindings[0]).toEqual({ workspaceId: 'world-a', loopbackEndpoint: 'http://127.0.0.1:1234/mcp', authorizationReference: 'opaque-reference' })
      expect(retained!.has('workspaceContentRead')).toBe(false)
      expect(() => retained!.require('gitRead')).toThrow('WORKSPACE_CAPABILITY_UNAVAILABLE')
    } else {
      await expect(run).rejects.toThrow(outcome === 'missing-capability' ? 'WORKSPACE_CAPABILITY_UNAVAILABLE' : 'MCP_EXPOSURE_NOT_READY')
      expect(sends).toEqual([])
      expect(await store.loadTask('d2c_faketask')).toBeUndefined()
      expect(bindings).toHaveLength(outcome === 'missing-capability' ? 0 : 1)
    }
  })

  it('keeps two worlds with the same display distinct and revokes escaped authority', async () => {
    const workspace = fakeWorkspace(['workspaceContentRead'])
    const identities = []
    for (const locator of ['world-a', 'world-b']) {
      const authority = await workspace.withOperation({ locator, capabilities: [] }, async value => value)
      identities.push(authority.identity)
      expect(authority.has('workspaceContentRead')).toBe(false)
      expect(authority.signal.aborted).toBe(true)
    }
    expect(identities[0]!.displayRoot).toBe(identities[1]!.displayRoot)
    expect(identities[0]!.workspaceId).not.toBe(identities[1]!.workspaceId)
  })
})
