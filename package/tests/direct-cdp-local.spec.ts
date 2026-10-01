import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { localCdpBrowser } from './fixtures/local-cdp-browser.ts'
import { DirectCdpPrimitives, listCdpTargets } from '../src/browser/direct-cdp.ts'
import { cdpInputAckProxy } from './fixtures/cdp-input-ack-proxy.ts'

let fixture: Awaited<ReturnType<typeof localCdpBrowser>>
let browser: DirectCdpPrimitives
beforeAll(async () => {
  fixture = await localCdpBrowser()
  browser = await DirectCdpPrimitives.connect({ endpoint: fixture.endpoint, targetId: fixture.targetId, commandTimeoutMs: 1500 })
}, 15_000)
afterAll(async () => { browser?.close(); await fixture?.close() }, 10_000)
beforeEach(async () => { await browser.navigate(fixture.baseUrl + '/input'); await browser.waitForLoad(5_000) })

it('uses real focus, Unicode input, keyboard events and click handlers', async () => {
  let context = { expected: await browser.currentTarget() }
  context = { expected: (await browser.focus('#edit', context)).target }
  context = { expected: (await browser.type('中文 π 🧪', context)).target }
  expect(await browser.evaluate('document.querySelector("#edit").value')).toBe('中文 π 🧪')
  context = { expected: (await browser.press('a', 2, context)).target }
  context = { expected: (await browser.press('Backspace', undefined, context)).target }
  expect(await browser.evaluate('document.querySelector("#edit").value')).toBe('')
  context = { expected: (await browser.press('Enter', undefined, context)).target }
  const point = await browser.evaluate<{ x: number; y: number }>('(() => { const r = document.querySelector("#button").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
  await browser.click(point.x, point.y, context)
  expect(await browser.evaluate('document.querySelector("#result").textContent')).toBe('clicked')
  const events = await browser.evaluate<Array<{ name: string; key?: string; target: string }>>('window.events')
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'focus', target: 'edit' }),
    expect.objectContaining({ name: 'input', target: 'edit' }),
    expect.objectContaining({ name: 'keydown', key: 'Enter' }),
    expect.objectContaining({ name: 'keyup', key: 'Enter' }),
    expect.objectContaining({ name: 'keydown', key: 'Backspace' }),
    expect.objectContaining({ name: 'click', target: 'button' }),
  ]))
})

it('observes a real mutation and bounds an idle observation', async () => {
  const pending = browser.waitForMutation(800)
  await browser.evaluate('new Promise(resolve => setTimeout(() => { document.querySelector("#result").textContent = "mutated"; resolve(true) }, 50))')
  const started = Date.now()
  await pending
  expect(Date.now() - started).toBeLessThan(500)
  const idle = Date.now()
  await browser.waitForMutation(80)
  expect(Date.now() - idle).toBeGreaterThanOrEqual(70)
  expect(Date.now() - idle).toBeLessThan(800)
})

it('retains identity across History API but rejects old fences after navigation and reload', async () => {
  const before = await browser.currentTarget()
  await browser.evaluate('history.pushState(null, "", "/history?view=1#fragment")')
  const history = (await browser.observe('true', before)).target
  expect(history.documentId).toBe(before.documentId)
  expect(history.epoch).toBe(before.epoch)
  expect(history.url).toContain('/history?view=1#fragment')
  await browser.navigate(fixture.baseUrl + '/second')
  await browser.waitForLoad(5_000)
  const replacement = await browser.currentTarget()
  expect(replacement.documentId).not.toBe(before.documentId)
  await expect(browser.type('must not appear', { expected: before })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  expect(await browser.evaluate('document.querySelector("#edit").value')).toBe('')
  await browser.navigate(replacement.url)
  await browser.waitForLoad(5_000)
  expect((await browser.currentTarget()).documentId).not.toBe(replacement.documentId)
})

it('rejects pre-dispatch cancellation without page input', async () => {
  const expected = await browser.currentTarget()
  const controller = new AbortController()
  controller.abort()
  await expect(browser.type('cancelled', { expected, signal: controller.signal })).rejects.toMatchObject({ name: 'OperationCancelledError' })
  await expect(browser.focus('#edit', { expected, signal: controller.signal })).rejects.toMatchObject({ name: 'OperationCancelledError' })
  await expect(browser.press('Enter', undefined, { expected, signal: controller.signal })).rejects.toMatchObject({ name: 'OperationCancelledError' })
  await expect(browser.click(20, 20, { expected, signal: controller.signal })).rejects.toMatchObject({ name: 'OperationCancelledError' })
  await expect(browser.navigate(fixture.baseUrl + '/second', controller.signal)).rejects.toMatchObject({ name: 'OperationCancelledError' })
  expect(await browser.evaluate('window.events.filter(event => event.name === "input")')).toEqual([])
})

it('bounds a never-settling Runtime promise and reconnect invalidates every old fence', async () => {
  const expected = await browser.currentTarget()
  const started = Date.now()
  await expect(browser.evaluate('new Promise(() => {})')).rejects.toMatchObject({ name: 'CdpCommandError' })
  expect(Date.now() - started).toBeLessThan(3000)
  await browser.reconnect()
  const reconnected = await browser.currentTarget()
  expect(reconnected.targetId).toBe(expected.targetId)
  expect(reconnected.epoch).toBeGreaterThan(expected.epoch)
  await expect(browser.type('old binding', { expected })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  expect(await browser.evaluate('document.querySelector("#edit").value')).toBe('')
}, 5000)

it('rejects an in-flight read on socket loss without replay and reconnects only the same target', async () => {
  const pending = browser.evaluate('new Promise(() => {})').catch(error => error)
  await browser.pageInfo()
  browser.close()
  expect(await pending).toMatchObject({ name: 'CdpCommandError' })
  await browser.reconnect()
  expect((await browser.currentTarget()).targetId).toBe(fixture.targetId)
})

it('quarantines a lost real Input ack even though the page was mutated, without replay or later Enter', async () => {
  const proxy = await cdpInputAckProxy(fixture.endpoint, fixture.targetId)
  let binding: DirectCdpPrimitives | undefined
  try {
    binding = await DirectCdpPrimitives.connect({ endpoint: proxy.endpoint, targetId: fixture.targetId, commandTimeoutMs: 500 })
    const expected = await binding.currentTarget()
    // Focus via the independent task-owned connection: the fault drops only Input.
    await browser.focus('#edit', { expected: await browser.currentTarget() })
    await expect(binding.type('actually inserted', { expected })).rejects.toMatchObject({ name: 'BrowserMutationUncertainError' })
    expect(binding.bindingState).toBe('QUARANTINED')
    expect(await browser.evaluate('document.querySelector("#edit").value')).toBe('actually inserted')
    await expect(binding.press('Enter', undefined, { expected })).rejects.toThrow()
    await binding.reconnect()
    await expect(binding.type('must not replay', { expected })).rejects.toThrow()
    expect(proxy.commands).toEqual(['Input.insertText'])
    expect(await browser.evaluate('window.events.filter(event => event.name === "keydown" && event.key === "Enter")')).toEqual([])
  } finally { binding?.close(); await proxy.close() }
})

it('retains real acknowledged input when the caller aborts after socket dispatch', async () => {
  const controller = new AbortController()
  const proxy = await cdpInputAckProxy(fixture.endpoint, fixture.targetId, { dropAck: false, onInput: () => controller.abort() })
  let binding: DirectCdpPrimitives | undefined
  try {
    binding = await DirectCdpPrimitives.connect({ endpoint: proxy.endpoint, targetId: fixture.targetId, commandTimeoutMs: 1000 })
    await browser.focus('#edit', { expected: await browser.currentTarget() })
    const expected = await binding.currentTarget()
    await expect(binding.type('acknowledged', { expected, signal: controller.signal })).resolves.toMatchObject({ target: { documentId: expected.documentId } })
    expect(controller.signal.aborted).toBe(true)
    expect(binding.bindingState).toBe('BOUND')
    expect(proxy.commands).toEqual(['Input.insertText'])
    expect(await browser.evaluate('document.querySelector("#edit").value')).toBe('acknowledged')
  } finally { binding?.close(); await proxy.close() }
})

it('never adopts another page after the owned target disappears', async () => {
  const replacement = await (await fetch(fixture.endpoint + '/json/new?' + fixture.baseUrl + '/second', { method: 'PUT' })).json() as { id: string }
  expect(replacement.id).not.toBe(fixture.targetId)
  const response = await fetch(fixture.endpoint + '/json/close/' + fixture.targetId)
  expect(response.ok).toBe(true)
  await response.text()
  const until = Date.now() + 2000
  while ((await listCdpTargets(fixture.endpoint)).some(target => target.id === fixture.targetId) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25))
  await expect(browser.currentTarget()).rejects.toThrow()
  await expect(browser.reconnect()).rejects.toThrow('target unavailable')
  expect((await listCdpTargets(fixture.endpoint)).some(target => target.id === replacement.id)).toBe(true)
})
