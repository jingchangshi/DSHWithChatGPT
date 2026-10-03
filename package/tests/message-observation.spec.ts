import { afterEach, describe, expect, it } from 'vitest'
import { domFixture, closeDomFixtures } from './fixtures/dom-browser.ts'
import { messageObservationScript } from '../src/browser/message-observation.ts'

afterEach(closeDomFixtures)
const assistant = (text: string, id = 'reply-1') => `<div data-content-search-unit-key="turn:assistant" data-chatgpt-search-unit-key="turn:assistant"><h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：</h4><div data-chatgpt-selection-message-id="${id}"><div data-markdown-text-style="assistant-message">${text}</div><button>Copy</button></div></div>`
const user = (text: string) => `<div data-chatgpt-search-unit-key="turn:user" data-chatgpt-search-message-ids="user-1"><div data-content-search-unit-key="turn:user"><div class="text-size-chat whitespace-pre-wrap">${text}</div></div></div>`
const observe = (html: string) => domFixture(html).window.eval(`(() => { ${messageObservationScript}; return messageObservations; })()`)

describe('shared semantic message observations', () => {
  it('refuses a current user role shell until its unique body mounts', () => {
    const f = domFixture('<div data-chatgpt-search-unit-key="d28:user" data-chatgpt-search-message-ids="d28-user"></div>')
    const read = () => f.window.eval(`(() => { ${messageObservationScript}; return messageObservations; })()`)
    expect(read()).toBeNull()
    f.window.document.querySelector('[data-chatgpt-search-unit-key]')!.innerHTML = '<div class="text-size-chat whitespace-pre-wrap"><a href="/plugins/owned">DSH with ChatGPT</a> exact control</div>'
    expect(read()).toEqual([{ role: 'user', text: 'DSH with ChatGPT exact control', appNames: ['DSH with ChatGPT'], animated: false }])
  })
  it.each([
    ['duplicate identity', '<div data-chatgpt-search-unit-key="d28:user" data-chatgpt-search-message-ids="d28-user"></div>'],
    ['conflicting role', '<div data-chatgpt-search-unit-key="other:user" data-content-search-unit-key="other:assistant"></div>'],
    ['multiple bodies', '<div data-chatgpt-search-unit-key="other:user"><div class="text-size-chat whitespace-pre-wrap">one</div><div class="text-size-chat whitespace-pre-wrap">two</div></div>'],
    ['explicit user', user('foreign')],
  ])('missing body never hides later %s', (_label, hostile) => {
    const pending = '<div data-chatgpt-search-unit-key="d28:user" data-chatgpt-search-message-ids="d28-user"></div>'
    const f = domFixture(pending + hostile)
    expect(f.window.eval(`(() => { ${messageObservationScript}; return { state: messageObservationState, messages: messageObservations }; })()`)).toEqual({ state: 'STRUCTURAL_AMBIGUITY', messages: null })
  })
  it('distinguishes absent body from an explicitly hidden body', () => {
    const shell = '<div data-chatgpt-search-unit-key="d28:user" data-chatgpt-search-message-ids="d28-user">'
    const classify = (html: string) => domFixture(html).window.eval(`(() => { ${messageObservationScript}; return messageObservationState; })()`)
    expect(classify(shell + '</div>')).toBe('MISSING_BODY')
    expect(classify(shell + '<div class="text-size-chat whitespace-pre-wrap" hidden>foreign</div></div>')).toBe('STRUCTURAL_AMBIGUITY')
  })
  it('deduplicates nested current markers and excludes heading and actions', () => {
    expect(observe(user('question') + assistant('answer'))).toEqual([
      { role: 'user', text: 'question', appNames: [], animated: false },
      { role: 'assistant', text: 'answer', appNames: [], animated: false },
    ])
  })
  it('preserves literal newlines and blank lines in a preformatted body', () => {
    expect(observe(user('<a href="/plugins/owned">DSH with ChatGPT</a> [PLANNER_BRIDGE]\nVERSION: 2\n\nGOAL:\n\nbody\n\n'))[0]).toMatchObject({ text: 'DSH with ChatGPT [PLANNER_BRIDGE]\nVERSION: 2\n\nGOAL:\n\nbody\n\n', appNames: ['DSH with ChatGPT'] })
  })
  it('preserves block and explicit line break structure', () => {
    expect(observe(assistant('<p>first<br>line</p><p>second</p>'))[0].text).toBe('first\nline\n\nsecond')
  })
  it('preserves visible zero-area inline BRs in paragraph/span user messages', () => {
    const f = domFixture(user('<div><p><a href="/plugins/owned">DSH with ChatGPT</a><span> [PLANNER_BRIDGE]</span><br><span>VERSION: 2</span></p><p><span>GOAL:</span><br><span>Keep  two spaces.\t</span><br><br><span>End.</span></p></div>'))
    for (const br of f.window.document.querySelectorAll('br')) br.getBoundingClientRect = () => ({ width: 0, height: 0 } as any)
    const result = f.window.eval(`(() => { ${messageObservationScript}; return messageObservations; })()`)
    expect(result[0]).toMatchObject({ text: 'DSH with ChatGPT [PLANNER_BRIDGE]\nVERSION: 2\n\nGOAL:\nKeep  two spaces.\t\n\nEnd.', appNames: ['DSH with ChatGPT'] })
  })
  it.each(['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"'])('excludes zero-area BRs under %s ancestors', attr => {
    const f = domFixture(user(`<span>first</span><span ${attr}><br></span><span>last</span>`))
    f.window.document.querySelector('br')!.getBoundingClientRect = () => ({ width: 0, height: 0 } as any)
    expect(f.window.eval(`(() => { ${messageObservationScript}; return messageObservations; })()`)[0].text).toBe('firstlast')
  })
  it('supports legacy wrappers and standalone markdown messages', () => {
    expect(observe('<article data-message-author-role="assistant"><div data-markdown-text-style="assistant-message">old</div><button>Copy</button></article><div data-markdown-text-style="assistant-message">new</div>').map((m: { text: string }) => m.text)).toEqual(['old', 'new'])
  })
  it.each(['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"'])('ignores %s message trees', attr => {
    expect(observe(`<section ${attr}>${assistant('hidden')}</section>` + assistant('visible', 'reply-2'))).toHaveLength(1)
  })
  it('does not include hidden content or controls inside body', () => {
    expect(observe(assistant('answer<span hidden>secret</span><button>Copy</button>'))[0].text).toBe('answer')
  })
  it.each([
    ['duplicate identities', assistant('first') + assistant('second')],
    ['ambiguous bodies', assistant('one').replace('</div><button>', '</div><div data-markdown-text-style="assistant-message">two</div><button>')],
    ['conflicting roles', assistant('one').replace('turn:assistant', 'turn:user')],
    ['missing body proof', '<div data-chatgpt-search-unit-key="turn:assistant"><h4 data-conversation-role="assistant">ChatGPT 说：</h4><div>unproven</div></div>'],
    ['missing current role heading', assistant('one').replace('<h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：</h4>', '')],
  ])('fails closed on %s', (_label, html) => { expect(observe(html)).toBeNull() })
})
