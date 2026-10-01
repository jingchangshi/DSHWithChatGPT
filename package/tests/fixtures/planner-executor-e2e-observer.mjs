import { appendFileSync, existsSync, readFileSync } from 'node:fs'
export const name = 'planner-executor-e2e-observer'
export const inject = ['tools']
export function apply(ctx, config) {
  const pending = new Map()
  const stopped = new Set()
  const nonces = new Set()
  const scopes = new Map()
  const dispatched = new Map()
  const marker = text => [...text.matchAll(/E2E_EVIDENCE=([a-f0-9]{32})/g)].at(-1)?.[1]
  if (existsSync(config.report)) {
    for (const line of readFileSync(config.report, 'utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line)
      if (record.runId === process.env.PLANNER_EXECUTOR_RUN_ID && record.kind === 'result' && !record.isError && record.exitCode === 0 && typeof record.nonce === 'string') nonces.add(record.nonce)
    }
  }
  const emit = record => appendFileSync(config.report, JSON.stringify({ runId: process.env.PLANNER_EXECUTOR_RUN_ID, phase: process.env.PLANNER_EXECUTOR_PHASE, pid: process.pid, at: Date.now(), ...record }) + '\n')
  emit({ kind: 'boot' })
  ctx.on('tools/execute', async (exec, next) => {
    const encoded = JSON.stringify(exec.arguments)
    const scope = { ...scopes.get(exec.agent?.session.id), sessionId: exec.agent?.session.id, mode: exec.name === 'chatgpt_doctor' ? (exec.arguments.mode ?? 'local') : undefined }
    dispatched.set(exec.callId, scope)
    emit({ kind: 'dispatch', name: exec.name, callId: exec.callId, ...scope, testCommand: exec.name === 'pwsh' && /(?:^|[\s;&|])npm(?:\.cmd)?\s+(?:run\s+)?test(?:[\s;&|]|$)/.test(exec.arguments.command ?? ''), goalPresent: exec.name === 'chatgpt_plan' ? typeof exec.arguments.goal === 'string' && exec.arguments.goal.trim().length > 0 : undefined, reviewTaskId: exec.name === 'chatgpt_review' ? exec.arguments.taskId : undefined, reviewHead: exec.name === 'chatgpt_review' ? exec.arguments.head : undefined, reviewArgumentNonceLeak: exec.name === 'chatgpt_review' && ([...nonces].some(nonce => encoded.includes(nonce)) || /E2E_EVIDENCE=[a-f0-9]{32}/.test(encoded)) })
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    const value = result.value
    const content = result.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
    const text = value?.stdout?.text ?? content
    const shell = exec.name === 'pwsh' || exec.name === 'bash'
    const nonce = shell && result.isError !== true && value?.exitCode === 0 ? marker(text) : undefined
    if (nonce) nonces.add(nonce)
    if (result.isError === true) emit({ kind: 'tool-error', name: exec.name, code: result.error?.code, message: content.slice(0, 1500) })
    const record = { kind: 'result', name: exec.name, callId: exec.callId, ...dispatched.get(exec.callId), sessionId: exec.agent?.session.id, isError: result.isError === true, exitCode: value?.exitCode, nonce }
    dispatched.delete(exec.callId)
    if (exec.name.startsWith('chatgpt_')) Object.assign(record, { taskId: value?.taskId ?? value?.task?.taskId, workspaceId: value?.workspaceId, head: value?.head, state: value?.state ?? value?.task?.state, iteration: value?.iteration ?? value?.task?.iteration, recovered: value?.recovered, localReady: value?.localReady, appDataPlaneVerified: value?.appDataPlaneVerified, checks: value?.checks, reviewNonce: typeof value?.summary === 'string' ? marker(value.summary) : undefined })
    if (!record.isError && record.taskId && record.workspaceId && Number.isInteger(record.iteration)) scopes.set(record.sessionId, { taskId: record.taskId, workspaceId: record.workspaceId, iteration: record.iteration })
    emit(record)
    if (config.stopOnFix && process.env.PLANNER_EXECUTOR_PHASE === '1' && exec.name === 'chatgpt_review' && value?.state === 'planned' && exec.agent) pending.set(exec.agent.session.id, { sessionId: exec.agent.session.id, taskId: value.taskId, workspaceId: value.workspaceId, iteration: value.iteration, callId: exec.callId })
  })
  ctx.on('session/event', (session, event) => {
    const checkpoint = pending.get(session.id)
    if (event.type !== 'step/end' || !checkpoint || stopped.has(checkpoint.callId)) return
    stopped.add(checkpoint.callId)
    emit({ kind: 'restart-checkpoint', ...checkpoint, seq: event.seq })
    queueMicrotask(() => process.emit('SIGTERM'))
  })
}
