import { afterEach, expect, it, vi } from 'vitest'
import { captureBrowserHistory, browserHistoryExpression } from '../src/browser/history-observation.ts'
import { domFixture, closeDomFixtures } from './fixtures/dom-browser.ts'

afterEach(async () => { vi.useRealTimers(); await closeDomFixtures() })

it('serializes a generic document observer and retains a returning route detour', () => {
  const { window } = domFixture('<div></div>')
  const first = window.eval(browserHistoryExpression())
  window.history.pushState(null, '', '/A')
  window.history.replaceState(null, '', '/')
  const after = window.eval(browserHistoryExpression(first.sequence))
  expect(after.token).toBe(first.token)
  expect(after.sequence).toBe(2)
  expect(after.transitions.map((event: any) => event.afterUrl)).toEqual(['https://chatgpt.com/A', 'https://chatgpt.com/'])
})

it.each(['events', 'bytes', 'age'] as const)('rejects page-side history lost to the %s bound', bound => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const { window } = domFixture('<div></div>')
  captureBrowserHistory(window)
  window.history.pushState(null, '', '/A')
  if (bound === 'events') for (let index = 0; index < 1024; index++) window.history.replaceState(null, '', '/A?index=' + index)
  if (bound === 'bytes') window.history.pushState(null, '', '/' + 'x'.repeat(262_144))
  if (bound === 'age') vi.setSystemTime(600_001)
  expect(captureBrowserHistory(window, 0).unavailable).toBe(true)
})

it('rejects a replaced history hook instead of falling back to the last URL', () => {
  const { window } = domFixture('<div></div>')
  captureBrowserHistory(window)
  const previous = window.history.pushState.bind(window.history)
  window.history.pushState = (...args) => previous(...args)
  expect(captureBrowserHistory(window, 0).unavailable).toBe(true)
})

it('does not expose mutable retained event storage through the document', () => {
  const { window } = domFixture('<div></div>')
  captureBrowserHistory(window)
  window.history.pushState(null, '', '/A')
  captureBrowserHistory(window, 0).transitions[0]!.afterUrl = 'forged'
  expect(captureBrowserHistory(window, 0).transitions[0]!.afterUrl).toBe('https://chatgpt.com/A')
  const observer = (window.document as any).__plannerbridgeHistoryObservation
  expect(Object.isFrozen(observer)).toBe(true)
  expect(Object.keys(observer)).toEqual(['read'])
})

it('makes a backward clock unavailable instead of extending event lifetime', () => {
  vi.useFakeTimers(); vi.setSystemTime(10)
  const { window } = domFixture('<div></div>')
  captureBrowserHistory(window)
  window.history.pushState(null, '', '/A')
  vi.setSystemTime(9)
  expect(captureBrowserHistory(window, 0).unavailable).toBe(true)
})
