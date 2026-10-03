import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { createOwnedSidecarReplacement, runOwnedSidecarHandoff } from '../src/deployment/sidecar-target-recovery.ts'
import { BrowserMutationUncertainError } from '../src/browser/epoch.ts'

const durable = 'https://chatgpt.com/c/6abfada1-f690-83ee-aedf-762de215604f'
const page = (id: string, url = durable) => ({ id, type: 'page', url })
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const s = createServer(handler)
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r))
  cleanups.push(() => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()) }))
  return 'http://127.0.0.1:' + (s.address() as { port: number }).port
}
const json = (res: ServerResponse, body: unknown) => res.end(JSON.stringify(body))

it('preserves handoff ownership ordering and rolls back before commit', async () => {
  const events: string[] = []
  const replacement = { sourceTargetId: 'source', replacementTargetId: 'replacement', closeReplacement: async () => { events.push('close-replacement') }, retireSource: async () => { events.push('retire-source') } }
  await expect(runOwnedSidecarHandoff({ replacement, closeSource: async () => { events.push('close-source') }, startReplacement: async () => { events.push('start'); return 'owned' }, health: async () => { events.push('health'); return { ok: true } }, recover: async () => { events.push('recover') }, prove: async () => { events.push('prove'); return 'SEND_UNCERTAIN' }, commit: () => { events.push('commit') } })).resolves.toBe('SEND_UNCERTAIN')
  expect(events).toEqual(['close-source', 'start', 'health', 'recover', 'prove', 'close-replacement'])
})

it('transfers ownership at commit and swallows retirement failure', async () => {
  const replacement = { sourceTargetId: 'source', replacementTargetId: 'replacement', closeReplacement: vi.fn(async () => {}), retireSource: vi.fn(async () => { throw new Error('retire failed') }) }
  const commit = vi.fn()
  await expect(runOwnedSidecarHandoff({ replacement, closeSource: async () => {}, startReplacement: async () => 'owned', health: async () => ({ ok: true }), recover: async () => {}, prove: async () => undefined, commit })).resolves.toBeUndefined()
  expect(commit).toHaveBeenCalledOnce()
  expect(replacement.retireSource).toHaveBeenCalledOnce()
  expect(replacement.closeReplacement).not.toHaveBeenCalled()
})

it.each(['https://chatgpt.com/', 'https://chatgpt.com/c/temporary', 'https://example.com/c/6abfada1-f690-83ee-aedf-762de215604f', durable + '?x=1', durable + '#x', 'malformed'])('rejects non-durable source before creation: %s', async url => {
  let writes = 0
  const endpoint = await server((req, res) => { if (req.url === '/json/list') json(res, [page('source', url)]); else { writes++; res.end() } })
  await expect(createOwnedSidecarReplacement(endpoint, 'source')).rejects.toMatchObject({ code: 'BROWSER_TARGET_CHANGED' })
  expect(writes).toBe(0)
})
it.each([[], [page('source'), page('source')], [{ ...page('source'), type: 'worker' }]].map(targets => [targets]))('rejects missing, ambiguous or non-page source', async targets => {
  let writes = 0
  const endpoint = await server((req, res) => { if (req.url === '/json/list') json(res, targets); else { writes++; res.end() } })
  await expect(createOwnedSidecarReplacement(endpoint, 'source')).rejects.toMatchObject({ code: 'BROWSER_TARGET_CHANGED' })
  expect(writes).toBe(0)
})
it.each(['http://localhost:9222', 'http://127.1:9222', 'http://127.0.0.1:65536', 'http://127.0.0.1:9222/path'])('rejects endpoint alias or invalid spelling: %s', async endpoint => {
  await expect(createOwnedSidecarReplacement(endpoint, 'source')).rejects.toMatchObject({ code: 'BROWSER_TARGET_CHANGED' })
})
it.each(['source', 'foreign', '../unsafe'])('never closes an existing or invalid creation id: %s', async id => {
  const closed: string[] = []
  const endpoint = await server((req, res) => {
    if (req.url === '/json/list') json(res, [page('source'), page('foreign')])
    else if (req.method === 'PUT') json(res, page(id))
    else { closed.push(req.url!); res.end('closed') }
  })
  await expect(createOwnedSidecarReplacement(endpoint, 'source')).rejects.toBeInstanceOf(BrowserMutationUncertainError)
  expect(closed).toEqual([])
})
it.each(['changed-source', 'wrong-new-url', 'cancelled'])('cleans only the known new target after post-create failure: %s', async scenario => {
  let lists = 0, creates = 0
  const closed: string[] = [], controller = new AbortController()
  const endpoint = await server((req, res) => {
    if (req.url === '/json/list') {
      lists++
      if (lists === 1) json(res, [page('source')])
      else if (scenario === 'cancelled') { controller.abort(); res.end('[]') }
      else json(res, [page('source', scenario === 'changed-source' ? 'https://chatgpt.com/' : durable), page('new', scenario === 'wrong-new-url' ? 'https://chatgpt.com/' : durable)])
    } else if (req.method === 'PUT') { creates++; expect(req.url).toBe('/json/new?' + encodeURIComponent(durable)); json(res, page('new')) }
    else { closed.push(req.url!); res.end('closed') }
  })
  await expect(createOwnedSidecarReplacement(endpoint, 'source', controller.signal)).rejects.toThrow()
  expect(creates).toBe(1)
  expect(closed).toEqual(['/json/close/new'])
})
it('preserves the source until explicitly retired and refuses retirement after a route change', async () => {
  let created = false, changed = false
  const closed: string[] = []
  const endpoint = await server((req, res) => {
    if (req.url === '/json/list') json(res, [page('source', changed ? 'https://chatgpt.com/' : durable), ...(created ? [page('new')] : [])])
    else if (req.method === 'PUT') { created = true; json(res, page('new')) }
    else { closed.push(req.url!); res.end('closed') }
  })
  const replacement = await createOwnedSidecarReplacement(endpoint, 'source')
  expect(closed).toEqual([])
  changed = true
  await replacement.retireSource()
  expect(closed).toEqual([])
  await replacement.closeReplacement(); await replacement.closeReplacement()
  expect(closed).toEqual(['/json/close/new'])
})

it.each(['own-create', 'foreign-create', 'ambiguous', 'no-side-effect'])('preserves unknown target ownership after post-write cancellation: %s', async scenario => {
  const controller = new AbortController(), closed: string[] = []
  let creates = 0, lists = 0
  let targets = [page('source'), page('preexisting')]
  const endpoint = await server((req, res) => {
    if (req.url === '/json/list') { lists++; json(res, targets) }
    else if (req.method === 'PUT') {
      creates++
      // Whether Chrome or another actor creates a target is deliberately not
      // observable through the failed response. No discovery grants ownership.
      if (scenario !== 'no-side-effect') targets.push(page('new'))
      if (scenario === 'ambiguous') targets.push(page('second-new'))
      controller.abort(); res.destroy()
    } else { closed.push(req.url!); res.end('closed') }
  })
  await expect(createOwnedSidecarReplacement(endpoint, 'source', controller.signal)).rejects.toBeInstanceOf(BrowserMutationUncertainError)
  expect(creates).toBe(1)
  expect(lists).toBe(1)
  expect(closed).toEqual([])
  const remaining = await fetch(endpoint + '/json/list').then(res => res.json())
  expect(remaining.map((target: { id: string }) => target.id)).toEqual(targets.map(target => target.id))
})
it('classifies a lost creation response as mutation uncertainty without guessing an owned target', async () => {
  const closed: string[] = []
  let creates = 0, lists = 0
  const endpoint = await server((req, res) => {
    if (req.url === '/json/list') { lists++; json(res, [page('source')]) }
    else if (req.method === 'PUT') { creates++; res.destroy() }
    else { closed.push(req.url!); res.end('closed') }
  })
  await expect(createOwnedSidecarReplacement(endpoint, 'source')).rejects.toBeInstanceOf(BrowserMutationUncertainError)
  expect(creates).toBe(1)
  expect(lists).toBe(1)
  expect(closed).toEqual([])
})
