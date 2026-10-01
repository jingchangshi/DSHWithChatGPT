import { createHash, randomBytes } from 'node:crypto'
import { ProtocolError } from './envelope.ts'

export type PlannerSender = 'executor' | 'planner'
export type PlannerEnvelopeState = 'INIT' | 'PLAN' | 'EXECUTED' | 'DONE' | 'BLOCKED' | 'ERROR'
export interface PlannerEnvelope {
  version: 2
  sender: PlannerSender
  state: PlannerEnvelopeState
  taskId: string
  iteration: number
  inReplyTo?: number
  headers: Map<string, string>
  sections: Map<string, string>
}
export interface PlannerEnvelopeInput {
  sender: PlannerSender
  state: PlannerEnvelopeState
  taskId: string
  iteration: number
  workspaceId: string
  head?: string
  inReplyTo?: number
  sections?: Record<string, string>
}
const MARKER = '[PLANNER_BRIDGE]'
const MAX_ENVELOPE = 8192
const MAX_SECTION = 4096
const MAX_HEADER = 512
const HEADER_ORDER = ['VERSION', 'STATE', 'TASK_ID', 'ITERATION', 'WORKSPACE_ID', 'HEAD', 'IN_REPLY_TO']
const SECTIONS: Record<PlannerEnvelopeState, readonly string[]> = {
  INIT: ['GOAL', 'INSTRUCTION'],
  PLAN: ['GOAL', 'RATIONALE', 'ACTIONS', 'FILES_LIKELY_INVOLVED', 'TESTS', 'SUCCESS_CRITERIA'],
  EXECUTED: ['RESULT', 'CHANGED_FILES', 'TESTS', 'NOTE'],
  DONE: ['SUMMARY'], BLOCKED: ['REASON', 'NEEDS'], ERROR: ['REASON'],
}
const REQUIRED_SECTION: Record<PlannerEnvelopeState, string> = {
  INIT: 'GOAL', PLAN: 'ACTIONS', EXECUTED: 'RESULT', DONE: 'SUMMARY', BLOCKED: 'REASON', ERROR: 'REASON',
}
function fail(reason: string): never { throw new ProtocolError(reason, 'Invalid canonical PlannerBridge envelope') }
function boundedHeader(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || /[\x00-\x1f\x7f]/.test(value) || Buffer.byteLength(value, 'utf8') > MAX_HEADER) fail('bad-header')
}
function integer(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('bad-iteration')
}
function decimal(value: string | undefined): number {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) fail('bad-iteration')
  const number = Number(value)
  integer(number)
  return number
}
function validate(input: PlannerEnvelopeInput): void {
  if (input.sender !== 'executor' && input.sender !== 'planner') fail('wrong-sender')
  if (!Object.hasOwn(SECTIONS, input.state)) fail('bad-state')
  if ((['INIT', 'EXECUTED'].includes(input.state) && input.sender !== 'executor') || (['PLAN', 'DONE'].includes(input.state) && input.sender !== 'planner')) fail('wrong-sender')
  if (typeof input.taskId !== 'string' || !/^pb_[0-9a-f]{32,64}$/.test(input.taskId)) fail('bad-task-id')
  boundedHeader(input.workspaceId)
  integer(input.iteration)
  if (input.inReplyTo !== undefined) integer(input.inReplyTo)
  if (input.head !== undefined && !/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(input.head)) fail('bad-head')
  if (input.state === 'INIT' && (input.iteration !== 0 || input.inReplyTo !== undefined || input.head !== undefined)) fail('bad-round')
  if (input.state === 'PLAN' && (input.iteration < 1 || input.inReplyTo !== input.iteration - 1)) fail('bad-round')
  if (input.state === 'EXECUTED' && (input.iteration < 1 || (input.inReplyTo !== undefined && input.inReplyTo !== input.iteration))) fail('bad-round')
  if (input.state === 'DONE' && (input.iteration < 1 || input.inReplyTo !== input.iteration)) fail('bad-round')
  if ((input.state === 'BLOCKED' || input.state === 'ERROR') && ((input.sender === 'planner' && input.inReplyTo !== input.iteration) || (input.inReplyTo !== undefined && input.inReplyTo !== input.iteration))) fail('bad-round')
  if ((input.state === 'EXECUTED' || input.state === 'DONE' || (input.sender === 'planner' && (input.inReplyTo ?? 0) > 0)) && input.head === undefined) fail('missing-head')
  const sections = input.sections ?? {}
  for (const [key, body] of Object.entries(sections)) {
    if (!SECTIONS[input.state].includes(key)) fail('unknown-section')
    if (typeof body !== 'string' || body.trim() === '' || body.includes('\r') || body.includes(MARKER) || /^[A-Z][A-Z0-9_]*:$/m.test(body) || Buffer.byteLength(body, 'utf8') > MAX_SECTION) fail('bad-section')
  }
  if (!Object.hasOwn(sections, REQUIRED_SECTION[input.state])) fail('missing-section')
}

/** New task identity; released v1 IDs are minted only by their compatibility API. */
export function mintPlannerTaskId(): string { return 'pb_' + randomBytes(16).toString('hex') }

/** Serialize only v2 model fields. Delivery/request identity has no wire field. */
export function formatPlannerEnvelope(input: PlannerEnvelopeInput): string {
  validate(input)
  const lines = [MARKER, 'VERSION: 2', `STATE: ${input.state}`, `TASK_ID: ${input.taskId}`, `ITERATION: ${input.iteration}`, `WORKSPACE_ID: ${input.workspaceId}`]
  if (input.head !== undefined) lines.push(`HEAD: ${input.head}`)
  if (input.inReplyTo !== undefined) lines.push(`IN_REPLY_TO: ${input.inReplyTo}`)
  for (const section of SECTIONS[input.state]) {
    const body = input.sections?.[section]
    if (body !== undefined) lines.push('', `${section}:`, body)
  }
  const text = lines.join('\n')
  if (Buffer.byteLength(text, 'utf8') > MAX_ENVELOPE) fail('envelope-too-large')
  return text
}

/** No conversational extraction, last-marker choice or v1 fallback. */
export function parsePlannerEnvelope(text: string, options: { sender: PlannerSender }): PlannerEnvelope {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_ENVELOPE) fail('envelope-too-large')
  const normalized = text.replace(/\r\n/g, '\n')
  if (normalized.includes('\r') || !normalized.startsWith(MARKER + '\n') || normalized.split(MARKER).length !== 2) fail('bad-marker')
  const lines = normalized.split('\n')
  const headers = new Map<string, string>()
  let previous = -1
  let index = 1
  for (; index < lines.length && lines[index] !== ''; index++) {
    const match = /^([A-Z][A-Z0-9_]*): (.*)$/.exec(lines[index]!)
    if (!match) fail('bad-header')
    const key = match[1]!, value = match[2]!
    const position = HEADER_ORDER.indexOf(key)
    if (position < 0 || position <= previous || headers.has(key)) fail('header-order')
    boundedHeader(value)
    headers.set(key, value)
    previous = position
  }
  if (headers.get('VERSION') !== '2') fail('bad-version')
  for (const required of HEADER_ORDER.slice(0, 5)) if (!headers.has(required)) fail('missing-header')
  const sections = new Map<string, string>()
  let section: string | undefined
  let body: string[] = []
  function flush(separator: boolean) {
    if (section === undefined) return
    if (separator && body.at(-1) === '') body.pop()
    sections.set(section, body.join('\n'))
    body = []
  }
  for (index++; index < lines.length; index++) {
    const line = lines[index]!
    const match = /^([A-Z][A-Z0-9_]*):$/.exec(line)
    if (match) {
      if (lines[index - 1] !== '') fail('missing-section-separator')
      flush(true)
      section = match[1]!
      if (sections.has(section)) fail('duplicate-section')
    } else {
      if (section === undefined) fail('bad-section')
      body.push(line)
    }
  }
  flush(false)
  const input: PlannerEnvelopeInput = {
    sender: options.sender, state: headers.get('STATE') as PlannerEnvelopeState,
    taskId: headers.get('TASK_ID')!, iteration: decimal(headers.get('ITERATION')),
    workspaceId: headers.get('WORKSPACE_ID')!, head: headers.get('HEAD'),
    inReplyTo: headers.has('IN_REPLY_TO') ? decimal(headers.get('IN_REPLY_TO')) : undefined,
    sections: Object.fromEntries(sections),
  }
  // Validate parsed data with the same constraints as outgoing serialization.
  formatPlannerEnvelope(input)
  return { version: 2, sender: options.sender, state: input.state, taskId: input.taskId, iteration: input.iteration, ...(input.inReplyTo !== undefined ? { inReplyTo: input.inReplyTo } : {}), headers, sections }
}

/** Canonical serialization digest; not a credential and never authority. */
export function plannerEnvelopeDigest(envelope: PlannerEnvelope): string {
  if (envelope.version !== 2) fail('bad-version')
  return createHash('sha256').update(formatPlannerEnvelope({
    sender: envelope.sender, state: envelope.state, taskId: envelope.taskId,
    iteration: envelope.iteration, inReplyTo: envelope.inReplyTo,
    workspaceId: envelope.headers.get('WORKSPACE_ID')!, head: envelope.headers.get('HEAD'),
    sections: Object.fromEntries(envelope.sections),
  }), 'utf8').digest('hex')
}
