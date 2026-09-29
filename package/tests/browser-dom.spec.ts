import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserHarnessAdapter } from '../src/browser/harness.ts'
import { BrowserStaleError, ChatGptAppUnavailableError, ChatGptLoggedOutError } from '../src/browser/adapter.ts'
import { OperationCancelledError } from '../src/cancellation.ts'

vi.mock('node:timers/promises', () => ({
  setTimeout: (milliseconds: number, value: unknown, options: { signal?: AbortSignal } = {}) => new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(new Error('aborted'))
    }
    const timer = setTimeout(() => {
      options.signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }, milliseconds)
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  }),
}))

const windows: Window[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(windows.splice(0).map(window => window.happyDOM.close())) })

function fixture(html: string, options: { selection?: 'outside' | 'partial' | 'none' | 'icon' | 'tail'; appName?: string; mention?: boolean; autoMention?: boolean; keepDraft?: boolean; ambiguousAfterInput?: boolean; failAfterType?: boolean; foreignDraft?: boolean | string; omitAtomText?: boolean; separator?: string; beforeAtom?: boolean; extraAtom?: string; failPrompt?: boolean; partialPrompt?: boolean; providerFailure?: 'throw' | 'top' | 'nested' } = {}) {
  const window = new Window({ url: 'https://chatgpt.com/' })
  windows.push(window)
  window.document.body.innerHTML = html
  window.document.elementFromPoint = () => Array.from(window.document.querySelectorAll('[role="listbox"] button, [role="menu"] button, button[data-list-navigation-item="true"]')).find(node => window.getComputedStyle(node).display !== 'none' && window.getComputedStyle(node).visibility !== 'hidden') ?? null
  for (const element of window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON: () => ({}) })
  }
  const mutations: string[] = []
  const keys: string[] = []
  const inputs: string[] = []
  let typed = false
  let failed = false
  let enteredText = ''
  const browser = new BrowserHarnessAdapter({ get: () => ({ execute: async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
    if (name.endsWith('browser_page_info')) return { value: { url: 'https://chatgpt.com/' } }
    if (name.endsWith('browser_current_tab')) {
      mutations.push(name)
      const target = { targetId: 'owned-target', url: window.location.href }
      window.document.dispatchEvent(new window.CustomEvent('current-target', { detail: target }))
      return { value: target }
    }
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
    if (name.endsWith('browser_cdp')) window.document.dispatchEvent(new window.CustomEvent('target-activate', { detail: args }))
    if (name.endsWith('browser_fill')) throw new Error('contenteditable fill must not be used')
    if (name.endsWith('browser_type')) {
      inputs.push(String(args.text))
      const target = window.document.activeElement!
      if (target instanceof window.HTMLTextAreaElement) target.value += String(args.text)
      else (target.querySelector('p') ?? target).append(window.document.createTextNode(options.partialPrompt && inputs.length === 3 ? String(args.text).slice(0, 3) : String(args.text)))
      if (options.failPrompt && inputs.length === 3) throw new Error('provider failed after prompt mutation')
      typed = args.text !== '@'
      if (options.autoMention && args.text === (options.appName ?? 'DSH with ChatGPT')) {
        const composer = window.document.querySelector('[data-d2c-composer-target]')!
        composer.innerHTML = '<p><span contenteditable="false" app-mention-display-name="DSH with ChatGPT"><span contenteditable="false"><svg></svg></span><span>DSH with ChatGPT</span></span></p>'
      }
      window.document.dispatchEvent(new window.CustomEvent('composer-type', { detail: args.text }))
      if (options.ambiguousAfterInput) {
        const extra = window.document.createElement('div')
        extra.setAttribute('role', 'textbox')
        extra.setAttribute('contenteditable', 'true')
        extra.getBoundingClientRect = window.document.activeElement!.getBoundingClientRect
        window.document.body.append(extra)
      }
    }
    if (name.endsWith('browser_click')) window.document.dispatchEvent(new window.Event('candidate-click'))
    if (name.endsWith('browser_click') && options.mention && window.document.visibilityState === 'visible') {
      const composer = window.document.querySelector('[data-d2c-composer-target]')!
      composer.innerHTML = '<p><span contenteditable="false" app-mention-display-name="DSH with ChatGPT"><span contenteditable="false"><svg></svg></span><span>DSH with ChatGPT</span></span></p>'
      const paragraph = composer.querySelector('p')!
      if (options.beforeAtom) paragraph.prepend(window.document.createTextNode(options.separator ?? ' '))
      else if (options.separator !== undefined) paragraph.append(window.document.createTextNode(options.separator))
      if (options.extraAtom) paragraph.insertAdjacentHTML('beforeend', options.extraAtom)
      window.document.querySelector('button')!.focus()
    }
    if (name.endsWith('browser_press')) {
      keys.push(String(args.key))
      if (window.document.visibilityState !== 'visible') return { value: {} }
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
          if (options.selection === 'partial') range.setEnd(window.document.createTreeWalker(composer, window.NodeFilter.SHOW_TEXT).nextNode()!, 1)
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
  return { browser, mutations, keys, inputs, window, enteredText: () => enteredText }
}

describe('ChatGPT composer DOM resolution', () => {

  it('activates exactly the hidden current target before selecting an App', async () => {
    vi.useFakeTimers()
    const { browser, window, mutations } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true })
    let visible = false
    Object.defineProperty(window.document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' })
    window.document.addEventListener('target-activate', event => {
      expect((event as unknown as { detail: unknown }).detail).toEqual({ method: 'Target.activateTarget', params: { targetId: 'owned-target' } })
      visible = true
    })
    const pending = browser.probeApp('DSH with ChatGPT').catch(error => error)
    await vi.runAllTimersAsync()
    expect(await pending).toBeUndefined()
    expect(mutations.filter(name => name.endsWith('browser_cdp'))).toHaveLength(1)
    expect(mutations.filter(name => name.endsWith('browser_click'))).toHaveLength(1)
    expect(mutations.some(name => /list_tabs|new_tab|switch_tab/.test(name))).toBe(false)
  })

  it('activates a hidden owned composer before guarded cleanup', async () => {
    const { browser, window, keys } = fixture('<div role="textbox" contenteditable="true">@DSH with ChatGPT</div>')
    let visible = false
    Object.defineProperty(window.document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' })
    window.document.addEventListener('target-activate', () => { visible = true })
    const cleanup = browser as unknown as { clearComposer(draft: { texts: string[] }): Promise<void> }
    await cleanup.clearComposer({ texts: ['@DSH with ChatGPT'] })
    expect(keys).toEqual(['a', 'Backspace'])
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
  })

  it('leaves the already visible target active without tab operations', async () => {
    const { browser, mutations } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true })
    await browser.probeApp('DSH with ChatGPT')
    expect(mutations.some(name => /browser_cdp|current_tab|list_tabs|new_tab|switch_tab/.test(name))).toBe(false)
  })

  it.each(['hidden', 'url', 'target'])('preserves the draft without clicking or keys when visibility recovery fails: %s', async failure => {
    vi.useFakeTimers()
    const { browser, window, mutations, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true })
    let visible = false
    let activated = false
    Object.defineProperty(window.document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' })
    window.document.addEventListener('target-activate', () => {
      activated = true
      visible = failure !== 'hidden'
      if (failure === 'url') window.location.href = 'https://chatgpt.com/c/other'
    })
    window.document.addEventListener('current-target', event => {
      if (activated && failure === 'target') (event as unknown as { detail: { targetId: string } }).detail.targetId = 'different-target'
    })
    const pending = browser.probeApp('DSH with ChatGPT').catch(error => error)
    await vi.runAllTimersAsync()
    expect(await pending).toBeInstanceOf(BrowserStaleError)
    expect(mutations.filter(name => name.endsWith('browser_click'))).toHaveLength(0)
    expect(mutations.filter(name => name.endsWith('browser_cdp'))).toHaveLength(1)
    expect(keys).toEqual([])
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('@DSH with ChatGPT')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects hidden foreign cleanup before any tab or key mutation', async () => {
    const { browser, window, mutations, keys } = fixture('<div role="textbox" contenteditable="true">foreign draft</div>')
    Object.defineProperty(window.document, 'visibilityState', { value: 'hidden' })
    const cleanup = browser as unknown as { clearComposer(draft: { texts: string[] }): Promise<void> }
    await expect(cleanup.clearComposer({ texts: ['@DSH with ChatGPT'] })).rejects.toBeInstanceOf(BrowserStaleError)
    expect(mutations).toEqual([])
    expect(keys).toEqual([])
  })

  it('preserves hidden owned cleanup when activation cannot make it visible', async () => {
    vi.useFakeTimers()
    const { browser, window, keys } = fixture('<div role="textbox" contenteditable="true">@DSH with ChatGPT</div>')
    Object.defineProperty(window.document, 'visibilityState', { value: 'hidden' })
    const cleanup = browser as unknown as { clearComposer(draft: { texts: string[] }): Promise<void> }
    const pending = cleanup.clearComposer({ texts: ['@DSH with ChatGPT'] }).catch(error => error)
    await vi.runAllTimersAsync()
    expect(await pending).toBeInstanceOf(BrowserStaleError)
    expect(keys).toEqual([])
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('@DSH with ChatGPT')
  })

  it.each([false, true])('recovers visibility before sending and rechecks draft ownership (foreign=%s)', async foreign => {
    const { browser, window, keys, enteredText, mutations } = fixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
    let visible = true
    Object.defineProperty(window.document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' })
    window.document.addEventListener('composer-type', () => { visible = false })
    window.document.addEventListener('target-activate', () => {
      visible = true
      if (foreign) window.document.querySelector('[role="textbox"]')!.textContent = 'foreign draft'
    })
    if (foreign) {
      await expect(browser.sendControlMessage('request')).rejects.toBeInstanceOf(BrowserStaleError)
      expect(keys).toEqual([])
      expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('foreign draft')
    } else {
      await browser.sendControlMessage('request')
      expect(keys).toEqual(['Enter'])
      expect(enteredText()).toBe('request')
    }
    expect(mutations.filter(name => name.endsWith('browser_cdp'))).toHaveLength(1)
  })

  it('cancels visibility recovery without activating or cleaning another target', async () => {
    const { browser, window, mutations, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    Object.defineProperty(window.document, 'visibilityState', { value: 'hidden' })
    const controller = new AbortController()
    window.document.addEventListener('current-target', () => controller.abort())
    await expect(browser.probeApp('DSH with ChatGPT', controller.signal)).rejects.toBeInstanceOf(OperationCancelledError)
    expect(mutations.filter(name => name.endsWith('browser_cdp'))).toHaveLength(0)
    expect(keys).toEqual([])
  })

  it('rejects an activation provider error without querying or mutating the composer', async () => {
    const calls: string[] = []
    const browser = new BrowserHarnessAdapter({ get: () => ({ execute: async (request: { name: string }) => {
      const name = request.name.replace('mcp__browser-harness__', '')
      calls.push(name)
      if (name === 'browser_js') return { value: { visibility: 'hidden', url: 'https://chatgpt.com/' } }
      if (name === 'browser_page_info') return { value: { url: 'https://chatgpt.com/' } }
      if (name === 'browser_current_tab') return { value: { targetId: 'owned-target', url: 'https://chatgpt.com/' } }
      return { value: { error: 'activation unavailable' } }
    } }) } as never, undefined, '')
    const guard = browser as unknown as { ensureCurrentTargetVisible(draft: { texts: string[]; preserve?: boolean }): Promise<void> }
    const draft = { texts: ['request'], preserve: false }
    await expect(guard.ensureCurrentTargetVisible(draft)).rejects.toThrow('activation failed')
    expect(draft.preserve).toBe(true)
    expect(calls).toEqual(['browser_js', 'browser_page_info', 'browser_current_tab', 'browser_cdp'])
  })

  it('waits for a composer mounted after navigation without modifying its draft', async () => {
    vi.useFakeTimers()
    const { browser, window, mutations } = fixture('<div role="textbox" contenteditable="true" style="display:none">foreign draft</div>')
    const pending = browser.openConversation('existing')
    await vi.advanceTimersByTimeAsync(400)
    window.document.querySelector('[role="textbox"]')!.removeAttribute('style')
    await vi.advanceTimersByTimeAsync(200)
    await expect(pending).resolves.toBe('')
    expect(mutations.map(name => name.split('__').at(-1))).toEqual(['browser_goto', 'browser_wait_for_load'])
    expect(window.document.querySelector('[data-d2c-composer-target]')).toBeNull()
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('foreign draft')
    await expect(browser.sendControlMessage('request')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('foreign draft')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds persistent composer absence without navigating again', async () => {
    vi.useFakeTimers()
    const { browser, mutations } = fixture('')
    const result = expect(browser.openConversation('existing')).rejects.toThrow('composer not found after navigation')
    await vi.advanceTimersByTimeAsync(10_000)
    await result
    expect(mutations.map(name => name.split('__').at(-1))).toEqual(['browser_goto', 'browser_wait_for_load'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels navigation readiness without waiting for its deadline', async () => {
    vi.useFakeTimers()
    const { browser, mutations } = fixture('')
    const controller = new AbortController()
    const result = expect(browser.openConversation('existing', controller.signal)).rejects.toBeInstanceOf(OperationCancelledError)
    await vi.advanceTimersByTimeAsync(200)
    controller.abort()
    await result
    expect(mutations.map(name => name.split('__').at(-1))).toEqual(['browser_goto', 'browser_wait_for_load'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['<div role="textbox" contenteditable="true"></div><div id="prompt-textarea"></div>', BrowserStaleError],
    ['<button>Log in</button>', ChatGptLoggedOutError],
  ])('rejects unsafe navigation readiness immediately: %s', async (html, error) => {
    vi.useFakeTimers()
    const { browser, mutations } = fixture(html)
    await expect(browser.openConversation('existing')).rejects.toBeInstanceOf(error)
    expect(mutations.map(name => name.split('__').at(-1))).toEqual(['browser_goto', 'browser_wait_for_load'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['deadline', 'caller'] as const)('interrupts a stalled semantic inspection on %s', async reason => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let inspectorSignal: AbortSignal | undefined
    const calls: string[] = []
    const browser = new BrowserHarnessAdapter({ get: () => ({ execute: async (request: { name: string; signal: AbortSignal }) => {
      calls.push(request.name)
      if (request.name.endsWith('browser_js')) {
        inspectorSignal = request.signal
        return new Promise(() => {})
      }
      return { value: {} }
    } }) } as never, undefined, '')
    const result = expect(browser.openConversation('existing', controller.signal)).rejects.toBeInstanceOf(reason === 'caller' ? OperationCancelledError : BrowserStaleError)
    await vi.advanceTimersByTimeAsync(0)
    expect(inspectorSignal).toBeDefined()
    if (reason === 'caller') controller.abort()
    else await vi.advanceTimersByTimeAsync(10_000)
    await result
    expect(inspectorSignal!.aborted).toBe(true)
    expect(calls.map(name => name.split('__').at(-1))).toEqual(['browser_goto', 'browser_wait_for_load', 'browser_js'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['current', '<div data-chatgpt-selection-message-id="old"><div data-markdown-text-style="assistant-message">old</div></div><div data-chatgpt-selection-message-id="new"><div data-markdown-text-style="assistant-message">new</div></div>', 2, 'new'],
    ['legacy', '<div data-message-author-role="assistant">legacy</div>', 1, 'legacy'],
    ['nested overlap', '<div data-message-author-role="assistant">heading<div data-markdown-text-style="assistant-message">reply</div></div>', 1, 'reply'],
    ['shared identity', '<div data-chatgpt-selection-message-id="one"><div data-message-author-role="assistant">legacy</div><div data-markdown-text-style="assistant-message">current</div></div>', 1, 'current'],
    ['mixed order', '<div data-markdown-text-style="assistant-message">first</div><div data-message-author-role="assistant">second</div><div data-markdown-text-style="assistant-message">third</div>', 3, 'third'],
    ['later legacy', '<div data-markdown-text-style="assistant-message">first</div><div data-message-author-role="assistant">last</div>', 2, 'last'],
    ['current user', '<div data-markdown-text-style="user-message">[D2C_APP_PROOF_V1]</div>', 0, ''],
    ['legacy user', '<div data-message-author-role="user">proof</div>', 0, ''],
    ['identity alone', '<div data-chatgpt-selection-message-id="one">proof</div>', 0, ''],
    ['search metadata', '<div data-chatgpt-search-unit-key="turn:assistant">proof</div>', 0, ''],
    ['later user', '<div data-markdown-text-style="assistant-message">reply</div><div data-message-author-role="user">later</div>', 1, 'reply'],
  ])('reads only logical assistant messages: %s', async (_name, html, assistantCount, text) => {
    const { browser } = fixture(html)
    const inspector = browser as unknown as { inspectChatPage(): Promise<{ assistantCount: number; text: string }> }
    expect(await inspector.inspectChatPage()).toMatchObject({ assistantCount, text })
  })

  it('ignores unchanged overlapping baseline and waits for a settled new assistant reply', async () => {
    const { browser, window } = fixture('<div role="textbox" contenteditable="true"></div><div data-chatgpt-selection-message-id="old"><div data-markdown-text-style="assistant-message">old</div></div>', { appName: '' })
    await browser.sendControlMessage('request')
    vi.useFakeTimers()
    const pending = browser.waitForReply(15_000)
    let completed = false
    void pending.then(() => { completed = true })
    window.document.querySelector('[data-chatgpt-selection-message-id]')!.setAttribute('data-message-author-role', 'assistant')
    await vi.advanceTimersByTimeAsync(3000)
    expect(completed).toBe(false)
    window.document.body.insertAdjacentHTML('beforeend', '<div data-markdown-text-style="assistant-message">new</div>')
    await vi.advanceTimersByTimeAsync(1500)
    expect(completed).toBe(false)
    await vi.advanceTimersByTimeAsync(4500)
    await expect(pending).resolves.toEqual({ text: 'new', complete: true })
  })

  it.each(['animated', 'legacy-stop'] as const)('never settles a paused response with %s generation evidence', async marker => {
    const { browser, window } = fixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
    await browser.sendControlMessage('request')
    window.document.body.insertAdjacentHTML('beforeend', '<div data-markdown-text-style="assistant-message">partial</div>')
    const body = window.document.querySelector('[data-markdown-text-style]')!
    if (marker === 'animated') body.setAttribute('data-markdown-animated', '')
    else window.document.body.insertAdjacentHTML('beforeend', '<button aria-label="Stop streaming"></button>')
    vi.useFakeTimers()
    let complete = false
    const pending = browser.waitForReply(30_000).then(reply => { complete = true; return reply })
    await vi.advanceTimersByTimeAsync(7500)
    expect(complete).toBe(false)
    body.textContent = 'final'
    body.removeAttribute('data-markdown-animated')
    window.document.querySelector('button')?.remove()
    await vi.advanceTimersByTimeAsync(1500)
    expect(complete).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(pending).resolves.toEqual({ text: 'final', complete: true })
    expect(window.document.querySelector('[data-chatgpt-selection-message-id]')).toBeNull()
  })

  it.each([false, true])('resets fallback settling after a three-second pause regardless of message identity (%s)', async identity => {
    const { browser, window } = fixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
    await browser.sendControlMessage('request')
    window.document.body.insertAdjacentHTML('beforeend', '<div data-markdown-text-style="assistant-message">partial</div>')
    const body = window.document.querySelector('[data-markdown-text-style]')!
    if (identity) body.setAttribute('data-chatgpt-selection-message-id', 'reply')
    vi.useFakeTimers()
    let complete = false
    const pending = browser.waitForReply(30_000).then(reply => { complete = true; return reply })
    await vi.advanceTimersByTimeAsync(4500)
    expect(complete).toBe(false)
    body.textContent = 'final'
    await vi.advanceTimersByTimeAsync(4500)
    expect(complete).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(pending).resolves.toEqual({ text: 'final', complete: true })
  })

  it('ignores animated markdown outside the latest assistant body', async () => {
    const { browser, window } = fixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
    await browser.sendControlMessage('request')
    window.document.body.insertAdjacentHTML('beforeend', '<div data-markdown-animated>unrelated</div><div data-markdown-text-style="assistant-message">final</div>')
    vi.useFakeTimers()
    const pending = browser.waitForReply(15_000)
    await vi.advanceTimersByTimeAsync(6000)
    await expect(pending).resolves.toEqual({ text: 'final', complete: true })
  })

  it.each([false, true])('cancels reply settling after observed streaming=%s', async streaming => {
    const { browser, window } = fixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
    await browser.sendControlMessage('request')
    window.document.body.insertAdjacentHTML('beforeend', '<div data-markdown-text-style="assistant-message">partial</div>')
    const body = window.document.querySelector('[data-markdown-text-style]')!
    if (streaming) body.setAttribute('data-markdown-animated', '')
    vi.useFakeTimers()
    const controller = new AbortController()
    const result = expect(browser.waitForReply(30_000, controller.signal)).rejects.toBeInstanceOf(OperationCancelledError)
    await vi.advanceTimersByTimeAsync(1500)
    body.removeAttribute('data-markdown-animated')
    await vi.advanceTimersByTimeAsync(1500)
    controller.abort()
    await result
    expect(vi.getTimerCount()).toBe(0)
  })


  it.each(['', ' '])('cleans recognized App-only separator %j', async separator => {
    const { browser, keys, window } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true, separator })
    await browser.probeApp('DSH with ChatGPT')
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
    expect(keys).toEqual(['a', 'Backspace'])
  })


  it.each(['', ' '])('sends one exact separator with editor suffix %j', async separator => {
    const { browser, keys, inputs, enteredText } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true, separator })
    await browser.sendControlMessage('control message')
    expect(inputs[2]).toBe(separator === '' ? ' control message' : 'control message')
    expect(enteredText()).toBe('DSH with ChatGPT control message')
    expect(keys).toEqual(['Enter'])
  })

  it.each([
    { separator: '  ' }, { separator: String.fromCharCode(160) }, { separator: String.fromCharCode(10) },
    { separator: ' ', beforeAtom: true }, { separator: ' foreign' },
    { extraAtom: '<span contenteditable="false"></span>' },
    { extraAtom: '<i></i> ' },
    { extraAtom: '<span contenteditable="false" app-mention-display-name="DSH with ChatGPT">DSH with ChatGPT</span>' },
  ])('rejects unknown post-App content %j before typing prompt', async options => {
    const { browser, keys, inputs, window } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true, ...options })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(inputs).toEqual(['@', 'DSH with ChatGPT'])
    expect(keys).not.toContain('Enter')
    expect(keys).not.toContain('Backspace')
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toContain('DSH with ChatGPT')
  })

  it.each([false, true])('cleans only fully committed prompt after separator (partial=%s)', async partialPrompt => {
    const { browser, keys, window } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>', { mention: true, separator: ' ', failPrompt: true, partialPrompt })
    await expect(browser.sendControlMessage('control message')).rejects.toBeInstanceOf(BrowserStaleError)
    expect(keys).not.toContain('Enter')
    expect(keys.filter(key => key === 'Backspace')).toHaveLength(partialPrompt ? 0 : 1)
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe(partialPrompt ? 'DSH with ChatGPT con' : '')
  })


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

  it('cleans an auto-completed App mention and supports a repeated probe', async () => {
    const { browser, keys, window } = fixture('<div role="textbox" contenteditable="true"></div>', { autoMention: true })
    await browser.probeApp('DSH with ChatGPT')
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
    await browser.probeApp('DSH with ChatGPT')
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('')
    expect(keys.filter(key => key === 'Backspace')).toHaveLength(2)
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

  it('bounds unsuccessful activation to two clicks without sending', async () => {
    vi.useFakeTimers()
    const { browser, mutations, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    const pending = expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(ChatGptAppUnavailableError)
    await vi.runAllTimersAsync()
    await pending
    expect(mutations.filter(name => name.endsWith('browser_click'))).toHaveLength(2)
    expect(keys).not.toContain('Enter')
  })

  it.each([600, 1000])('waits for delayed activation at %sms without another click', async milliseconds => {
    vi.useFakeTimers()
    const { browser, window, mutations, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    window.document.addEventListener('candidate-click', () => {
      setTimeout(() => { window.document.querySelector('[role="textbox"]')!.innerHTML = '<span contenteditable="false">DSH with ChatGPT</span>'; window.document.querySelector('[role="listbox"]')!.remove() }, milliseconds)
    })
    const pending = browser.probeApp('DSH with ChatGPT')
    await vi.runAllTimersAsync()
    await pending
    expect(mutations.filter(name => name.endsWith('browser_click'))).toHaveLength(1)
    expect(keys).not.toContain('Enter')
  })

  it('retries one no-op only after the full activation wait', async () => {
    vi.useFakeTimers()
    const { browser, window, mutations } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    const times: number[] = []
    window.document.addEventListener('candidate-click', () => {
      times.push(Date.now())
      if (times.length === 2) window.document.querySelector('[role="textbox"]')!.innerHTML = '<span contenteditable="false">DSH with ChatGPT</span>'
    })
    const pending = browser.probeApp('DSH with ChatGPT')
    await vi.runAllTimersAsync()
    await pending
    expect(mutations.filter(name => name.endsWith('browser_click'))).toHaveLength(2)
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1500)
  })

  it('does not retry when the candidate disappears without activation', async () => {
    vi.useFakeTimers()
    const { browser, window, mutations, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    window.document.addEventListener('candidate-click', () => { window.document.querySelector('[role="listbox"]')!.remove() })
    const pending = browser.probeApp('DSH with ChatGPT').catch(error => error)
    await vi.runAllTimersAsync()
    expect(await pending).toBeInstanceOf(ChatGptAppUnavailableError)
    expect(mutations.filter(name => name.endsWith('browser_click'))).toHaveLength(1)
    expect(keys).not.toContain('Enter')
  })

  it('does not click when the candidate is occluded before activation', async () => {
    vi.useFakeTimers()
    const { browser, window, mutations } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    let hits = 0
    window.document.elementFromPoint = () => ++hits === 1 ? window.document.querySelector('button') : window.document.body
    const pending = browser.probeApp('DSH with ChatGPT').catch(error => error)
    await vi.runAllTimersAsync()
    expect(await pending).toBeInstanceOf(ChatGptAppUnavailableError)
    expect(mutations.filter(name => name.endsWith('browser_click'))).toHaveLength(0)
  })

  it('preserves unverified plain App-name text after a failed click', async () => {
    vi.useFakeTimers()
    const { browser, window, keys } = fixture('<div role="textbox" contenteditable="true"></div><div role="listbox"><button>DSH with ChatGPT</button></div>')
    window.document.addEventListener('candidate-click', () => { window.document.querySelector('[role="textbox"]')!.textContent = 'DSH with ChatGPT' })
    const pending = expect(browser.probeApp('DSH with ChatGPT')).rejects.toBeInstanceOf(BrowserStaleError)
    await vi.runAllTimersAsync()
    await pending
    expect(window.document.querySelector('[role="textbox"]')!.textContent).toBe('DSH with ChatGPT')
    expect(keys).not.toContain('Backspace')
    expect(keys).not.toContain('Enter')
  })

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
