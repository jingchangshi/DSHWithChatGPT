import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { localCdpBrowser } from './fixtures/local-cdp-browser.ts'
import { syntheticCdpDocument } from './fixtures/synthetic-cdp-document.ts'
import { DirectCdpPrimitives } from '../src/browser/direct-cdp.ts'
import { ChatGptWebDriver } from '../src/browser/chatgpt-web-driver.ts'
import { BrowserTargetChangedError } from '../src/browser/epoch.ts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startSidecar, protectPrivateStateDirectory } from '../src/sidecar/server.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'

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

async function temporaryPromotionDriver(options: { inlineDurable?: boolean; existingTemporary?: boolean; deferSend?: boolean } = {}) {
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
  if (!options.deferSend) await driver.sendControlMessage('owned request')
  return driver
}

it.each(['exact proof', 'wrong digest', 'duplicate user', 'document replacement', 'permanent temporary', 'cancelled'] as const)(
  'resolves an acknowledged bootstrap through real CDP with %s', async scenario => {
  const driver = await temporaryPromotionDriver({ deferSend: true })
  const original = await driver.captureReplyBaseline()
  await primitives.evaluate(`(() => {
    const scenario = ${JSON.stringify(scenario)};
    document.querySelector('[role=textbox]').addEventListener('keydown', event => {
      if (event.key === 'Enter' && scenario !== 'permanent temporary') setTimeout(() => {
        const user = document.querySelector('[data-message-author-role=user]');
        if (scenario === 'wrong digest') user.append(' foreign');
        if (scenario === 'duplicate user') document.body.append(user.cloneNode(true));
        if (scenario === 'document replacement') location.href = '/c/6abfada1-f690-83ee-aedf-762de215604f';
        else history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f');
      }, 800);
    }); return true;
  })()`)
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-direct-bootstrap-'))
  let service: Awaited<ReturnType<typeof startSidecar>> | undefined
  try {
    await protectPrivateStateDirectory(directory, [])
    service = await startSidecar({ host: '127.0.0.1', port: 0, authentication: 'test-only', stateDirectory: directory, driver, requestTimeoutMs: 3000 })
    const client = new SidecarChatControlClient({ endpoint: service.endpoint, authentication: 'test-only', requestTimeoutMs: 3000 })
    const operation = { operationId: 'owned-bootstrap', replyBaseline: original,
      correlation: { taskId: 'pb_' + 'd'.repeat(32), iteration: 0, workspaceId: 'world', phase: 'INIT' as const } }
    await client.sendControlMessage('owned request', undefined, operation)
    if (scenario !== 'exact proof') {
      const code = scenario === 'cancelled' ? 'OPERATION_CANCELLED'
        : scenario === 'permanent temporary' ? 'SIDECAR_TIMEOUT' : 'BROWSER_TARGET_CHANGED'
      await expect(client.captureSendObservation(operation.operationId, scenario === 'cancelled' ? AbortSignal.timeout(200) : undefined)).rejects.toMatchObject({ code })
      const source = JSON.parse(await readFile(join(directory, 'delivery.json'), 'utf8')).entries.find((entry: any) => entry.operationId === operation.operationId)
      expect(source.phase).toBe('accepted')
      expect(source.bootstrapBaseline).toBeUndefined()
      expect(source.bootstrap.replyBaseline).toEqual(original)
      if (scenario !== 'document replacement') expect(await primitives.evaluate('window.enterCount')).toBe(1)
      return
    }
    const bound = await client.captureSendObservation(operation.operationId)
    expect(bound.conversationId).toBe('6abfada1-f690-83ee-aedf-762de215604f')
    expect(bound.assistantCount).toBe(original.assistantCount)
    expect(bound.textDigest).toBe(original.textDigest)
    expect(await primitives.evaluate('window.enterCount')).toBe(1)
    const source = JSON.parse(await readFile(join(directory, 'delivery.json'), 'utf8')).entries.find((entry: any) => entry.operationId === operation.operationId)
    expect(source.phase).toBe('accepted')
    expect(source.bootstrap.replyBaseline).toEqual(original)
    expect(source.bootstrapBaseline).toEqual(bound)
  } finally {
    await service?.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 8000)

it.each([
  'exact persisted', 'delayed raw App', 'wrong persisted digest', 'wrong persisted App',
  'duplicate persisted users', 'permanent missing', 'permanent raw App', 'foreign-return',
  'unfenced replacement', 'present wrong digest', 'present duplicate', 'foreign draft',
] as const)('rematerializes a second bootstrap proof with %s', async scenario => {
  const driver = await temporaryPromotionDriver({ deferSend: true })
  const original = await driver.captureReplyBaseline()
  await primitives.evaluate(`(() => {
    document.querySelector('[role=textbox]').addEventListener('keydown', event => {
      if (event.key === 'Enter') setTimeout(() => history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f'), 500);
    }); return true;
  })()`)
  document.serve({ apps: ['DSH with ChatGPT'],
    persistedControl: scenario === 'permanent missing' ? undefined : scenario === 'wrong persisted digest' ? 'foreign request' : 'owned request',
    persistedApp: scenario === 'wrong persisted App' ? 'Different App' : undefined,
    duplicatePersistedUser: scenario === 'duplicate persisted users',
    pendingAppRendering: scenario === 'delayed raw App' || scenario === 'permanent raw App',
    pendingAppLabel: '$dsh-with-chatgpt', persistedMountDelayMs: scenario === 'delayed raw App' ? 400 : undefined,
    keepPendingAppRendering: scenario === 'permanent raw App',
    redirectOnLoad: scenario === 'foreign-return' ? '/c/foreign' : undefined,
    returnFromRedirect: scenario === 'foreign-return',
  })
  const observe = primitives.observe.bind(primitives)
  const reload = primitives.reloadCurrent.bind(primitives)
  const press = primitives.press.bind(primitives)
  let awaitingFirstProof = false, firstProofRemoved = false, reloads = 0, enters = 0
  primitives.press = async (...args) => { if (args[0] === 'Enter') enters++; return press(...args) }
  primitives.observe = async (...args) => {
    const result = await observe(...args)
    if (awaitingFirstProof && args[0].includes('return messageObservations;')
      && Array.isArray(result.value) && result.value.some(message => message.role === 'user')) {
      awaitingFirstProof = false
      await observe(`(() => {
        const user = document.querySelector('[data-message-author-role=user]');
        const scenario = ${JSON.stringify(scenario)};
        if (scenario === 'present wrong digest') user.append(' foreign');
        else if (scenario === 'present duplicate') document.body.append(user.cloneNode(true));
        else {
          user.remove();
          if (scenario === 'foreign draft') document.querySelector('[role=textbox]').textContent = 'foreign unsent draft';
        }
        return true;
      })()`)
      firstProofRemoved = true
    }
    return result
  }
  primitives.reloadCurrent = async (...args) => {
    reloads++
    if (scenario === 'unfenced replacement') {
      await primitives.navigate(args[0].url)
      await primitives.waitForLoad(2000)
    }
    return reload(...args)
  }
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-second-proof-'))
  let service: Awaited<ReturnType<typeof startSidecar>> | undefined
  try {
    await protectPrivateStateDirectory(directory, [])
    service = await startSidecar({ host: '127.0.0.1', port: 0, authentication: 'test-only', stateDirectory: directory, driver, requestTimeoutMs: 3000 })
    const client = new SidecarChatControlClient({ endpoint: service.endpoint, authentication: 'test-only', requestTimeoutMs: 3000 })
    const operation = { operationId: 'second-proof-bootstrap', replyBaseline: original,
      correlation: { taskId: 'pb_' + 'e'.repeat(32), iteration: 0, workspaceId: 'world', phase: 'INIT' as const } }
    await client.sendControlMessage('owned request', undefined, operation)
    expect(await primitives.evaluate('window.enterCount')).toBe(1)
    awaitingFirstProof = true
    if (scenario === 'exact persisted' || scenario === 'delayed raw App') {
      const bound = await client.captureSendObservation(operation.operationId)
      expect(bound.conversationId).toBe('6abfada1-f690-83ee-aedf-762de215604f')
      expect(bound.assistantCount).toBe(original.assistantCount)
      expect(bound.textDigest).toBe(original.textDigest)
      expect(bound.observationEpoch).not.toBe(original.observationEpoch)
      const source = JSON.parse(await readFile(join(directory, 'delivery.json'), 'utf8')).entries.find((entry: any) => entry.operationId === operation.operationId)
      expect(source.bootstrapBaseline).toEqual(bound)
    } else {
      const code = scenario === 'permanent missing' || scenario === 'permanent raw App' ? 'SIDECAR_TIMEOUT'
        : scenario === 'foreign-return' || scenario === 'unfenced replacement' ? 'BROWSER_TARGET_CHANGED' : 'SEND_UNCERTAIN'
      await expect(client.captureSendObservation(operation.operationId)).rejects.toMatchObject({ code })
      const source = JSON.parse(await readFile(join(directory, 'delivery.json'), 'utf8')).entries.find((entry: any) => entry.operationId === operation.operationId)
      expect(source.bootstrapBaseline).toBeUndefined()
    }
    expect(firstProofRemoved).toBe(true)
    const noReload = scenario.startsWith('present ') || scenario === 'foreign draft'
    expect(reloads).toBe(noReload ? 0 : 1)
    expect(enters).toBe(1)
    if (primitives.bindingState === 'BOUND') expect(await primitives.evaluate('window.enterCount')).toBe(noReload ? 1 : 0)
    if (scenario === 'foreign draft') expect(await primitives.evaluate("document.querySelector('[role=textbox]').textContent")).toBe('foreign unsent draft')
    const source = JSON.parse(await readFile(join(directory, 'delivery.json'), 'utf8')).entries.find((entry: any) => entry.operationId === operation.operationId)
    expect(source.phase).toBe('accepted')
    expect(source.bootstrap.replyBaseline).toEqual(original)
  } finally {
    primitives.observe = observe; primitives.reloadCurrent = reload; primitives.press = press
    await service?.close()
    await rm(directory, { recursive: true, force: true })
    if (primitives.bindingState !== 'BOUND') await primitives.reconnect()
  }
}, 8000)

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

it.each([{ rendering: 'display label', pendingAppLabel: undefined }, { rendering: 'raw App slug', pendingAppLabel: '$dsh-with-chatgpt' }])('materializes a missing outgoing message with $rendering, one fenced durable reload and no Enter replay', async ({ pendingAppLabel }) => {
  const driver = await temporaryPromotionDriver()
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
  document.serve({ apps: ['DSH with ChatGPT'], persistedControl: 'owned request', persistedReply: 'complete reply', persistedMountDelayMs: 2500, pendingAppRendering: true, pendingAppLabel })
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

it.each(['wrong digest', 'wrong App', 'no user', 'duplicate user', 'foreign route', 'hidden foreign route', 'unresolved App', 'unresolved raw App', 'raw App wrong digest', 'duplicate raw App', 'raw App wrong resolved App', 'wrong raw App label'])('rejects %s after durable materialization reload', async failure => {
  const driver = await temporaryPromotionDriver()
  document.serve({
    apps: ['DSH with ChatGPT'], persistedControl: failure === 'no user' ? undefined : (failure === 'wrong digest' || failure === 'raw App wrong digest') ? 'foreign request' : 'owned request',
    persistedApp: (failure === 'wrong App' || failure === 'raw App wrong resolved App') ? 'Different App' : undefined,
    duplicatePersistedUser: failure === 'duplicate user' || failure === 'duplicate raw App',
    redirectOnLoad: failure.includes('foreign route') ? '/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : undefined,
    returnFromRedirect: failure === 'hidden foreign route',
    pendingAppRendering: failure.includes('raw App') || failure === 'unresolved App',
    pendingAppLabel: failure === 'wrong raw App label' ? '$different-app' : failure.includes('raw App') ? '$dsh-with-chatgpt' : undefined,
    persistedMountDelayMs: failure.includes('raw App') ? 250 : undefined,
    keepPendingAppRendering: failure === 'unresolved App' || failure === 'unresolved raw App' || failure === 'wrong raw App label',
  })
  await primitives.evaluate(`(() => {
    document.querySelector('[data-message-author-role="user"]').remove();
    history.replaceState(null, '', '/c/6abfada1-f690-83ee-aedf-762de215604f'); return true;
  })()`)
  if (failure === 'no user' || failure === 'unresolved App' || failure === 'unresolved raw App') {
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
