import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserHarnessAdapter } from '../src/browser/harness.ts'
import { BrowserStaleError, ChatGptAppUnavailableError } from '../src/browser/adapter.ts'

const windows: Window[] = []
afterEach(async () => { await Promise.all(windows.splice(0).map(window => window.happyDOM.close())) })

function fixture(html: string, options: { selection?: 'outside' | 'partial' | 'none' | 'icon' | 'tail'; appName?: string; mention?: boolean; keepDraft?: boolean; ambiguousAfterInput?: boolean; failAfterType?: boolean; foreignDraft?: boolean | string; omitAtomText?: boolean; providerFailure?: 'throw' | 'top' | 'nested' } = {}) {
  const window = new Window({ url: 'https://chatgpt.com/' })
  windows.push(window)
  window.document.body.innerHTML = html
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON: () => ({}) })
  }
  const mutations: string[] = []
  const keys: string[] = []
  let typed = false
  let failed = false
  let enteredText = ''
  const browser = new BrowserHarnessAdapter({ get: () => ({ execute: async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
    if (name.endsWith('browser_page_info')) return { value: { url: 'https://chatgpt.com/' } }
    if (options.providerFailure === 'throw') throw new Error('provider failed')
    if (options.providerFailure === 'top') return { isError: true }
    if (options.providerFailure === 'nested') return { value: { isError: true } }
    if (name.endsWith('browser_js')) {
      if (typed && options.failAfterType && !failed) {
        failed = true
        if (options.foreignDraft) window.document.querySelector('[role="textbox"]')!.textContent = typeof options.foreignDraft === 'string' ? options.foreignDraft : 'foreign user draft'
        throw new Error('provider failed after input')
      }
      return { value: window.eval(String(args.expression)) }
    }
    mutations.push(name)
    if (name.endsWith('browser_fill')) throw new Error('contenteditable fill must not be used')
    if (name.endsWith('browser_type')) {
      const target = window.document.activeElement!
      if (target instanceof window.HTMLTextAreaElement) target.value += String(args.text)
      else target.append(window.document.createTextNode(String(args.text)))
      typed = args.text !== '@'
      if (options.ambiguousAfterInput) {
        const extra = window.document.createElement('div')
        extra.setAttribute('role', 'textbox')
        extra.setAttribute('contenteditable', 'true')
        extra.getBoundingClientRect = window.document.activeElement!.getBoundingClientRect
        window.document.body.append(extra)
      }
    }
    if (name.endsWith('browser_click') && options.mention) {
      const composer = window.document.querySelector('[data-d2c-composer-target]')!
      composer.innerHTML = '<span contenteditable="false">DSH with ChatGPT</span>'
      window.document.querySelector('button')!.focus()
    }
    if (name.endsWith('browser_press')) {
      keys.push(String(args.key))
      expect(window.document.activeElement).toBe(window.document.querySelector('[data-d2c-composer-target]'))
      const composer = window.document.activeElement!
      if (args.key === 'a' && args.modifiers === 2) {
        if (composer instanceof window.HTMLTextAreaElement) {
          composer.setSelectionRange(0, composer.value.length)
          return { value: {} }
        }
        const selection = window.getSelection()!
        selection.removeAllRanges()
        if (options.selection !== 'none') {
          const range = window.document.createRange()
          range.selectNodeContents(options.selection === 'outside' ? window.document.body : composer)
          if (options.selection === 'partial') range.setEnd(composer.firstChild!, 1)
          if (options.selection === 'icon') range.selectNode(composer.firstChild!.firstChild!)
          if (options.selection === 'tail') range.setEnd(composer.lastChild!, 3)
          selection.addRange(range)
          if (options.omitAtomText) selection.toString = () => ''
        }
      } else if (args.key === 'Backspace') {
        if (!options.keepDraft) {
          if (composer instanceof window.HTMLTextAreaElement) composer.value = ''
          else window.getSelection()!.deleteFromDocument()
        }
      } else if (args.key === 'Enter') enteredText = composer instanceof window.HTMLTextAreaElement ? composer.value : composer.textContent!
    }
    return { value: {} }
  } }) } as never, undefined, options.appName ?? 'DSH with ChatGPT')
  return { browser, mutations, keys, window, enteredText: () => enteredText }
}

describe('ChatGPT composer DOM resolution', () => {

  it.each([
    ['partial atom', '<span contenteditable="false">DSH with ChatGPT</span>', 'partial', 'DSH with ChatGPT'],
    ['nested icon only', '<span contenteditable="false"><span contenteditable="false"></span>DSH with ChatGPT</span>', 'icon', 'DSH with ChatGPT'],
    ['partial trailing text', '<span contenteditable="false">DSH with ChatGPT</span> control message', 'tail', 'DSH with ChatGPT control message'],
    ['foreign text', '<span contenteditable="false">DSH with ChatGPT</span> foreign', 'partial', 'DSH with ChatGPT'],
  ] as const)('refuses structural cleanup for %s', async (_name, html, selection, expected) => {
    const { browser, keys } = fixture('<div role="textbox" contenteditable="true">' + html + '</div>', { selection, omitAtomText: true })
    const cleanup = browser as unknown as { clearComposer(draft: { texts: string[] }): Promise<void> }
    await expect(cleanup.clearComposer({ texts: ['', 'DSH with ChatGPT', expected] })).rejects.toBeInstanceOf(BrowserStaleError)
    expect(keys).not.toContain('Backspace')
  })

  it('cleans fully selected nested App atoms even when selection text omits labels', async () => {
    const { browser, window, keys } = fixture('<div role="textbox" contenteditable="true"><p><span contenteditable="false" app-mention-display-name="DSH with ChatGPT"><span contenteditable="false"><svg></svg></span><span>DSH with ChatGPT</span></span> </p></div>', { omitAtomText: true })
    const cleanup = browser as unknown as { clearComposer(draft: { texts: string[] }): Promise<void> }
    await cleanup.clearComposer({ texts: ['', 'DSH with ChatGPT'] })
    expect(window.document.querySelector('[role="textbox"]')!.textContent!.trim()).toBe('')
    expect(keys).toEqual(['a', 'Backspace'])
  })

  it.each([
    ['foreign empty atom', '<span contenteditable="false">DSH with ChatGPT</span><span contenteditable="false"></span>', ['', 'DSH with ChatGPT']],
    ['unknown semantic atom', '<span contenteditable="false" app-mention-display-name="Other">DSH with ChatGPT</span>', ['', 'DSH with ChatGPT']],
  ])('preserves %s during cleanup', async (_name, html, texts) => {
    const { browser, keys } = fixture('<div role="textbox" contenteditable="true">' + html + '</div>')
    const cleanup = browser as unknown as { clearComposer(draft: { texts: string[] }): Promise<void> }
    await expect(cleanup.clearComposer({ texts })).rejects.toBeInstanceOf(BrowserStaleError)
    expect(keys).not.toContain('Backspace')
  })

  it('selects a navigation title beside its description and cleans the structural mention', async () => {
    const menu = '<button data-list-navigation-item="true"><div data-menu-row-content="true"><span><svg></svg></span><span><span><span>DSH with ChatGPT</span><span>Read-only workspace access</span></span></span></div></button>'
    const { browser, mutations, keys, window } = fixture('<div role="textbox" contenteditable="true"></div>' + menu, { mention: true })
    await browser.probeApp('DSH with ChatGPT')
    expect(mutations.some(name => name.endsWith('browser_click'))).toBe(true)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
    expect(keys).toEqual(['a', 'Backspace'])
  })

  it('ignores a hidden duplicate navigation title', async () => {
    const menu = '<button data-list-navigation-item="true"><div data-menu-row-content="true"><span>DSH with ChatGPT</span><span>Description</span></div></button>'
    const { browser } = fixture('<div role="textbox" contenteditable="true"></div>' + menu.replace('<button ', '<button style="display:none" ') + menu)
    const matcher = browser as unknown as { findAppCandidate(name: string): Promise<{ found: boolean }> }
    expect(await matcher.findAppCandidate('DSH with ChatGPT')).toMatchObject({ found: true })
  })

  it.each([
    ['exact title with description', '<button data-list-navigation-item="true"><div data-menu-row-content="true"><span>DSH with ChatGPT</span><span>Read-only workspace access</span></div></button>', true],
    ['title prefix', '<button data-list-navigation-item="true"><div data-menu-row-content="true"><span>DSH with ChatGPT Other</span><span>Description</span></div></button>', false],
    ['description-only match', '<button data-list-navigation-item="true"><div data-menu-row-content="true"><span>Other App</span><span>DSH with ChatGPT</span></div></button>', false],
    ['hidden exact title', '<button data-list-navigation-item="true" style="display:none"><div data-menu-row-content="true"><span>DSH with ChatGPT</span></div></button>', false],
    ['missing semantic row', '<button data-list-navigation-item="true">DSH with ChatGPT</button>', false],
    ['duplicate exact titles', '<button data-list-navigation-item="true"><div data-menu-row-content="true"><span>DSH with ChatGPT</span></div></button><button data-list-navigation-item="true"><div data-menu-row-content="true"><span>DSH with ChatGPT</span></div></button>', false],
    ['legacy/new duplicate', '<div role="listbox"><button>DSH with ChatGPT</button></div><button data-list-navigation-item="true"><div data-menu-row-content="true"><span>DSH with ChatGPT</span></div></button>', false],
  ])('matches semantic navigation candidates: %s', async (_name, menu, found) => {
    const { browser } = fixture('<div role="textbox" contenteditable="true"></div>' + menu)
    const matcher = browser as unknown as { findAppCandidate(name: string): Promise<{ found: boolean }> }
    expect(await matcher.findAppCandidate('DSH with ChatGPT')).toMatchObject({ found })
  })

  it('types into a legacy textarea and sends the exact value', async () => {
    const { browser, enteredText } = fixture('<textarea id="prompt-textarea"></textarea>', { appName: '' })
    await browser.sendControlMessage('control message')
    expect(enteredText()).toBe('control message')
  })

  it('cleans an owned legacy textarea value after failed input verification', async () => {
    const { browser, window, keys } = fixture('<textarea id="prompt-textarea"></textarea>', { appName: '', failAfterType: true })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('textarea')!.value).toBe('')
    expect(keys).toEqual(['a', 'Backspace'])
  })
  it('types a no-App message without using contenteditable fill', async () => {
    const { browser, mutations, enteredText } = fixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
    await browser.sendControlMessage('control message')
    expect(enteredText()).toBe('control message')
    expect(mutations.some(name => name.endsWith('browser_fill'))).toBe(false)
  })

  it.each(['outside', 'partial', 'none'] as const)('refuses cleanup with %s selection', async selection => {
    const { browser, window, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true, selection })
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('DSH with ChatGPT')
    expect(keys).not.toContain('Backspace')
  })
  it.each([
    '<div id="prompt-textarea" contenteditable="true"></div>',
    '<div role="textbox" contenteditable="true"></div>',
    '<div id="prompt-textarea" role="textbox" contenteditable="true"></div>',
    '<div id="prompt-textarea" style="display:none"></div><div role="textbox" contenteditable="true"></div>',
  ])('accepts one visible composer: %s', async html => {
    const { browser } = fixture(html)
    expect(await browser.readiness()).toMatchObject({ composer: true, loggedOut: false })
  })

  it('rejects two visible composers before any input', async () => {
    const { browser, mutations, keys } = fixture('<div id="prompt-textarea" contenteditable="true"></div><div role="textbox" contenteditable="true"></div>')
    await expect(browser.sendControlMessage('do not send')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(mutations).toEqual([])
  })

  it('rejects a hidden composer before any input', async () => {
    const { browser, mutations, keys } = fixture('<div id="prompt-textarea" style="visibility:hidden"></div>')
    await expect(browser.sendControlMessage('do not send')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(mutations).toEqual([])
  })

  it.each(['throw', 'top', 'nested'] as const)('fails closed on %s provider errors', async providerFailure => {
    const { browser, mutations, keys } = fixture('<div role="textbox" contenteditable="true"></div>', { providerFailure })
    await expect(browser.sendControlMessage('do not send')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(mutations).toEqual([])
  })

  it('preserves an existing user draft without probing', async () => {
    const { browser, mutations, keys, window } = fixture('<div role="textbox" contenteditable="true">user draft</div>')
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('user draft')
    expect(mutations).toEqual([])
  })

  it('selects a structural App mention and verifies empty cleanup without sending', async () => {
    const { browser, mutations, keys, window } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true })
    await browser.probeApp('DSH with ChatGPT')
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
    expect(keys).not.toContain('Enter')
  })

  it('reports cleanup failure rather than App success', async () => {
    const { browser, mutations, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true, keepDraft: true })
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(keys).not.toContain('Enter')
    expect(keys.filter(key => key === 'Backspace')).toHaveLength(1)
  })

  it('does not accept plain App-name text as a mention', async () => {
    const { browser, mutations, keys, window } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(ChatGptAppUnavailableError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
    expect(keys).not.toContain('Enter')
  }, 10_000)

  it('does not select a similarly named App', async () => {
    const { browser, mutations, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT Other</button></div>')
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(ChatGptAppUnavailableError)
    expect(mutations.some(name => name.endsWith('browser_click'))).toBe(false)
    expect(keys).not.toContain('Enter')
  })

  it('restores composer focus after App selection before typing and sending', async () => {
    const { browser, enteredText } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true })
    await browser.sendControlMessage('control message')
    expect(enteredText()).toBe('DSH with ChatGPT control message')
  })

  it('preserves existing drafts in the no-App send path', async () => {
    const { browser, mutations, keys, window } = fixture('<div role="textbox" contenteditable="true">user draft</div>', { appName: '' })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('user draft')
    expect(mutations).toEqual([])
  })

  it.each([false, true])('cleans only owned input after a send failure (foreign=%s)', async foreignDraft => {
    const { browser, mutations, keys, window } = fixture('<div role="textbox" contenteditable="true"></div>', { failAfterType: true, foreignDraft })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe(foreignDraft ? 'foreign user draft' : '')
    expect(keys.includes('Backspace')).toBe(!foreignDraft)
    expect(keys).not.toContain('Enter')
  })

  it('removes stale target markers when a rerender makes the composer ambiguous', async () => {
    const { browser, mutations, keys, window } = fixture('<div role="textbox" contenteditable="true"></div>', { ambiguousAfterInput: true })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[data-d2c-composer-target]')).toBeNull()
    expect(mutations.filter(name => name.endsWith('browser_fill'))).toHaveLength(0)
    expect(mutations.filter(name => name.endsWith('browser_type'))).toHaveLength(1)
    expect(keys).toEqual([])
  })

  it('preserves a foreign draft that is a prefix of the intended App input', async () => {
    const { browser, mutations, keys, window } = fixture('<div role="textbox" contenteditable="true"></div>', { failAfterType: true, foreignDraft: '@DSH with' })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('@DSH with')
    expect(mutations.filter(name => name.endsWith('browser_fill'))).toHaveLength(0)
    expect(keys).not.toContain('Enter')
  })
})
