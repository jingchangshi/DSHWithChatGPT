const entry = process.env.PLANNERBRIDGE_PROFILE_SERVER_ENTRY
const { startSidecar } = await import(entry)
const { readSidecarCredential } = await import(new URL('../deployment/sidecar-credential.js', entry).href)
const authentication = await readSidecarCredential(process.env.PLANNERBRIDGE_PROFILE_CREDENTIAL_FILE, [])
const unavailable = async () => { throw Object.assign(new Error('CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE'), { code: 'CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE' }) }
const driver = {
  health: async () => ({ ok: true }), ensureReady: unavailable, recover: unavailable,
  openConversation: unavailable, currentConversation: async () => undefined,
  sendControlMessage: unavailable, waitForReply: unavailable,
}
const service = await startSidecar({ host: '127.0.0.1', port: 0, authentication,
  stateDirectory: process.env.PLANNERBRIDGE_PROFILE_STATE_DIRECTORY, driver })
process.send({ endpoint: service.endpoint, pid: process.pid })
let closing
const close = () => closing ??= service.close().then(() => process.exit(0))
process.on('message', message => { if (message?.event === 'close') void close() })
process.on('disconnect', () => { void close() })
process.on('SIGTERM', () => { void close() })
