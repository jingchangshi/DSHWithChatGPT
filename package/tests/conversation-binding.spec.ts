import { expect, it } from 'vitest'
import { outgoingControlProof, pendingAppRendering, planConversationBinding, replyTextDigest } from '../src/browser/conversation-binding.ts'
import type { BrowserTargetIdentity } from '../src/browser/epoch.ts'

const root = 'https://chatgpt.com/'
const temporary = root + 'c/local-chatgpt%3A11111111-1111-1111-1111-111111111111'
const durable = root + 'c/22222222-2222-2222-2222-222222222222'
const other = root + 'c/33333333-3333-3333-3333-333333333333'
const target = (url = root, transitionSequence = 0): BrowserTargetIdentity => ({ targetId: 'owned', documentId: 'document', epoch: 1, url, transitionSequence })
const chain = (...urls: string[]) => urls.slice(1).map((afterUrl, index) => ({ sequence: index + 1, beforeUrl: urls[index]!, afterUrl }))
const state = { route: 'NEW_CHAT', finalEnter: 'acknowledged' as const }

it('previews the complete root/temporary/durable chain without granting promotion or mutating state', () => {
  const events = chain(root, temporary, durable)
  expect(planConversationBinding(state, target(), target(durable, 2), events, 'pending')).toEqual({ route: 'CONVERSATION:22222222-2222-2222-2222-222222222222', temporaryRoute: undefined, needsProof: true })
  expect(state).toEqual({ route: 'NEW_CHAT', finalEnter: 'acknowledged' })
  expect(() => planConversationBinding(state, target(), target(durable, 2), events, 'forbidden')).toThrow('BROWSER_TARGET_CHANGED')
  expect(planConversationBinding(state, target(), target(durable, 2), events, 'proved').needsProof).toBe(true)
})

it.each([
  chain(root, temporary, durable, other),
  chain(root, temporary, durable, temporary, durable),
  chain(root, 'https://example.com/', root),
  [{ sequence: 2, beforeUrl: root, afterUrl: durable }],
  [{ sequence: 1, beforeUrl: other, afterUrl: durable }],
].map(events => ({ events })))('rejects a foreign detour, repeated promotion or incomplete history even with proof', ({ events }) => {
  expect(() => planConversationBinding(state, target(), target(events.at(-1)!.afterUrl, events.at(-1)!.sequence), events, 'proved')).toThrow('BROWSER_TARGET_CHANGED')
})

it.each(['before', 'dispatching'] as const)('cannot promote a temporary conversation while Enter is %s', finalEnter => {
  expect(() => planConversationBinding({ ...state, finalEnter }, target(), target(durable, 2), chain(root, temporary, durable), 'pending')).toThrow('BROWSER_TARGET_CHANGED')
})

it.each([{ documentId: 'new' }, { targetId: 'foreign' }, { epoch: 2 }, { transitionSequence: 1 }, { url: other }])('rejects changed target identity or an unexplained final cursor', change => {
  expect(() => planConversationBinding(state, target(), { ...target(), ...change }, [], 'proved')).toThrow('BROWSER_TARGET_CHANGED')
})

const app = 'DSH with ChatGPT', body = 'exact\ncontrol body', digest = replyTextDigest(body)
const user = (text = app + ' ' + body, appNames = [app]) => ({ role: 'user', text, appNames })
it('proves a unique exact last-user turn and retains its preceding-assistant boundary', () => {
  expect(outgoingControlProof([{ role: 'assistant', text: 'prior', appNames: [] }, user(), { role: 'assistant', text: 'reply', appNames: [] }], app, digest)).toEqual({ kind: 'proved', lastUser: 1 })
})
it.each([
  { messages: [], reason: 'PROOF_NOT_FOUND' },
  { messages: [user(), user()], reason: 'PROOF_AMBIGUOUS' },
  { messages: [user(), user(app + ' other')], reason: 'NOT_LAST_USER' },
  { messages: [user(app + ' ' + body + ' ')], reason: 'DIGEST_MISMATCH' },
  { messages: [user(app + ' ' + body, [app, app])], reason: 'WRONG_APP' },
  { messages: [user(app + ' ' + body, ['wrong'])], reason: 'WRONG_APP' },
  { messages: [user(app + body)], reason: 'WRONG_APP' },
])('rejects outgoing proof: $reason', ({ messages, reason }) => {
  expect(outgoingControlProof(messages, app, digest)).toEqual({ kind: 'rejected', reason })
})
it.each(['$dsh-with-chatgpt ' + body, '?' + app + ' ' + body])('allows unresolved App rendering only as a wait condition', text => {
  const messages = [user(text, [])]
  expect(pendingAppRendering(messages, app, digest)).toBe(true)
  expect(outgoingControlProof(messages, app, digest).kind).toBe('rejected')
  expect(pendingAppRendering([user(text + ' ', [])], app, digest)).toBe(false)
  expect(pendingAppRendering([...messages, user('foreign', [])], app, digest)).toBe(false)
})
