import { describe, expect, it } from 'vitest'
import { formatEnvelope, parseEnvelope } from '../src/protocol/envelope.ts'

const plan = formatEnvelope({ state: 'PLAN', sender: 'chatgpt', taskId: 'd2c_ab12cd', iteration: 1, inReplyTo: 0 })

describe('unambiguous protocol fields', () => {
  it.each(['VERSION: 1', 'STATE: PLAN', 'TASK_ID: d2c_ab12cd', 'ITERATION: 1', 'IN_REPLY_TO: 0', 'WORKSPACE_ID: workspace'])('rejects repeated %s', field => {
    const text = field.startsWith('WORKSPACE_ID') ? `${plan}\n${field}\n${field}` : `${plan}\n${field}`
    expect(() => parseEnvelope(text, { sender: 'chatgpt' })).toThrow('duplicate-header')
  })

  it('rejects repeated sections', () => {
    expect(() => parseEnvelope(`${plan}\n\nACTIONS:\nfirst\n\nACTIONS:\nsecond`, { sender: 'chatgpt' })).toThrow('duplicate-section')
  })

  it.each(['VERSION', 'STATE', 'TASK_ID', 'ITERATION', 'IN_REPLY_TO'])('refuses canonical header overrides through %s', name => {
    expect(() => formatEnvelope({ state: 'PLAN', sender: 'chatgpt', taskId: 'd2c_ab12cd', iteration: 1, headers: { [name]: '2' } })).toThrow('duplicate-header')
  })
})
