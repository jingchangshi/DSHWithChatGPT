import { afterEach, describe, expect, it } from 'vitest'
import { domFixture, closeDomFixtures } from './fixtures/dom-browser.ts'
import { messageObservationScript } from '../src/browser/message-observation.ts'

afterEach(closeDomFixtures)
const assistant = (text: string, id = 'reply-1') => `<div data-content-search-unit-key="turn:assistant" data-chatgpt-search-unit-key="turn:assistant"><h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：</h4><div data-chatgpt-selection-message-id="${id}"><div data-markdown-text-style="assistant-message">${text}</div><button>Copy</button></div></div>`
const user = (text: string) => `<div data-chatgpt-search-unit-key="turn:user" data-chatgpt-search-message-ids="user-1"><div data-content-search-unit-key="turn:user"><div class="text-size-chat whitespace-pre-wrap">${text}</div></div></div>`
const observe = (html: string) => domFixture(html).window.eval(`(() => { ${messageObservationScript}; return messageObservations; })()`)

describe('shared semantic message observations', () => {
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
