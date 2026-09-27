import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserHarnessAdapter } from '../src/browser/harness.ts'
import { BrowserStaleError, ChatGptAppUnavailableError } from '../src/browser/adapter.ts'

const windows: Window[] = []
afterEach(async () => { await Promise.all(windows.splice(0).map(window => window.happyDOM.close())) })

function fixture(html: string, options: { appName?: string; mention?: boolean; keepDraft?: boolean; ambiguousAfterFill?: boolean; failAfterType?: boolean; foreignDraft?: boolean | string; providerFailure?: 'throw' | 'top' | 'nested' } = {}) {
  const window = new Window({ url: 'https://chatgpt.com/' })
  windows.push(window)
  window.document.body.innerHTML = html
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON: () => ({}) })
  }
  const mutations: string[] = []
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
    if (name.endsWith('browser_fill')) {
      const target = window.document.querySelector(String(args.selector))!
      if (!(options.keepDraft && args.text === '')) target.textContent = String(args.text)
      ;(target as unknown as { focus(): void }).focus()
      if (options.ambiguousAfterFill) {
        const extra = window.document.createElement('div')
        extra.setAttribute('role', 'textbox')
        extra.setAttribute('contenteditable', 'true')
        extra.getBoundingClientRect = target.getBoundingClientRect
        window.document.body.append(extra)
      }
    }
    if (name.endsWith('browser_type')) {
      window.document.activeElement!.append(window.document.createTextNode(String(args.text)))
      typed = true
    }
    if (name.endsWith('browser_click') && options.mention) {
      const composer = window.document.querySelector('[data-d2c-composer-target]')!
      composer.innerHTML = '<span contenteditable="false">DSH with ChatGPT</span>'
      window.document.querySelector('button')!.focus()
    }
    if (name.endsWith('browser_press')) {
      expect(window.document.activeElement).toBe(window.document.querySelector('[data-d2c-composer-target]'))
      enteredText = window.document.activeElement!.textContent!
    }
    return { value: {} }
  } }) } as never, undefined, options.appName ?? 'DSH with ChatGPT')
  return { browser, mutations, window, enteredText: () => enteredText }
}

describe('ChatGPT composer DOM resolution', () => {
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
    const { browser, mutations } = fixture('<div id="prompt-textarea" contenteditable="true"></div><div role="textbox" contenteditable="true"></div>')
    await expect(browser.sendControlMessage('do not send')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(mutations).toEqual([])
  })

  it('rejects a hidden composer before any input', async () => {
    const { browser, mutations } = fixture('<div id="prompt-textarea" style="visibility:hidden"></div>')
    await expect(browser.sendControlMessage('do not send')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(mutations).toEqual([])
  })

  it.each(['throw', 'top', 'nested'] as const)('fails closed on %s provider errors', async providerFailure => {
    const { browser, mutations } = fixture('<div role="textbox" contenteditable="true"></div>', { providerFailure })
    await expect(browser.sendControlMessage('do not send')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(mutations).toEqual([])
  })

  it('preserves an existing user draft without probing', async () => {
    const { browser, mutations, window } = fixture('<div role="textbox" contenteditable="true">user draft</div>')
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('user draft')
    expect(mutations).toEqual([])
  })

  it('selects a structural App mention and verifies empty cleanup without sending', async () => {
    const { browser, mutations, window } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true })
    await browser.probeApp('DSH with ChatGPT')
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
    expect(mutations.some(name => name.endsWith('browser_press'))).toBe(false)
  })

  it('reports cleanup failure rather than App success', async () => {
    const { browser, mutations } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true, keepDraft: true })
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(mutations.some(name => name.endsWith('browser_press'))).toBe(false)
  })

  it('does not accept plain App-name text as a mention', async () => {
    const { browser, mutations, window } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(ChatGptAppUnavailableError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
    expect(mutations.some(name => name.endsWith('browser_press'))).toBe(false)
  }, 10_000)

  it('does not select a similarly named App', async () => {
    const { browser, mutations } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT Other</button></div>')
    await expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(ChatGptAppUnavailableError)
    expect(mutations.some(name => name.endsWith('browser_click') || name.endsWith('browser_press'))).toBe(false)
  })

  it('restores composer focus after App selection before typing and sending', async () => {
    const { browser, enteredText } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true })
    await browser.sendControlMessage('control message')
    expect(enteredText()).toBe('DSH with ChatGPT control message')
  })

  it('preserves existing drafts in the no-App send path', async () => {
    const { browser, mutations, window } = fixture('<div role="textbox" contenteditable="true">user draft</div>', { appName: '' })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('user draft')
    expect(mutations).toEqual([])
  })

  it.each([false, true])('cleans only owned input after a send failure (foreign=%s)', async foreignDraft => {
    const { browser, mutations, window } = fixture('<div role="textbox" contenteditable="true"></div>', { failAfterType: true, foreignDraft })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe(foreignDraft ? 'foreign user draft' : '')
    expect(mutations.filter(name => name.endsWith('browser_fill'))).toHaveLength(foreignDraft ? 1 : 2)
    expect(mutations.some(name => name.endsWith('browser_press'))).toBe(false)
  })

  it('removes stale target markers when a rerender makes the composer ambiguous', async () => {
    const { browser, mutations, window } = fixture('<div role="textbox" contenteditable="true"></div>', { ambiguousAfterFill: true })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[data-d2c-composer-target]')).toBeNull()
    expect(mutations.filter(name => name.endsWith('browser_fill'))).toHaveLength(1)
    expect(mutations.some(name => name.endsWith('browser_type') || name.endsWith('browser_press'))).toBe(false)
  })

  it('preserves a foreign draft that is a prefix of the intended App input', async () => {
    const { browser, mutations, window } = fixture('<div role="textbox" contenteditable="true"></div>', { failAfterType: true, foreignDraft: '@DSH with' })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('@DSH with')
    expect(mutations.filter(name => name.endsWith('browser_fill'))).toHaveLength(1)
    expect(mutations.some(name => name.endsWith('browser_press'))).toBe(false)
  })
})
