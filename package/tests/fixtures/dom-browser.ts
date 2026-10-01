import { Window } from 'happy-dom'
import { expect } from 'vitest'

// UI mechanics only: semantic queries are evaluated against this DOM unchanged.
const windows: Window[] = []
export async function closeDomFixtures(): Promise<void> { await Promise.all(windows.splice(0).map(window => window.happyDOM.close())) }

export function domFixture(html: string, options: { selection?: 'outside' | 'partial' | 'none' | 'icon' | 'tail'; appName?: string; mention?: boolean; autoMention?: boolean; keepDraft?: boolean; ambiguousAfterInput?: boolean; failAfterType?: boolean; foreignDraft?: boolean | string; omitAtomText?: boolean; separator?: string; beforeAtom?: boolean; extraAtom?: string; failPrompt?: boolean; partialPrompt?: boolean; providerFailure?: 'throw' | 'top' | 'nested' } = {}) {
  function createWindow(html: string, url = 'https://chatgpt.com/') {
    const window = new Window({ url })
    windows.push(window)
    window.document.body.innerHTML = html
    window.document.elementFromPoint = () => Array.from(window.document.querySelectorAll('[role="listbox"] button, [role="menu"] button, button[data-list-navigation-item="true"]')).find(node => window.getComputedStyle(node).display !== 'none' && window.getComputedStyle(node).visibility !== 'hidden') ?? null
    // happy-dom has no layout engine. Give dynamically inserted messages the
    // same mechanical geometry as initial nodes; CSS visibility is still real.
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON: () => ({}) })

    return window
  }
  let window = createWindow(html)
  const mutations: string[] = []
  const inspections: string[] = []
  const keys: string[] = []
  const inputs: string[] = []
  let typed = false
  let failed = false
  let enteredText = ''
  const execute = async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
    if (name.endsWith('browser_page_info')) return { value: { url: 'https://chatgpt.com/' } }
    if (name.endsWith('browser_current_tab')) {
      inspections.push(name)
      const target = { targetId: 'owned-target', url: window.location.href }
      window.document.dispatchEvent(new window.CustomEvent('current-target', { detail: target }))
      return { value: target }
    }
    if (options.providerFailure === 'throw') throw new Error('provider failed')
    if (options.providerFailure === 'top') return { isError: true }
    if (options.providerFailure === 'nested') return { value: { isError: true } }
    if (name.endsWith('browser_js')) {
      // This fault exercises the semantic inspection after acknowledged input,
      // not the mechanical post-ack identity reconciliation (covered separately).
      if (typed && options.failAfterType && !failed && !String(args.expression).includes('value: (true)')) {
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
        const composer = window.document.querySelector('[data-plannerbridge-composer-target]')!
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
      const composer = window.document.querySelector('[data-plannerbridge-composer-target]')!
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
      expect(window.document.activeElement).toBe(window.document.querySelector('[data-plannerbridge-composer-target]'))
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
  }
  return { execute, mutations, inspections, keys, inputs, get window() { return window }, replaceDocument: (body = html) => { window = createWindow(body, window.location.href) }, enteredText: () => enteredText }
}
