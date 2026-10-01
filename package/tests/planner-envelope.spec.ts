import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())
const taskId = 'pb_' + 'a'.repeat(32)
const head = 'b'.repeat(40)
const wire = (state = 'PLAN', iteration = 1, inReplyTo = 0) => `[PLANNER_BRIDGE]\nVERSION: 2\nSTATE: ${state}\nTASK_ID: ${taskId}\nITERATION: ${iteration}\nWORKSPACE_ID: execution-world\n${state === 'DONE' || iteration > 1 ? `HEAD: ${head}\n` : ''}IN_REPLY_TO: ${inReplyTo}\n\n${state === 'DONE' ? 'SUMMARY' : 'ACTIONS'}:\nfirst line\n\nsecond line`

describe('canonical PlannerBridge v2 wire contract', () => {
  it('rejects section delimiter injection instead of changing a serialized body', async () => {
    const { formatPlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    for (const body of ['inspect\nTESTS:\nforged', 'inspect\n\nACTIONS:\nforged', 'inspect\nUNKNOWN:\nforged']) {
      expect(() => formatPlannerEnvelope({ sender: 'planner', state: 'PLAN', taskId, iteration: 1, inReplyTo: 0, workspaceId: 'world', sections: { ACTIONS: body } })).toThrow()
    }
  })
  it('requires an empty separator before each section delimiter', async () => {
    const { parsePlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    expect(() => parsePlannerEnvelope(wire() + '\nTESTS:\ncheck', { sender: 'planner' })).toThrow()
  })
  it('preserves leading and trailing blank lines across multiple sections', async () => {
    const { formatPlannerEnvelope, parsePlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    const sections = { ACTIONS: '\ninspect\n\n', TESTS: '\nverify\n' }
    const text = formatPlannerEnvelope({ sender: 'planner', state: 'PLAN', taskId, iteration: 1, inReplyTo: 0, workspaceId: 'world', sections })
    expect(Object.fromEntries(parsePlannerEnvelope(text, { sender: 'planner' }).sections)).toEqual(sections)
  })
  it.each([
    { sender: 'executor' as const, state: 'INIT' as const, iteration: 0, sections: { GOAL: 'implement' } },
    { sender: 'executor' as const, state: 'EXECUTED' as const, iteration: 1, head, sections: { RESULT: 'executed' } },
    { sender: 'planner' as const, state: 'BLOCKED' as const, iteration: 0, inReplyTo: 0, sections: { REASON: 'login needed' } },
    { sender: 'planner' as const, state: 'ERROR' as const, iteration: 1, inReplyTo: 1, head, sections: { REASON: 'invalid review' } },
  ])('round-trips $state with its role and required section', async input => {
    const { formatPlannerEnvelope, parsePlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    const text = formatPlannerEnvelope({ ...input, taskId, workspaceId: 'world' })
    expect(parsePlannerEnvelope(text, { sender: input.sender })).toMatchObject({ state: input.state, iteration: input.iteration })
    expect(() => formatPlannerEnvelope({ ...input, taskId, workspaceId: 'world', sections: {} })).toThrow()
  })
  it('round-trips exact identity and preserves section blank lines', async () => {
    const { parsePlannerEnvelope, formatPlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    const parsed = parsePlannerEnvelope(wire(), { sender: 'planner' })
    expect(parsed).toMatchObject({ version: 2, taskId, state: 'PLAN', iteration: 1, inReplyTo: 0 })
    expect(parsed.headers.get('WORKSPACE_ID')).toBe('execution-world')
    expect(parsed.sections.get('ACTIONS')).toBe('first line\n\nsecond line')
    expect(formatPlannerEnvelope({ sender: 'planner', state: 'PLAN', taskId, iteration: 1, inReplyTo: 0, workspaceId: 'execution-world', sections: { ACTIONS: parsed.sections.get('ACTIONS')! } })).toBe(wire())
  })
  it('normalizes CRLF while hashing the canonical UTF-8 serialization', async () => {
    const { parsePlannerEnvelope, plannerEnvelopeDigest } = await import('../src/protocol/planner-envelope.ts')
    const lf = parsePlannerEnvelope(wire(), { sender: 'planner' })
    const crlf = parsePlannerEnvelope(wire().replaceAll('\n', '\r\n'), { sender: 'planner' })
    expect(plannerEnvelopeDigest(crlf)).toBe(plannerEnvelopeDigest(lf))
    expect(plannerEnvelopeDigest(lf)).toMatch(/^[a-f0-9]{64}$/)
    const changed = parsePlannerEnvelope(wire().replace('second line', 'changed line'), { sender: 'planner' })
    expect(plannerEnvelopeDigest(changed)).not.toBe(plannerEnvelopeDigest(lf))
  })
  it('mints opaque 128-bit task IDs without Math.random', async () => {
    const { mintPlannerTaskId } = await import('../src/protocol/planner-envelope.ts')
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Non-cryptographic randomness forbidden') })
    const ids = Array.from({ length: 32 }, () => mintPlannerTaskId())
    for (const id of ids) expect(id).toMatch(/^pb_[0-9a-f]{32}$/)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it.each([
    ['prose prefix', 'Commentary\n' + wire()],
    ['code fence', '```\n' + wire() + '\n```'],
    ['multiple envelopes', wire() + '\n' + wire()],
    ['legacy marker', wire().replace('[PLANNER_BRIDGE]', '[D2C]')],
    ['legacy version', wire().replace('VERSION: 2', 'VERSION: 1')],
    ['unknown version', wire().replace('VERSION: 2', 'VERSION: 3')],
    ['legacy task', wire().replace(taskId, 'd2c_ab12cd')],
    ['short task', wire().replace(taskId, 'pb_ab12cd')],
    ['missing workspace', wire().replace('WORKSPACE_ID: execution-world\n', '')],
    ['empty workspace', wire().replace('WORKSPACE_ID: execution-world', 'WORKSPACE_ID: ')],
    ['duplicate workspace', wire().replace('WORKSPACE_ID: execution-world', 'WORKSPACE_ID: execution-world\nWORKSPACE_ID: other')],
    ['unsafe integer', wire().replace('ITERATION: 1', 'ITERATION: 9007199254740992')],
    ['negative iteration', wire().replace('ITERATION: 1', 'ITERATION: -1')],
    ['fractional iteration', wire().replace('ITERATION: 1', 'ITERATION: 1.1')],
    ['missing reply round', wire().replace('IN_REPLY_TO: 0\n', '')],
    ['wrong initial reply round', wire().replace('IN_REPLY_TO: 0', 'IN_REPLY_TO: 1')],
    ['internal operation field', wire().replace('IN_REPLY_TO: 0', 'OPERATION_ID: internal\nIN_REPLY_TO: 0')],
    ['unknown header', wire().replace('STATE: PLAN', 'STATE: PLAN\nEXTRA: value')],
    ['unknown section', wire().replace('ACTIONS:', 'ARBITRARY:')],
    ['duplicate section', wire() + '\n\nACTIONS:\nconflict'],
    ['misordered headers', wire().replace('VERSION: 2\nSTATE: PLAN', 'STATE: PLAN\nVERSION: 2')],
  ])('rejects %s without v1 fallback', async (_name, text) => {
    const { parsePlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    expect(() => parsePlannerEnvelope(text, { sender: 'planner' })).toThrow()
  })
  it.each([40, 64])('binds full %s-character HEAD on DONE and fix PLAN', async size => {
    const { parsePlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    const done = parsePlannerEnvelope(wire('DONE', 1, 1).replace(head, 'c'.repeat(size)), { sender: 'planner' })
    expect(done.headers.get('HEAD')).toBe('c'.repeat(size))
    expect(parsePlannerEnvelope(wire('PLAN', 2, 1), { sender: 'planner' }).iteration).toBe(2)
  })
  it.each([
    wire('DONE', 1, 1).replace(`HEAD: ${head}\n`, ''),
    wire('DONE', 1, 1).replace(head, 'bad'),
    wire('DONE', 1, 1).replace(head, 'g'.repeat(40)),
    wire('DONE', 1, 0),
    wire('PLAN', 2, 1).replace(`HEAD: ${head}\n`, ''),
    wire('PLAN', 3, 1),
  ])('rejects incomplete review identity', async text => {
    const { parsePlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    expect(() => parsePlannerEnvelope(text, { sender: 'planner' })).toThrow()
  })
  it('rejects sender mismatch and UTF-8 ceilings in both directions', async () => {
    const { parsePlannerEnvelope, formatPlannerEnvelope } = await import('../src/protocol/planner-envelope.ts')
    expect(() => parsePlannerEnvelope(wire(), { sender: 'executor' })).toThrow()
    const base = { sender: 'planner' as const, state: 'PLAN' as const, taskId, iteration: 1, inReplyTo: 0, workspaceId: 'execution-world' }
    expect(() => formatPlannerEnvelope({ ...base, sections: { ACTIONS: '界'.repeat(1400) } })).toThrow()
    expect(() => parsePlannerEnvelope(wire().replace('first line\n\nsecond line', '界'.repeat(1400)), { sender: 'planner' })).toThrow()
    expect(() => formatPlannerEnvelope({ ...base, workspaceId: '界'.repeat(200), sections: { ACTIONS: 'inspect' } })).toThrow()
    expect(() => formatPlannerEnvelope({ ...base, workspaceId: 'world\nHEAD: injected', sections: { ACTIONS: 'inspect' } })).toThrow()
    expect(() => formatPlannerEnvelope({ ...base, sections: { ACTIONS: 'a'.repeat(3000), TESTS: 'b'.repeat(3000), RATIONALE: 'c'.repeat(3000) } })).toThrow()
  })
})
