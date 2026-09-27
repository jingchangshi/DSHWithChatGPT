import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { request } from 'node:http'

export const name = 'c2c-profile-identity-probe'
export const inject = ['loader', 'agents', 'agentLoop', 'tools', 'executionWorldIdentity']

async function repositorySnapshot(root) {
  const entries = []
  async function visit(relative) {
    const target = path.join(root, relative)
    const info = await lstat(target)
    const kind = info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'directory' : 'file'
    const content = kind === 'link' ? await readlink(target)
      : kind === 'file' ? createHash('sha256').update(await readFile(target)).digest('hex') : null
    entries.push({ relative, kind, size: info.size, content })
    if (kind === 'directory') {
      for (const name of (await readdir(target)).sort()) await visit(relative ? relative + '/' + name : name)
    }
  }
  await visit('')
  return entries
}

async function mcpValue(response) {
  assert.equal(response.ok, true, 'MCP HTTP request failed')
  const envelope = await response.json()
  assert.equal(envelope.error, undefined, 'MCP RPC error')
  assert.notEqual(envelope.result?.isError, true, 'MCP tool error')
  const text = envelope.result?.content?.find(block => typeof block.text === 'string')?.text
  assert.ok(text, 'MCP text result missing')
  return JSON.parse(text)
}

async function observeDoctor(execute, status, workspace) {
  const before = await repositorySnapshot(workspace)
  const originalFetch = globalThis.fetch
  const expectedUrl = 'http://127.0.0.1:' + status.bridgePort + '/mcp'
  const observed = new Map()
  let observationError
  globalThis.fetch = async (url, init) => {
    const response = await originalFetch(url, init)
    if (String(url) !== expectedUrl || init?.method !== 'POST' || typeof init.body !== 'string') return response
    const request = JSON.parse(init.body)
    if (request.method !== 'tools/call') return response
    try {
      const headers = new Headers(init.headers)
      assert.ok(headers.get('authorization')?.startsWith('Bearer '), 'Doctor must authenticate')
      const value = await mcpValue(response.clone())
      observed.set(request.params.name, value)
      if (request.params.name === 'git_status') {
        for (const [name, args] of [['git_diff', { max_bytes: 65536 }], ['git_log', { limit: 5 }]]) {
          const supplemental = await originalFetch(expectedUrl, {
            method: 'POST', headers, signal: AbortSignal.timeout(20_000),
            body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
          })
          observed.set(name, await mcpValue(supplemental))
        }
      }
    } catch (error) {
      observationError = error
      throw error
    }
    return response
  }
  let result
  try {
    result = await execute('chatgpt_doctor', {})
  } finally {
    globalThis.fetch = originalFetch
  }
  if (observationError) throw observationError
  assert.equal(globalThis.fetch, originalFetch)
  const after = await repositorySnapshot(workspace)
  const changed = new Set([...before, ...after].map(entry => entry.relative))
  for (const relative of changed) {
    assert.equal(JSON.stringify(after.find(entry => entry.relative === relative)), JSON.stringify(before.find(entry => entry.relative === relative)), 'Repository mutated: ' + relative)
  }
  const info = observed.get('workspace_info')
  assert.equal(info?.workspaceId, status.workspaceId)
  assert.equal(info.capabilities.leaseBound, true)
  assert.equal(info.capabilities.workspaceContentRead.available, true)
  assert.equal(info.capabilities.gitRead.available, true)
  assert.ok(['hardened-windows', 'full'].includes(info.capabilities.gitRead.assurance))
  assert.equal(info.capabilities.executionOutput.available, false)
  const git = observed.get('git_status')
  assert.equal(git?.isRepo, true)
  assert.ok(git.head)
  assert.ok(git.unstaged.includes('tracked.txt'))
  assert.ok(git.staged.includes('staged.txt'))
  assert.ok(git.untracked.includes('untracked.txt'))
  const diff = JSON.stringify(observed.get('git_diff'))
  for (const marker of ['tracked mutation marker', 'staged mutation marker', 'untracked mutation marker']) assert.ok(diff.includes(marker), 'Missing diff marker: ' + marker)
  assert.ok(JSON.stringify(observed.get('git_log')).includes('profile baseline'))
  return { result, evidence: { ok: true, assurance: info.capabilities.gitRead.assurance, operations: [...observed.keys()], unchanged: true } }
}

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
      let gitAcceptance
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
          const observed = await observeDoctor(execute, value, config.workspace)
          const result = observed.result
          gitAcceptance = observed.evidence
          assert.equal(result.isError, false, JSON.stringify(result))
          const doctor = JSON.parse(result.content.find(block => block.type === 'text').text)
          assert.equal(doctor.ready, false)
          assert.equal(doctor.checks.find(check => check.id === 'workspace_identity')?.ok, true)
          assert.equal(doctor.checks.find(check => check.id === 'workspace_content_read')?.ok, true)
          assert.equal(doctor.checks.find(check => check.id === 'workspace_git_read')?.ok, true)
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
      outcome = { ok: true, statuses, calls, gitAcceptance }
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
