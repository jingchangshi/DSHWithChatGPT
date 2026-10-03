/** Local fixture observer. Output failures never affect the delegated call. */
export function installBindDiagnostics(driver, emit) {
  const report = value => {
    try { Promise.resolve(emit(value)).catch(() => {}) }
    catch { /* Diagnostic sink is independent of the provider result. */ }
  }
  let baseline
  for (const method of ['captureReplyBaseline', 'currentConversation', 'reconcileReplyBaseline']) {
    const original = driver[method].bind(driver)
    driver[method] = async (...args) => {
      const began = Date.now()
      report({ kind: 'bind-provenance', method, stage: 'enter', at: began })
      try {
        const value = await original(...args)
        if (method === 'captureReplyBaseline') baseline = value
        report({ kind: 'bind-provenance', method, stage: 'return', at: Date.now(), elapsedMs: Date.now() - began,
          conversationPresent: method === 'currentConversation' ? !!value : !!value?.conversationId,
          baselineCountMatches: method === 'reconcileReplyBaseline' ? value.assistantCount === baseline?.assistantCount : undefined,
          baselineDigestMatches: method === 'reconcileReplyBaseline' ? value.textDigest === baseline?.textDigest : undefined })
        return value
      } catch (error) {
        report({ kind: 'bind-provenance', method, stage: 'throw', at: Date.now(), elapsedMs: Date.now() - began,
          errorType: error.name, failureReason: error.diagnosticReason })
        throw error
      }
    }
  }
}
