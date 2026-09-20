import { describe, expect, it } from 'vitest'
import {
  ProtocolError,
  formatEnvelope,
  mintTaskId,
  parseEnvelope,
  validateTaskId,
} from '../src/protocol/envelope.ts'
import { StateMachine } from '../src/protocol/state-machine.ts'

describe('envelope format', () => {
  it('round-trips INIT', () => {
    const text = formatEnvelope({
      state: 'INIT',
      sender: 'dsh',
      taskId: 'd2c_ab12cd',
      iteration: 0,
      sections: { GOAL: 'Implement dark mode.', INSTRUCTION: 'Inspect the connected workspace through MCP.' },
    })
    expect(text).toContain('[D2C]')
    expect(text).toContain('STATE: INIT')
    expect(text).toContain('VERSION: 1')
    const parsed = parseEnvelope(text, { sender: 'dsh' })
    expect(parsed.state).toBe('INIT')
    expect(parsed.taskId).toBe('d2c_ab12cd')
    expect(parsed.iteration).toBe(0)
    expect(parsed.sections.get('GOAL')).toBe('Implement dark mode.')
  })

  it('round-trips PLAN from chatgpt with IN_REPLY_TO', () => {
    const text = formatEnvelope({
      state: 'PLAN',
      sender: 'chatgpt',
      taskId: 'd2c_ab12cd',
      iteration: 1,
      inReplyTo: 0,
      sections: {
        ACTIONS: '1. Read src/index.ts\n2. Add dark-mode tokens',
        SUCCESS_CRITERIA: 'Theme toggles without reload.',
      },
    })
    const parsed = parseEnvelope(text, { sender: 'chatgpt' })
    expect(parsed.state).toBe('PLAN')
    expect(parsed.inReplyTo).toBe(0)
    expect(parsed.sections.get('ACTIONS')).toContain('dark-mode tokens')
  })

  it('rejects wrong sender/state pairs', () => {
    expect(() => formatEnvelope({ state: 'PLAN', sender: 'dsh', taskId: 'd2c_ab12cd', iteration: 0 }))
      .toThrow(ProtocolError)
    const plan = formatEnvelope({ state: 'PLAN', sender: 'chatgpt', taskId: 'd2c_ab12cd', iteration: 1 })
    expect(() => parseEnvelope(plan, { sender: 'dsh' })).toThrow(/cannot send state PLAN/)
  })

  it('rejects bad task ids and negative iterations', () => {
    expect(() => validateTaskId('not-a-task')).toThrow(ProtocolError)
    expect(() => formatEnvelope({ state: 'INIT', sender: 'dsh', taskId: 'd2c_ab12', iteration: -1 }))
      .toThrow(/bad-iteration/)
  })

  it('rejects version mismatch', () => {
    const forged = '[D2C]\nVERSION: 99\nSTATE: PLAN\nTASK_ID: d2c_ab12cd\nITERATION: 1'
    expect(() => parseEnvelope(forged, { sender: 'chatgpt' })).toThrow(/version/)
  })

  it('rejects missing [D2C] marker', () => {
    expect(() => parseEnvelope('I think we should proceed. PLAN: do things.', { sender: 'chatgpt' }))
      .toThrow(/no \[D2C\] envelope/)
  })

  it('tolerates conversational prose around the envelope', () => {
    const wrapped = 'Sure, here is my plan.\n\n'
      + formatEnvelope({
        state: 'PLAN',
        sender: 'chatgpt',
        taskId: 'd2c_ab12cd',
        iteration: 1,
        sections: { ACTIONS: '1. Do the thing' },
      })
      + '\n\nLet me know when execution is done!'
    const parsed = parseEnvelope(wrapped, { sender: 'chatgpt' })
    expect(parsed.state).toBe('PLAN')
    expect(parsed.sections.get('ACTIONS')).toBe('1. Do the thing')
  })

  it('rejects oversized sections', () => {
    const huge = 'x'.repeat(5000)
    expect(() => formatEnvelope({
      state: 'INIT', sender: 'dsh', taskId: 'd2c_ab12cd', iteration: 0, sections: { GOAL: huge },
    })).toThrow(/exceeds/)
  })

  it('mints well-formed task ids', () => {
    const id = mintTaskId()
    expect(() => validateTaskId(id)).not.toThrow()
  })
})

describe('state machine', () => {
  const machine = new StateMachine()

  function planReply(taskId: string, iteration: number, inReplyTo = iteration - 1) {
    return parseEnvelope(formatEnvelope({
      state: 'PLAN', sender: 'chatgpt', taskId, iteration, inReplyTo,
      sections: { ACTIONS: 'proceed' },
    }), { sender: 'chatgpt' })
  }

  function doneReply(taskId: string, iteration: number, inReplyTo?: number) {
    return parseEnvelope(formatEnvelope({
      state: 'DONE', sender: 'chatgpt', taskId, iteration,
      ...(inReplyTo !== undefined ? { inReplyTo } : {}),
      sections: { SUMMARY: 'all good' },
    }), { sender: 'chatgpt' })
  }

  it('walks INIT → PLAN → EXECUTED → DONE', () => {
    const taskId = mintTaskId()
    machine.startTask(taskId, 'add a feature')
    const afterPlan = machine.applyReply(planReply(taskId, 1))
    expect(afterPlan.state).toBe('planned')
    machine.applyLocal(taskId, 'executing')
    machine.advanceIteration(taskId) // EXECUTED sent with iteration 2
    machine.applyLocal(taskId, 'executed')
    expect(machine.get(taskId)?.waitingFor).toBe('chatgpt-review')
    const afterDone = machine.applyReply(doneReply(taskId, 2, 2))
    expect(afterDone.state).toBe('done')
  })

  it('rejects stale-iteration replies', () => {
    const taskId = mintTaskId()
    machine.startTask(taskId, 'g')
    machine.applyReply(planReply(taskId, 1))
    machine.applyLocal(taskId, 'executing')
    machine.advanceIteration(taskId)
    machine.applyLocal(taskId, 'executed')
    // Reply referencing the OLD iteration must be rejected.
    expect(() => machine.applyReply(doneReply(taskId, 1))).toThrow(/stale-iteration/)
  })

  it('rejects replies when not waiting', () => {
    const taskId = mintTaskId()
    machine.startTask(taskId, 'g')
    const record = machine.get(taskId)
    expect(record?.waitingFor).toBe('chatgpt-plan')
    // A DONE before any plan is not a satisfying reply for chatgpt-plan.
    expect(() => machine.applyReply(doneReply(taskId, 1))).toThrow(/stale-reply/)
  })

  it('rejects unknown-task replies', () => {
    expect(() => machine.applyReply(planReply('d2c_zzzzzz', 1))).toThrow(/unknown-task/)
  })

  it('rejects duplicate tasks and illegal local transitions', () => {
    const taskId = mintTaskId()
    machine.startTask(taskId, 'g')
    expect(() => machine.startTask(taskId, 'g')).toThrow(/duplicate-task/)
    expect(() => machine.applyLocal(taskId, 'done')).toThrow(/illegal-transition/)
  })
})
