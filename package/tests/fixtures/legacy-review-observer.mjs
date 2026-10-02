// Legacy v1 review observation fixture only; canonical real acceptance uses planner-executor-e2e-observer.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
export const name = 'legacy-review-observer'
export const inject = ['tools']
export function apply(ctx, config) {
  const pending = new Map()
  const stopped = new Set()
  const nonces = new Set()
  if (existsSync(config.report)) {
    for (const line of readFileSync(config.report, 'utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line)
      if (record.runId === process.env.PLANNER_EXECUTOR_RUN_ID && typeof record.nonce === 'string') nonces.add(record.nonce)
    }
  }
  const emit = record => appendFileSync(config.report, JSON.stringify({ runId: process.env.PLANNER_EXECUTOR_RUN_ID, phase: process.env.PLANNER_EXECUTOR_PHASE, pid: process.pid, at: Date.now(), ...record }) + '\n')
  emit({ kind: 'boot' })
  ctx.on('tools/execute', async (exec, next) => {
    const encoded = JSON.stringify(exec.arguments)
    emit({ kind: 'dispatch', name: exec.name, callId: exec.callId, sessionId: exec.agent?.session.id, mode: exec.name === 'chatgpt_doctor' ? exec.arguments.mode : undefined, goalPresent: exec.name === 'chatgpt_plan' ? typeof exec.arguments.goal === 'string' && exec.arguments.goal.trim().length > 0 : undefined, reviewHead: exec.name === 'chatgpt_review' ? exec.arguments.head : undefined, reviewArgumentNonceLeak: exec.name === 'chatgpt_review' && ([...nonces].some(nonce => encoded.includes(nonce)) || /E2E_EVIDENCE=[a-f0-9]{32}/.test(encoded)) })
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    const value = result.value
    const content = result.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
    const text = value?.stdout?.text ?? content
    const shell = exec.name === 'pwsh' || exec.name === 'bash'
    const nonce = shell && value?.exitCode === 0 ? text.match(/E2E_EVIDENCE=([a-f0-9]{32})/)?.[1] : undefined
    if (nonce) nonces.add(nonce)
    if (result.isError === true) emit({ kind: 'tool-error', name: exec.name, code: result.error?.code, message: content.slice(0, 1500) })
    const record = { kind: 'result', name: exec.name, callId: exec.callId, sessionId: exec.agent?.session.id, isError: result.isError === true, exitCode: value?.exitCode, nonce }
    if (exec.name.startsWith('chatgpt_')) Object.assign(record, { taskId: value?.taskId ?? value?.task?.taskId, state: value?.state ?? value?.task?.state, iteration: value?.iteration ?? value?.task?.iteration, recovered: value?.recovered, localReady: value?.localReady, appDataPlaneVerified: value?.appDataPlaneVerified, checks: value?.checks, reviewNonce: value?.summary?.match(/E2E_EVIDENCE=([a-f0-9]{32})/)?.[1] })
    emit(record)
    if (config.stopOnFix && process.env.PLANNER_EXECUTOR_PHASE === '1' && exec.name === 'chatgpt_review' && value?.state === 'planned' && exec.agent) pending.set(exec.agent.session.id, { sessionId: exec.agent.session.id, taskId: value.taskId, iteration: value.iteration, callId: exec.callId })
  })
  ctx.on('session/event', (session, event) => {
    const checkpoint = pending.get(session.id)
    if (event.type !== 'step/end' || !checkpoint || stopped.has(checkpoint.callId)) return
    stopped.add(checkpoint.callId)
    emit({ kind: 'restart-checkpoint', ...checkpoint, seq: event.seq })
    queueMicrotask(() => process.emit('SIGTERM'))
  })
}
