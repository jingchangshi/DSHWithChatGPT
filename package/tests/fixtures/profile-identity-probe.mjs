import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { request } from 'node:http'

export const name = 'c2c-profile-identity-probe'
export const inject = ['loader', 'agents', 'agentLoop', 'tools', 'executionWorldIdentity']

function assertListenerClosed(port) {
  return new Promise((resolve, reject) => {
    const probe = request({ host: '127.0.0.1', port, path: '/mcp', agent: false }, response => {
      response.resume()
      reject(new Error(`Bridge listener ${port} survived unload with HTTP ${response.statusCode}`))
    })
    probe.on('error', error => {
      if (error.code === 'ECONNREFUSED') resolve()
      else reject(error)
    })
    probe.setTimeout(2000, () => probe.destroy(new Error('Bridge close probe timed out')))
    probe.end()
  })
}

export function apply(ctx, config) {
  const runId = process.env.DSH_C2C_SMOKE_RUN_ID
  const report = process.env.DSH_C2C_SMOKE_REPORT
  assert.ok(runId && report, 'Profile probe must be launched by its verification runner')
  setImmediate(async () => {
    const handles = []
    const calls = []
    let initialTools
    let outcome
    const unsubscribe = ctx.on('tools/execute', async (execution, next) => {
      calls.push(execution.name)
      return next()
    })
    try {
      await ctx.loader.await()
      initialTools = ctx.tools.schemas().map(tool => tool.name)
      const statuses = []
      for (const cwd of [config.workspace, config.alias, config.otherWorkspace]) {
        const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd } })
        handles.push(handle)
        const signal = new AbortController().signal
        const execute = (name, args) => ctx.tools.execute({ agent: handle.agent, signal, callId: randomUUID(), name, arguments: args })
        const status = await execute('chatgpt_status', {})
        assert.equal(status.isError, false, JSON.stringify(status))
        const value = JSON.parse(status.content.find(block => block.type === 'text').text)
        assert.equal(value.bridgeRunning, true)
        statuses.push({ workspaceId: value.workspaceId, bridgePort: value.bridgePort, latestTask: value.latestTask })
        if (statuses.length === 1) {
          const result = await execute('chatgpt_doctor', {})
          assert.equal(result.isError, false, JSON.stringify(result))
          const doctor = JSON.parse(result.content.find(block => block.type === 'text').text)
          assert.equal(doctor.ready, false)
          assert.equal(doctor.checks.find(check => check.id === 'workspace_identity')?.ok, true)
          assert.equal(doctor.checks.find(check => check.id === 'workspace_content_read')?.ok, true)
          assert.equal(doctor.checks.find(check => check.id === 'workspace_git_read')?.ok, false)
          assert.equal(doctor.checks.find(check => check.id === 'execution_output_access')?.ok, false)
        }
      }
      assert.equal(statuses[0].workspaceId, statuses[1].workspaceId)
      assert.equal(statuses[0].bridgePort, statuses[1].bridgePort)
      assert.notEqual(statuses[0].workspaceId, statuses[2].workspaceId)
      assert.notEqual(statuses[0].bridgePort, statuses[2].bridgePort)
      assert.ok(statuses.every(status => status.latestTask === null))
      const collaboration = [...ctx.loader.entries()].find(entry => entry.options.id === 'collaboration')
      assert.ok(collaboration)
      await collaboration.update({ disabled: true })
      await ctx.loader.await()
      assert.equal(ctx.tools.get('chatgpt_status'), undefined)
      await Promise.all([...new Set(statuses.map(status => status.bridgePort))].map(assertListenerClosed))
      await collaboration.update({ disabled: false })
      await ctx.loader.await()
      const reloaded = await ctx.tools.execute({ agent: handles[0].agent, signal: new AbortController().signal, callId: randomUUID(), name: 'chatgpt_status', arguments: {} })
      assert.equal(reloaded.isError, false, JSON.stringify(reloaded))
      assert.equal(JSON.parse(reloaded.content.find(block => block.type === 'text').text).workspaceId, statuses[0].workspaceId)
      outcome = { ok: true, statuses, calls }
    } catch (error) {
      outcome = { ok: false, error: String(error), calls, initialTools, tools: ctx.tools.schemas().map(tool => tool.name), plugins: [...ctx.loader.entries()].map(entry => ({ id: entry.options.id, state: entry.fiber?.state, callback: entry.fiber?.runtime?.callback?.name, tools: entry.options.id === 'collaboration' ? entry.fiber?.ctx.get('tools')?.schemas().map(tool => tool.name) : undefined })) }
    } finally {
      unsubscribe()
      await Promise.all(handles.map(handle => handle.dispose()))
      await writeFile(report, JSON.stringify({ ...outcome, runId, pid: process.pid }, null, 2) + '\n', { flag: 'wx' })
      process.emit('SIGTERM')
    }
  })
}
