import { createHash } from 'node:crypto'
import { BrowserTargetChangedError, sameBrowserTarget, type BrowserTargetIdentity } from './epoch.ts'
import type { BrowserTransition } from './transitions.ts'
import type { ReconcileFailureReason } from './errors.ts'

/** Internal, pure route machine. A preview never grants promotion authority. */
export interface ConversationRouteState {
  route?: string
  temporaryRoute?: string
  finalEnter: 'before' | 'dispatching' | 'acknowledged'
}

export function planConversationBinding(state: ConversationRouteState, previous: BrowserTargetIdentity | undefined,
  target: BrowserTargetIdentity, transitions: BrowserTransition[], promotion: 'forbidden' | 'pending' | 'proved') {
  if (!Number.isSafeInteger(target.transitionSequence) || target.transitionSequence < 0) throw new BrowserTargetChangedError()
  let { route, temporaryRoute } = state
  let needsProof = false
  const admit = (url: string) => {
    const next = classifyChatRoute(url)
    if (next === 'OTHER') throw new BrowserTargetChangedError()
    if (route === undefined || route === next) { route = next; return }
    if (route === 'NEW_CHAT' && next.startsWith('CONVERSATION:') && state.finalEnter !== 'before') {
      temporaryRoute = isTemporaryChatRoute(next) ? next : undefined
    } else if (temporaryRoute === route && isDurableChatRoute(next) && state.finalEnter === 'acknowledged'
      && promotion !== 'forbidden' && !needsProof) {
      needsProof = true
      temporaryRoute = undefined
    } else throw new BrowserTargetChangedError()
    route = next
  }
  if (previous) {
    if (!sameBrowserTarget(previous, target)) throw new BrowserTargetChangedError()
    let sequence = previous.transitionSequence, url = previous.url
    for (const transition of transitions) {
      if (transition.sequence !== ++sequence || transition.beforeUrl !== url) throw new BrowserTargetChangedError()
      admit(transition.afterUrl)
      url = transition.afterUrl
    }
    if (sequence !== target.transitionSequence || url !== target.url) throw new BrowserTargetChangedError()
  }
  admit(target.url)
  return { route: route!, temporaryRoute, needsProof }
}

export function classifyChatRoute(value: string): string {
  try {
    const url = new URL(value)
    if (url.origin !== 'https://chatgpt.com') return 'OTHER'
    if (url.pathname === '/') return 'NEW_CHAT'
    const match = /^\/c\/([^/]+)\/?$/.exec(url.pathname)
    return match ? 'CONVERSATION:' + match[1] : 'OTHER'
  } catch { return 'OTHER' }
}
export function isTemporaryChatRoute(route: string | undefined): boolean {
  return typeof route === 'string' && /^CONVERSATION:local-chatgpt%3A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(route)
}
export function isDurableChatRoute(route: string): boolean {
  return /^CONVERSATION:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(route)
}

export interface ConversationMessage { role: string; text: string; appNames: string[] }
export function replyTextDigest(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }
const hasExactApp = (message: ConversationMessage, app: string) => message.appNames.length === 1 && message.appNames[0] === app
  && message.text.startsWith(app) && /\s/.test(message.text.slice(app.length, app.length + 1))

/** One exact App + unchanged digest, at the unique last user turn. */
export function outgoingControlProof(messages: ConversationMessage[], appName: string, digest: string):
  { kind: 'proved'; lastUser: number } | { kind: 'rejected'; reason: ReconcileFailureReason } {
  const app = appName.trim()
  const matches: number[] = []
  let lastUser = -1, exactApp = false
  messages.forEach((message, index) => {
    if (message.role !== 'user') return
    lastUser = index
    if (!hasExactApp(message, app)) return
    exactApp = true
    if (replyTextDigest(message.text.slice(app.length + 1)) === digest) matches.push(index)
  })
  if (matches.length === 1 && matches[0] === lastUser) return { kind: 'proved', lastUser }
  return { kind: 'rejected', reason: matches.length > 1 ? 'PROOF_AMBIGUOUS' : matches.length === 1 ? 'NOT_LAST_USER'
    : lastUser < 0 ? 'PROOF_NOT_FOUND' : exactApp ? 'DIGEST_MISMATCH' : 'WRONG_APP' }
}

/** Rendering is only a wait condition; it never satisfies outgoingControlProof. */
export function pendingAppRendering(messages: ConversationMessage[], appName: string, expectedDigest: string | undefined): boolean {
  const users = messages.filter(message => message.role === 'user')
  const app = appName.trim()
  if (users.length !== 1 || users[0]!.appNames.length !== 0) return false
  const text = users[0]!.text
  if (text.slice(1, app.length + 1) === app && /\s/.test(text.slice(app.length + 1, app.length + 2))
    && replyTextDigest(text.slice(app.length + 2)) === expectedDigest) return true
  const slug = '$' + app.toLowerCase().replace(/\s+/g, '-')
  return slug.length <= 257 && /^\$[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    && text.startsWith(slug) && /\s/.test(text.slice(slug.length, slug.length + 1))
    && replyTextDigest(text.slice(slug.length + 1)) === expectedDigest
}
