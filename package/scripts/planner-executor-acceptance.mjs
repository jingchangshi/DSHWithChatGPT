// Pure acceptance policy shared by the real runner and adversarial fixtures.
// Event order and identity come from the independent task-owned observer.
export function evaluateAcceptance({ records, runId, code, restartPending, git }) {
  const events = records.filter(record => record.runId === runId)
  const last = predicate => events.findLast(predicate)
  const plan = events.find(record => record.kind === 'result' && record.name === 'chatgpt_plan' && record.state === 'planned' && !record.isError)
  const review = last(record => record.kind === 'result' && record.name === 'chatgpt_review')
  const index = record => events.indexOf(record)
  const dispatches = review ? events.filter(record => record.kind === 'dispatch' && record.name === 'chatgpt_review' && record.callId === review.callId && record.sessionId === review.sessionId) : []
  const dispatch = dispatches.length === 1 ? dispatches[0] : undefined
  const test = last(record => record.kind === 'result' && record.name === 'pwsh' && !record.isError && record.exitCode === 0 && typeof record.nonce === 'string')
  const testDispatches = test ? events.filter(record => record.kind === 'dispatch' && record.name === 'pwsh' && record.callId === test.callId && record.sessionId === test.sessionId && record.testCommand === true) : []
  const testDispatch = testDispatches.length === 1 ? testDispatches[0] : undefined
  const checkpoint = last(record => record.kind === 'restart-checkpoint')
  const fix = checkpoint && events.find(record => record.kind === 'result' && record.name === 'chatgpt_review' && record.callId === checkpoint.callId && record.sessionId === checkpoint.sessionId && record.state === 'planned' && !record.isError)
  const reconnect = last(record => record.kind === 'result' && record.name === 'chatgpt_reconnect' && !record.isError && record.recovered === true)
  const sameTask = record => !!plan && !!record && record.taskId === plan.taskId && record.workspaceId === plan.workspaceId
  const tuplePresent = !!plan && typeof plan.taskId === 'string' && plan.taskId.length > 0 && typeof plan.workspaceId === 'string' && plan.workspaceId.length > 0
  const recoveryVerified = restartPending === true && sameTask(checkpoint) && sameTask(reconnect)
    && sameTask(fix) && fix.iteration === checkpoint.iteration && index(fix) < index(checkpoint)
    && checkpoint.phase === '1' && reconnect.phase === '2' && index(checkpoint) < index(reconnect)
    && reconnect.iteration === checkpoint.iteration && reconnect.sessionId === dispatch?.sessionId
    && index(reconnect) < index(testDispatch)
  const identityVerified = tuplePresent && sameTask(review) && sameTask(dispatch)
    && !review.isError && review.state === 'done' && dispatch.reviewTaskId === review.taskId
    && Number.isInteger(dispatch.iteration) && review.iteration === dispatch.iteration + 1
    && review.phase === '2' && dispatch.phase === review.phase && index(dispatch) < index(review)
    && /^[a-f0-9]{40,64}$/.test(git.head) && review.head === git.head && dispatch.reviewHead === git.head
    && git.clean === true && typeof git.branch === 'string' && git.branch !== '' && !['main', 'master'].includes(git.branch)
    && git.upstream === git.head && git.ahead === 0
  const nonceVerified = sameTask(test) && sameTask(testDispatch) && testDispatch.sessionId === dispatch?.sessionId
    && test.phase === dispatch?.phase && test.iteration === dispatch?.iteration && testDispatch.iteration === test.iteration
    && index(testDispatch) < index(test) && index(test) < index(dispatch)
    && /^[a-f0-9]{32}$/.test(test.nonce) && test.nonce === review?.reviewNonce
  const readinessVerified = !!plan && events.some(record => record.kind === 'result' && record.name === 'chatgpt_doctor' && record.sessionId === plan.sessionId && record.mode === 'local' && record.localReady === true && !record.isError && index(record) < index(plan))
    && events.some(record => record.kind === 'result' && record.name === 'chatgpt_doctor' && record.sessionId === plan.sessionId && record.mode === 'app-proof' && record.appDataPlaneVerified === true && !record.isError && index(record) < index(plan))
  const plannerExecutorAccepted = code === 0 && identityVerified && nonceVerified && recoveryVerified && readinessVerified
    && !events.some(record => record.reviewArgumentNonceLeak === true || record.name === 'browser-harness')
  return { plannerExecutorAccepted: Boolean(plannerExecutorAccepted), identityVerified: Boolean(identityVerified), nonceVerified: Boolean(nonceVerified), recoveryVerified: Boolean(recoveryVerified), readinessVerified, exitCode: plannerExecutorAccepted ? 0 : (Number.isInteger(code) && code !== 0 ? code : 1) }
}
