/**
 * D2C protocol: versioned control-plane envelopes exchanged between the DSH
 * coordinator (GLM side) and ChatGPT Web. Adapted from codex-with-chatgpt's
 * [C2C] envelope (MIT, see THIRD_PARTY_NOTICES.md) with additions upstream
 * lacks: a strict parser, PROTOCOL_VERSION, IN_REPLY_TO echo, and machine
 * validation of iteration/ids instead of skill discipline.
 * @module protocol
 */

/** Current protocol version; envelopes carry it and parsers reject mismatches. */
export const PROTOCOL_VERSION = 1

/** Sender of an envelope. */
export type EnvelopeSender = 'dsh' | 'chatgpt'

/** Envelope states. INIT/EXECUTED/ERROR originate from DSH; PLAN/DONE originate from ChatGPT; BLOCKED/ERROR from either. */
export type EnvelopeState =
  | 'INIT'
  | 'PLAN'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'REVIEW_REQUEST'
  | 'DONE'
  | 'BLOCKED'
  | 'ERROR'
  | 'HANDOFF'

/** States each side may send. */
const SENDER_STATES: Record<EnvelopeSender, readonly EnvelopeState[]> = {
  dsh: ['INIT', 'EXECUTING', 'EXECUTED', 'REVIEW_REQUEST', 'HANDOFF', 'ERROR', 'BLOCKED'],
  chatgpt: ['PLAN', 'DONE', 'BLOCKED', 'ERROR'],
}

/** Free-text sections an envelope may carry, keyed by state (order matters for output). */
const STATE_SECTIONS: Partial<Record<EnvelopeState, readonly string[]>> = {
  INIT: ['GOAL', 'INSTRUCTION'],
  PLAN: ['GOAL', 'RATIONALE', 'ACTIONS', 'FILES_LIKELY_INVOLVED', 'TESTS', 'SUCCESS_CRITERIA'],
  EXECUTING: ['NOTE'],
  EXECUTED: ['RESULT', 'CHANGED_FILES', 'TESTS', 'NOTE'],
  REVIEW_REQUEST: ['FOCUS'],
  DONE: ['SUMMARY'],
  BLOCKED: ['REASON', 'NEEDS'],
  ERROR: ['REASON'],
  HANDOFF: ['ORIGINAL_GOAL', 'PROGRESS', 'CURRENT_STATE', 'KNOWN_ISSUES', 'NEXT_EXPECTED_STEP'],
}

/** Hard cap on the full envelope text; control messages stay tiny on purpose. */
export const MAX_ENVELOPE_BYTES = 8192

/** Hard cap per section body. */
export const MAX_SECTION_BYTES = 4096

/** Hard cap per header value. */
export const MAX_HEADER_BYTES = 512

/** Error thrown for any envelope format or semantic violation. */
export class ProtocolError extends Error {
  /** Machine-readable reason (stable vocabulary for tests and coordinator logic). */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(`${reason}: ${message}`)
    this.name = 'ProtocolError'
    this.reason = reason
  }
}

/** One parsed control-plane envelope. */
export interface Envelope {
  /** Protocol version the envelope declares (must equal PROTOCOL_VERSION). */
  version: number
  /** Machine state. */
  state: EnvelopeState
  /** Task identifier shared across the whole task lifecycle. */
  taskId: string
  /** Monotonic iteration counter (0-based; INIT uses 0). */
  iteration: number
  /** For replies: the ITERATION of the envelope being answered. Absent otherwise. */
  inReplyTo?: number
  /** Parsed header values beyond the canonical five (e.g. HEAD). */
  headers: Map<string, string>
  /** Parsed section bodies keyed by section name. */
  sections: Map<string, string>
}

/** Parse-time options. */
export interface ParseOptions {
  /** Expected sender; wrong-state envelopes are rejected with `wrong-sender`. */
  sender: EnvelopeSender
}

/** Canonical header names and their value constraints. */
const HEADER_LINE = /^([A-Z][A-Z0-9_]*):[ \t]?(.*)$/

/** Serialize an envelope to its wire form. */
export function formatEnvelope(input: {
  state: EnvelopeState
  sender: EnvelopeSender
  taskId: string
  iteration: number
  inReplyTo?: number
  headers?: Record<string, string>
  sections?: Record<string, string>
}): string {
  const { state, sender, taskId, iteration } = input
  if (!SENDER_STATES[sender].includes(state)) {
    throw new ProtocolError('wrong-sender', `state ${state} cannot be sent by ${sender}`)
  }
  validateTaskId(taskId)
  if (!Number.isInteger(iteration) || iteration < 0) {
    throw new ProtocolError('bad-iteration', `iteration must be a non-negative integer, got ${iteration}`)
  }
  const allowed = STATE_SECTIONS[state] ?? []
  const lines: string[] = [
    '[D2C]',
    `VERSION: ${PROTOCOL_VERSION}`,
    `STATE: ${state}`,
    `TASK_ID: ${taskId}`,
    `ITERATION: ${iteration}`,
  ]
  if (input.inReplyTo !== undefined) {
    if (!Number.isInteger(input.inReplyTo) || input.inReplyTo < 0) {
      throw new ProtocolError('bad-iteration', `inReplyTo must be a non-negative integer, got ${input.inReplyTo}`)
    }
    lines.push(`IN_REPLY_TO: ${input.inReplyTo}`)
  }
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new ProtocolError('bad-header', `invalid header name ${key}`)
    if (value.includes('\n') || value.length > MAX_HEADER_BYTES) {
      throw new ProtocolError('bad-header', `header ${key} too long or multiline`)
    }
    lines.push(`${key}: ${value}`)
  }
  for (const name of allowed) {
    const body = input.sections?.[name]
    if (body === undefined || body.trim() === '') continue
    if (body.length > MAX_SECTION_BYTES) {
      throw new ProtocolError('section-too-large', `section ${name} exceeds ${MAX_SECTION_BYTES} bytes`)
    }
    lines.push('', `${name}:`, body.trimEnd())
  }
  const text = lines.join('\n')
  if (Buffer.byteLength(text, 'utf8') > MAX_ENVELOPE_BYTES) {
    throw new ProtocolError('envelope-too-large', `envelope exceeds ${MAX_ENVELOPE_BYTES} bytes`)
  }
  return text
}

/** Validate a task id: short opaque token, no whitespace. */
export function validateTaskId(taskId: string): void {
  if (!/^d2c_[0-9a-z]{4,32}$/.test(taskId)) {
    throw new ProtocolError('bad-task-id', `task id must match d2c_[0-9a-z]{4,32}, got ${JSON.stringify(taskId)}`)
  }
}

/** Mint a fresh task id. */
export function mintTaskId(): string {
  const hex = Array.from({ length: 6 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `d2c_${hex}`
}

/**
 * Parse an envelope from assistant-visible text. Tolerates surrounding prose
 * (ChatGPT replies are conversational) by locating the FIRST [D2C] marker and
 * reading until the last recognized section body, but the envelope itself is
 * parsed strictly.
 */
export function parseEnvelope(text: string, options: ParseOptions): Envelope {
  const marker = text.indexOf('[D2C]')
  if (marker < 0) throw new ProtocolError('no-marker', 'no [D2C] envelope found in reply')
  const body = text.slice(marker + 5).replace(/^\r?\n/, '')
  const lines = body.split(/\r?\n/)

  const headers = new Map<string, string>()
  const sections = new Map<string, string>()
  let currentSection: string | undefined
  let sectionLines: string[] = []
  const headerOrder: string[] = []

  const flushSection = (): void => {
    if (currentSection !== undefined) {
      sections.set(currentSection, sectionLines.join('\n').trimEnd())
      currentSection = undefined
      sectionLines = []
    }
  }

  let lastWasBlank = false
  for (const line of lines) {
    if (line.trim() === '') {
      lastWasBlank = true
      continue
    }
    const match = HEADER_LINE.exec(line)
    const isHeader = match !== null && match[1] !== undefined && match[2] !== undefined
    if (!isHeader && lastWasBlank && (currentSection !== undefined || headers.size > 0)) {
      // Blank line followed by prose ends the envelope; the rest of the reply
      // is conversation, not protocol.
      break
    }
    lastWasBlank = false
    if (currentSection !== undefined) {
      if (isHeader) {
        flushSection()
      } else {
        sectionLines.push(line)
        continue
      }
    }
    if (match === null || match[1] === undefined || match[2] === undefined) {
      throw new ProtocolError('bad-line', `unrecognized line in envelope: ${JSON.stringify(line.slice(0, 80))}`)
    }
    const name = match[1]!
    const value = match[2]!
    if (value === '') {
      // Empty-value NAME: opens a section body; the name is validated
      // against the state's section vocabulary once STATE is known.
      currentSection = name
      sectionLines = []
      continue
    }
    headerOrder.push(name)
    headers.set(name, value)
  }
  flushSection()

  // Required canonical headers.
  const version = parseHeaderInt(headers, 'VERSION')
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError('version-mismatch', `envelope version ${version} != protocol version ${PROTOCOL_VERSION}`)
  }
  const stateRaw = requireHeader(headers, 'STATE')
  if (!isEnvelopeState(stateRaw)) {
    throw new ProtocolError('bad-state', `unknown STATE ${stateRaw}`)
  }
  const state: EnvelopeState = stateRaw
  if (!SENDER_STATES[options.sender].includes(state)) {
    throw new ProtocolError('wrong-sender', `${options.sender} cannot send state ${state}`)
  }
  const taskId = requireHeader(headers, 'TASK_ID')
  validateTaskId(taskId)
  const iteration = parseHeaderInt(headers, 'ITERATION')
  const inReplyToRaw = headers.get('IN_REPLY_TO')
  const inReplyTo = inReplyToRaw === undefined ? undefined : parseHeaderInt(headers, 'IN_REPLY_TO')

  // Validate declared sections against the state's vocabulary: a section name
  // must be one of the state's allowed sections (extension headers were folded
  // into headerOrder only when they carried a value).
  const allowedSections = STATE_SECTIONS[state] ?? []
  for (const name of sections.keys()) {
    if (!allowedSections.includes(name)) {
      throw new ProtocolError('bad-section', `section ${name} is not allowed in state ${state}`)
    }
  }

  return {
    version,
    state,
    taskId,
    iteration,
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    headers,
    sections,
  }
}

/** Whether a raw string is a known envelope state. */
function isEnvelopeState(value: string): value is EnvelopeState {
  return ['INIT', 'PLAN', 'EXECUTING', 'EXECUTED', 'REVIEW_REQUEST', 'DONE', 'BLOCKED', 'ERROR', 'HANDOFF'].includes(value)
}

/** Require one header value. */
function requireHeader(headers: Map<string, string>, name: string): string {
  const value = headers.get(name)
  if (value === undefined || value === '') {
    throw new ProtocolError('missing-header', `missing required header ${name}`)
  }
  if (value.length > MAX_HEADER_BYTES) {
    throw new ProtocolError('bad-header', `header ${name} too long`)
  }
  return value
}

/** Parse one integer header with validation. */
function parseHeaderInt(headers: Map<string, string>, name: string): number {
  const raw = requireHeader(headers, name)
  if (!/^\d+$/.test(raw)) {
    throw new ProtocolError('bad-header', `header ${name} must be a non-negative integer, got ${JSON.stringify(raw)}`)
  }
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value > 1_000_000) {
    throw new ProtocolError('bad-header', `header ${name} out of range`)
  }
  return value
}
