import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { localCdpBrowser } from './fixtures/local-cdp-browser.ts'
import { syntheticCdpDocument } from './fixtures/synthetic-cdp-document.ts'
import { DirectCdpPrimitives } from '../src/browser/direct-cdp.ts'
import { ChatGptWebDriver } from '../src/browser/chatgpt-web-driver.ts'
import { BrowserTargetChangedError } from '../src/browser/epoch.ts'

// REAL CHROME / REAL CDP / SYNTHETIC CHATGPT-SHAPED PAGE.
// Fetch interception supplies local test content, never real ChatGPT evidence.
let fixture: Awaited<ReturnType<typeof localCdpBrowser>>
let document: Awaited<ReturnType<typeof syntheticCdpDocument>>
let primitives: DirectCdpPrimitives
beforeAll(async () => {
  fixture = await localCdpBrowser()
  document = await syntheticCdpDocument(fixture.endpoint, fixture.targetId)
  primitives = await DirectCdpPrimitives.connect({ endpoint: fixture.endpoint, targetId: fixture.targetId, commandTimeoutMs: 2000 })
}, 15_000)
afterAll(async () => { primitives?.close(); document?.close(); await fixture?.close() }, 10_000)
async function page(options: Parameters<typeof document.serve>[0] = {}, route = '/') {
  document.serve(options)
  await primitives.navigate('https://chatgpt.com' + route)
  await primitives.waitForLoad(5000)
  return new ChatGptWebDriver(primitives, '')
}
beforeEach(async () => { await page() })

it('selects one exact App and dispatches the control message exactly once', async () => {
  await page({ apps: ['Different App', 'DSH with ChatGPT'] })
  const driver = new ChatGptWebDriver(primitives, 'DSH with ChatGPT')
  await driver.sendControlMessage('owned request')
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
  expect(await primitives.evaluate('window.sent.map(text => text.replace(/\u00a0/g, " "))')).toEqual(['DSH with ChatGPT owned request'])
  expect(await driver.currentConversation()).toBe('promoted')
})

it('preserves multiline control payload through paragraph-based composer rendering', async () => {
  await page({ apps: ['DSH with ChatGPT'], paragraphComposer: true })
  const driver = new ChatGptWebDriver(primitives, 'DSH with ChatGPT')
  const control = '[PLANNER_EXECUTOR]\nSTATE: INIT\n\nGOAL:\nImplement interval subtraction.\nKeep  two spaces and\tthis tab.'
  await driver.sendControlMessage(control)
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
  expect(await primitives.evaluate('window.sent.map(text => text.replace(/\u00a0/g, " "))')).toEqual(['DSH with ChatGPT ' + control])
  expect(await driver.currentConversation()).toBe('promoted')
})

it('refuses changed payload whitespace in a paragraph composer without sending', async () => {
  await page({ apps: ['DSH with ChatGPT'], paragraphComposer: true, alterParagraph: true })
  const driver = new ChatGptWebDriver(primitives, 'DSH with ChatGPT')
  await expect(driver.sendControlMessage('STATE: INIT\n\nKeep  two spaces.')).rejects.toMatchObject({ name: 'BrowserStaleError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent.includes("Keep two spaces.")')).toBe(true)
})

it('refuses hidden paragraph payload without sending or deleting its draft', async () => {
  await page({ apps: ['DSH with ChatGPT'], paragraphComposer: true, hiddenParagraph: true })
  const driver = new ChatGptWebDriver(primitives, 'DSH with ChatGPT')
  await expect(driver.sendControlMessage('STATE: INIT\nHidden goal.')).rejects.toMatchObject({ name: 'BrowserStaleError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent.includes("Hidden goal.")')).toBe(true)
})

it.each([[], ['DSH with ChatGPT', 'DSH with ChatGPT']])('rejects missing or ambiguous App without sending', async apps => {
  await page({ apps })
  const driver = new ChatGptWebDriver(primitives, 'DSH with ChatGPT')
  await expect(driver.sendControlMessage('owned request')).rejects.toMatchObject({ name: 'ChatGptAppUnavailableError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('')
})

it('preserves a foreign draft and rejects conversation switching during input', async () => {
  let driver = await page({ draft: 'existing draft' })
  await expect(driver.sendControlMessage('owned request')).rejects.toMatchObject({ name: 'BrowserStaleError' })
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('existing draft')
  driver = await page({ foreignOnInput: true }, '/c/owned')
  await expect(driver.sendControlMessage('owned request')).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('foreign draft')
})

it('keeps the baseline during new-chat promotion and waits for streaming to settle', async () => {
  const driver = await page({ baseline: true })
  await driver.sendControlMessage('owned request')
  await primitives.evaluate('window.addReply("partial", true)')
  let settled = false
  const reply = driver.waitForReply(12_000).then(value => { settled = true; return value })
  await new Promise(resolve => setTimeout(resolve, 2000))
  expect(settled).toBe(false)
  await primitives.evaluate('(() => { const node = document.querySelector("[data-markdown-animated]"); node.textContent = "complete reply"; node.removeAttribute("data-markdown-animated"); return true })()')
  expect(await reply).toEqual({ text: 'complete reply', complete: true })
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
}, 15_000)

async function temporaryPromotionDriver(options: { inlineDurable?: boolean; existingTemporary?: boolean } = {}) {
  await page({ apps: ['DSH with ChatGPT'] }, options.existingTemporary ? '/c/local-chatgpt%3Ae9c9d7d2-9ba8-4691-be51-2222a0fcd69e' : '/')
  const driver = new ChatGptWebDriver(primitives, 'DSH with ChatGPT')
  // Actual production trace: same document, contiguous root -> local route ->
  // repeated local route -> durable route. Keep a visible exact outgoing App
  // message so the durable identity can be proven rather than prefix-trusted.
  await primitives.evaluate(`(() => {
    const push = history.pushState.bind(history);
    history.pushState = (state, title, url) => push(state, title,
      url === '/c/promoted' ? '/c/local-chatgpt%3Ae9c9d7d2-9ba8-4691-be51-2222a0fcd69e' : url);
    const composer = document.querySelector('[role=textbox]');
    composer.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const message = document.createElement('article');
      message.setAttribute('data-message-author-role', 'user');
      for (const node of composer.childNodes) message.append(node.cloneNode(true));
      const atom = message.querySelector('[app-mention-display-name]');
      const app = document.createElement('a'); app.href = '/plugins/owned-app'; app.textContent = atom.textContent;
      atom.replaceWith(app);
      document.body.append(message);
    }, true);
    return true;
  })()`)
  if (options.inlineDurable) await primitives.evaluate(`(() => {
    document.querySelector('[role=textbox]').addEventListener('keydown', event => {
      if (event.key === 'Enter') history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f');
    }); return true;
  })()`)
  await driver.sendControlMessage('owned request')
  return driver
}

it('proves the sent App message before adopting a temporary new-chat route as a durable conversation', async () => {
  const driver = await temporaryPromotionDriver()
  await primitives.evaluate(`(() => {
    history.replaceState(null, '', location.href);
    history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f');
    window.addReply('complete reply'); return true;
  })()`)
  expect(await driver.waitForReply(9000)).toEqual({ text: 'complete reply', complete: true })
  expect(await driver.currentConversation()).toBe('6abfada1-f690-83ee-aedf-762de215604f')
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
}, 12_000)

it.each([
  'missing message', 'wrong digest', 'wrong App', 'duplicate message', 'later user',
  'second durable route', 'different temporary route', 'missing history', 'document replacement',
])('rejects temporary conversation promotion with %s', async failure => {
  const driver = await temporaryPromotionDriver()
  const target = await primitives.currentTarget()
  if (failure === 'document replacement') {
    await primitives.navigate('https://chatgpt.com/c/6abfada1-f690-83ee-aedf-762de215604f')
    await primitives.waitForLoad(5000)
  } else {
    await primitives.evaluate(`(() => {
      const failure = ${JSON.stringify(failure)};
      const user = document.querySelector('[data-message-author-role="user"]');
      if (failure === 'missing message') user.remove();
      if (failure === 'wrong digest') user.append(document.createTextNode(' altered'));
      if (failure === 'wrong App') user.querySelector('a').textContent = 'Different App';
      if (failure === 'duplicate message') document.body.append(user.cloneNode(true));
      if (failure === 'later user') { const later = document.createElement('article'); later.setAttribute('data-message-author-role', 'user'); later.textContent = 'foreign request'; document.body.append(later); }
      if (failure === 'different temporary route') history.replaceState(null, '', '/c/local-chatgpt%3Aaaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f');
      if (failure === 'second durable route') history.replaceState(null, '', '/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      window.addReply('foreign reply'); return true;
    })()`)
    if (failure === 'missing history') {
      const observe = primitives.observe.bind(primitives)
      primitives.observe = async (...args) => {
        const result = await observe(...args)
        return args[1]?.transitionSequence === target.transitionSequence ? { ...result, transitions: [] } : result
      }
      try { await expect(driver.waitForReply(5000)).rejects.toMatchObject({ name: 'BrowserTargetChangedError' }) }
      finally { primitives.observe = observe }
      return
    }
  }
  await expect(driver.waitForReply(5000)).rejects.toMatchObject({ name: failure === 'missing message' ? 'BrowserStaleError' : 'BrowserTargetChangedError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(['document replacement', 'missing message'].includes(failure) ? 0 : 1)
}, 8000)

it('rejects a later durable conversation after a successful proof-bound promotion', async () => {
  const driver = await temporaryPromotionDriver()
  await primitives.evaluate(`(() => { history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f'); return true })()`)
  expect(await driver.currentConversation()).toBe('6abfada1-f690-83ee-aedf-762de215604f')
  await primitives.evaluate(`(() => { history.replaceState(null, '', '/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); return true })()`)
  await expect(driver.currentConversation()).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
})

it('rejects temporary-to-durable conversion inside Enter before acknowledgement', async () => {
  await expect(temporaryPromotionDriver({ inlineDurable: true })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
})

it('does not adopt a preexisting temporary route using a later send', async () => {
  const driver = await temporaryPromotionDriver({ existingTemporary: true })
  await primitives.evaluate(`(() => { history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f'); return true })()`)
  await expect(driver.currentConversation()).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
})

it.each(['navigation', 'message change'])('rejects %s while collecting promotion proof', async failure => {
  const driver = await temporaryPromotionDriver()
  await primitives.evaluate(`(() => { history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f'); return true })()`)
  const observe = primitives.observe.bind(primitives)
  let injected = false
  primitives.observe = async (...args) => {
    if (!injected && args[0].includes('return messageObservations')) {
      injected = true
      await observe(failure === 'navigation'
        ? `(() => { history.replaceState(null, '', '/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); return true })()`
        : `(() => { document.querySelector('[data-message-author-role="user"]').append(document.createTextNode(' altered')); return true })()`)
    }
    return observe(...args)
  }
  try { await expect(driver.currentConversation()).rejects.toMatchObject({ name: 'BrowserTargetChangedError' }); expect(injected).toBe(true) }
  finally { primitives.observe = observe }
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
})

it('materializes a missing outgoing message with one fenced durable reload and no Enter replay', async () => {
  const driver = await temporaryPromotionDriver()
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
  document.serve({ apps: ['DSH with ChatGPT'], persistedControl: 'owned request', persistedReply: 'complete reply', persistedMountDelayMs: 2500, pendingAppRendering: true })
  await primitives.evaluate(`(() => {
    document.querySelector('[data-message-author-role="user"]').remove();
    history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f');
    window.addReply('complete reply'); return true;
  })()`)
  const reload = primitives.reloadCurrent.bind(primitives)
  let reloads = 0
  primitives.reloadCurrent = async (...args) => { reloads++; return reload(...args) }
  try {
    expect(await driver.waitForReply(12000)).toEqual({ text: 'complete reply', complete: true })
    expect(await driver.currentConversation()).toBe('6abfada1-f690-83ee-aedf-762de215604f')
    expect(reloads).toBe(1)
    expect(await primitives.evaluate('window.enterCount')).toBe(0)
  } finally { primitives.reloadCurrent = reload }
}, 15000)

it.each(['wrong digest', 'wrong App', 'no user', 'duplicate user', 'foreign route', 'hidden foreign route', 'unresolved App'])('rejects %s after durable materialization reload', async failure => {
  const driver = await temporaryPromotionDriver()
  document.serve({
    apps: ['DSH with ChatGPT'], persistedControl: failure === 'no user' ? undefined : failure === 'wrong digest' ? 'foreign request' : 'owned request',
    persistedApp: failure === 'wrong App' ? 'Different App' : undefined,
    duplicatePersistedUser: failure === 'duplicate user',
    redirectOnLoad: failure.includes('foreign route') ? '/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : undefined,
    returnFromRedirect: failure === 'hidden foreign route',
    pendingAppRendering: failure === 'unresolved App', keepPendingAppRendering: failure === 'unresolved App',
  })
  await primitives.evaluate(`(() => {
    document.querySelector('[data-message-author-role="user"]').remove();
    history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f'); return true;
  })()`)
  if (failure === 'no user' || failure === 'unresolved App') {
    await expect(driver.waitForReply(5000)).rejects.toMatchObject({ name: 'BrowserStaleError' })
    await expect(driver.currentConversation()).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  } else await expect(driver.currentConversation()).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  // A rejected reload can quarantine the concrete binding; next fixture owns
  // an explicit reconnect, never replay or silently adopt the failed operation.
  if (primitives.bindingState !== 'BOUND') await primitives.reconnect()
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
}, 10000)

it('rejects a route excursion before the same-route reload dispatch even after returning', async () => {
  await page({}, '/c/6abfada1-f690-83ee-aedf-762de215604f')
  const expected = await primitives.currentTarget()
  await primitives.evaluate(`(() => {
    const original = location.href;
    history.replaceState(null, '', '/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    history.replaceState(null, '', original); return true;
  })()`)
  await expect(primitives.reloadCurrent(expected)).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  expect((await primitives.currentTarget()).documentId).toBe(expected.documentId)
})

it('rejects unrelated same-document replies and same-URL replacement', async () => {
  let driver = await page({}, '/c/owned')
  await driver.sendControlMessage('owned request')
  await primitives.evaluate('(() => { history.pushState(null, "", "/c/foreign"); window.addReply("foreign reply"); return true })()')
  await expect(driver.waitForReply(5000)).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  driver = await page({}, '/c/owned')
  await driver.sendControlMessage('owned request')
  await primitives.navigate('https://chatgpt.com/c/owned')
  await primitives.waitForLoad(5000)
  await primitives.evaluate('window.addReply("replacement reply")')
  await expect(driver.waitForReply(5000)).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
}, 10_000)

it('rejects a second conversation promotion hidden inside the final Enter acknowledgement', async () => {
  const driver = await page()
  // The fixture's first handler promotes root to /c/promoted. This second
  // handler switches to B within the same keydown, before the Input response.
  await primitives.evaluate(`(() => {
    window.routeTrace = [];
    const push = history.pushState.bind(history);
    history.pushState = (...args) => { window.routeTrace.push(args[2]); return push(...args) };
    document.querySelector('[role=textbox]').addEventListener('keydown', event => {
      if (event.key === 'Enter') history.pushState(null, '', '/c/B');
    }); return true;
  })()`)
  const sendError = await driver.sendControlMessage('owned request').catch(error => error)
  expect(await primitives.evaluate('window.routeTrace')).toEqual(['/c/promoted', '/c/B'])
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
  if (sendError) expect(sendError).toBeInstanceOf(BrowserTargetChangedError)
  else {
    await primitives.evaluate('window.addReply("foreign B reply")')
    await expect(driver.waitForReply(8000)).rejects.toBeInstanceOf(BrowserTargetChangedError)
  }
  expect(await primitives.evaluate('window.keys')).toEqual(['Enter'])
}, 10_000)

it('rejects a real same-document detour even when the final conversation URL returns', async () => {
  const driver = await page()
  await primitives.evaluate("history.replaceState(null, '', '/c/owned')")
  await driver.sendControlMessage('owned request')
  await primitives.evaluate(`(() => {
    history.pushState(null, '', '/c/foreign');
    history.replaceState(null, '', '/c/owned');
    window.addReply('untrusted reply after detour'); return true;
  })()`)
  await expect(driver.waitForReply(8000)).rejects.toBeInstanceOf(BrowserTargetChangedError)
  expect(await primitives.evaluate('window.keys')).toEqual(['Enter'])
}, 10_000)

it('detects logout without synthetic success', async () => {
  const driver = await page({ logout: true })
  await expect(driver.ensureReady()).rejects.toMatchObject({ name: 'ChatGptLoggedOutError' })
})

it('stops a send on real document replacement during typing and preserves the replacement draft', async () => {
  const driver = await page({ replaceOnInput: true }, '/c/owned')
  await expect(driver.sendControlMessage('owned request')).rejects.toBeInstanceOf(BrowserTargetChangedError)
  if (primitives.bindingState !== 'BOUND') await primitives.reconnect()
  await primitives.waitForLoad(5000)
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('replacement draft')
})

it('cleans only acknowledged owned input after cancellation without late Enter', async () => {
  const driver = await page()
  const controller = new AbortController()
  const type = primitives.type.bind(primitives)
  primitives.type = async (text, context) => {
    const ack = await type(text, context)
    controller.abort()
    return ack
  }
  try {
    await expect(driver.sendControlMessage('owned request', controller.signal)).rejects.toMatchObject({ name: 'OperationCancelledError' })
    expect(await primitives.evaluate('window.enterCount')).toBe(0)
    expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('')
    expect(await primitives.evaluate('window.keys')).toEqual(['a', 'Backspace'])
  } finally { primitives.type = type }
})
