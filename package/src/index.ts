/**
 * dsh-with-chatgpt — persistent DeepSeek Harness plugin.
 *
 * ChatGPT thinks. DeepSeek Harness works.
 *
 * Host wiring: publishes the chatgptCoordinator service, registers the
 * four model-facing tools (chatgpt_plan / chatgpt_review / chatgpt_status /
 * chatgpt_reconnect), injects the collaboration section into the system
 * prompt, mounts the read-only MCP bridge, and persists task state through a
 * storage domain so tasks survive DSH restarts.
 * @module dsh-with-chatgpt
 */

import { join as joinPath } from 'node:path'
import { randomFillSync } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ChatGptCoordinator, CHATGPT_BOOT_PROMPT } from './orchestrator/index.ts'
import { CoordinatorState, type PersistedTask, type TaskState } from './orchestrator/state.ts'
import type { StateStore } from './orchestrator/state.ts'
import { ExecutionRecorder } from './execution/index.ts'
import { loadWorkspaceSpec, buildWorkspaceTools } from './bridge/index.ts'
import { startBridgeServer, type BridgeServer } from './bridge/index.ts'
import { BrowserStaleError, ChatGptLoggedOutError, type BrowserControl } from './browser/index.ts'
import { resolveContained } from './workspace/index.ts'
import { gitStatus } from './workspace/index.ts'

// ---------------------------------------------------------------- config

export interface Config {
  /** Loopback port for the read-only MCP bridge (0 = ephemeral). */
  bridgePort: number
  /** Reply wait timeout for ChatGPT rounds, ms. */
  replyTimeoutMs: number
  /** Browser control plane flavor. */
  browserMode: 'browser-harness-mcp'
}

/** Plugin config schema (zod; the host layer adapts it to its config surface). */
export const Config: z.ZodType<Config> = z.object({
  bridgePort: z.number().default(0),
  replyTimeoutMs: z.number().default(240_000),
  browserMode: z.enum(['browser-harness-mcp']).default('browser-harness-mcp'),
}) as unknown as z.ZodType<Config>

// ---------------------------------------------------------------- state

const taskRecordSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  state: z.enum(['awaiting-plan', 'planned', 'executing', 'executed', 'awaiting-review', 'done', 'blocked', 'error']),
  iteration: z.number(),
  waitingFor: z.enum(['none', 'chatgpt-plan', 'chatgpt-review', 'dsh-execution', 'user']),
  conversationId: z.string().nullable(),
  lastReviewedHead: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastError: z.string().nullable(),
})

const bindingSchema = z.object({
  workspaceRoot: z.string(),
  conversationId: z.string().nullable(),
  lastTaskId: z.string().nullable(),
  updatedAt: z.number(),
})

const indexSchema = z.object({ ids: z.array(z.string()) })

const d2cDomain = defineDomain({
  name: 'd2c_state',
  version: 1,
  tables: {
    tasks: domainTable(taskRecordSchema),
    bindings: domainTable(bindingSchema),
    index: domainTable(indexSchema),
  },
})

type D2cDomain = Domain<typeof d2cDomain>

/** StateStore backed by the Cordis storage domain (durable across restarts). */
class DomainStateStore implements StateStore {
  constructor(private readonly domain: D2cDomain) {}

  async get<T>(key: string): Promise<T | undefined> {
    const [table, ...rest] = key.split(':')
    const recordKey = rest.join(':')
    if (table === 'task') return this.domain.table('tasks').get(recordKey) as T | undefined
    if (table === 'workspace') return this.domain.table('bindings').get(recordKey) as T | undefined
    if (table === 'index') return this.domain.table('index').get(recordKey) as T | undefined
    return undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    const [table, ...rest] = key.split(':')
    const recordKey = rest.join(':')
    if (table === 'task') await this.domain.table('tasks').put(recordKey, value as PersistedTask)
    else if (table === 'workspace') await this.domain.table('bindings').put(recordKey, value as never)
    else if (table === 'index') await this.domain.table('index').put(recordKey, value as never)
  }

  async delete(key: string): Promise<void> {
    const [table, ...rest] = key.split(':')
    const recordKey = rest.join(':')
    if (table === 'task') await this.domain.table('tasks').delete(recordKey)
    else if (table === 'workspace') await this.domain.table('bindings').delete(recordKey)
    else if (table === 'index') await this.domain.table('index').delete(recordKey)
  }
}

/** Memory fallback until (or without) the storage domain. */
const memoryCoordinatorState = new CoordinatorState(((): StateStore => {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> { return map.get(key) as T | undefined },
    async put<T>(key: string, value: T): Promise<void> { map.set(key, value) },
    async delete(key: string): Promise<void> { map.delete(key) },
  }
})())

// ---------------------------------------------------------------- browser adapter

/**
 * BrowserControl over DSH Browser Harness MCP session tools. Tool calls go
 * through the session-gated mcp__browser-harness__ tools; semantic
 * selectors only. A persistent conversation is reused across iterations.
 */
class BrowserHarnessAdapter implements BrowserControl {
  private callSequence = 0

  constructor(
    private readonly ctx: Context,
    private readonly execAgent: { session: { header: { cwd: string } } } | undefined,
  ) {}

  private async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const tools = this.ctx.get('tools')
    if (tools === undefined) throw new Error('tools service unavailable for browser control')

    const controller = new AbortController()
    let rejectGuard: ((reason?: unknown) => void) | undefined
    const guard = new Promise<never>((_, reject) => { rejectGuard = reject })
    const timer = setTimeout(() => {
      controller.abort()
      rejectGuard?.(new Error('browser tool ' + tool + ' timed out after 90s'))
    }, 90_000)

    try {
      const outcome = await Promise.race([
        tools.execute({
          callId: ('d2c-browser-' + (++this.callSequence)) as never,
          name: 'mcp__browser-harness__' + tool,
          arguments: args,
          agent: this.execAgent as never,
          signal: controller.signal,
        } as never),
        guard,
      ]) as {
        isError: boolean
        value?: unknown
        error?: { message?: string }
        content?: Array<{ type?: string; text?: string }>
      }

      if (outcome.isError) {
        const detail = outcome.error?.message
          ?? outcome.content?.map(block => block.text ?? '').filter(Boolean).join('\n')
          ?? 'unknown Browser Harness failure'
        throw new Error(detail)
      }
      return unwrapMcpToolValue<T>(outcome.value)
    } finally {
      clearTimeout(timer)
    }
  }

  async ensureReady(): Promise<void> {
    const budget = [0, 500, 1500]
    let lastError: unknown
    for (const delay of budget) {
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      try {
        const info = await this.call<{ url?: string }>('browser_page_info', {})
        if (typeof info.url !== 'string' || !info.url.startsWith('https://chatgpt.com/')) {
          await this.call<unknown>('browser_goto', { url: 'https://chatgpt.com/' })
        }
        await this.call<unknown>('browser_wait_for_element', {
          selector: '#prompt-textarea',
          timeout: 10,
          visible: true,
        })
        return
      } catch (error) {
        lastError = error
      }
    }
    throw new Error('BROWSER_UNAVAILABLE: browser harness could not open ChatGPT: ' + String(lastError))
  }

  async openConversation(conversationId?: string): Promise<string> {
    if (conversationId !== undefined && conversationId !== '') {
      await this.call<unknown>('browser_goto', { url: 'https://chatgpt.com/c/' + conversationId })
      await this.call<unknown>('browser_wait_for_element', {
        selector: '#prompt-textarea',
        timeout: 10,
        visible: true,
      })
      return conversationId
    }
    await this.call<unknown>('browser_goto', { url: 'https://chatgpt.com/' })
    return ''
  }

  async sendControlMessage(text: string): Promise<void> {
    await this.call<unknown>('browser_wait_for_element', {
      selector: '#prompt-textarea',
      timeout: 10,
      visible: true,
    })
    await this.call<unknown>('browser_fill', { selector: '#prompt-textarea', text, clear_first: true })
    await this.call<unknown>('browser_press', { key: 'Enter' })
  }

  async currentConversationId(): Promise<string | undefined> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const info = await this.call<{ url?: string }>('browser_page_info', {})
      const match = typeof info.url === 'string' ? /\/c\/([^/?#]+)/.exec(info.url) : null
      if (match?.[1] !== undefined) return match[1]
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    return undefined
  }

  async waitForReply(timeoutMs: number): Promise<{ text: string; complete: boolean }> {
    const deadline = Date.now() + timeoutMs
    let last = ''
    let unchanged = 0
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2500))
      try {
        const snapshot = await this.call<{
          text?: string
          streaming?: boolean
          composer?: boolean
          loginGate?: boolean
        }>('browser_js', {
          expression: `(() => {
            const replies = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'))
            const latest = replies.length > 0 ? replies[replies.length - 1] : null
            const stop = document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"]')
            const composer = document.querySelector('#prompt-textarea')
            const loginGate = document.querySelector('a[href*="auth/login"], button[data-testid*="login"]')
            return {
              text: latest instanceof HTMLElement ? latest.innerText : '',
              streaming: Boolean(stop),
              composer: Boolean(composer),
              loginGate: Boolean(loginGate),
            }
          })()`,
        })
        if (snapshot.loginGate === true || (snapshot.composer === false && snapshot.text === '')) {
          throw new ChatGptLoggedOutError()
        }
        const text = snapshot.text ?? ''
        if (snapshot.streaming === true) {
          unchanged = 0
          last = text
          continue
        }
        unchanged = text === last && text.trim() !== '' ? unchanged + 1 : 0
        last = text
        if (unchanged >= 2) return { text, complete: true }
      } catch (error) {
        if (error instanceof ChatGptLoggedOutError) throw error
      }
    }
    throw new BrowserStaleError('no completed reply within timeout')
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const info = await this.call<{ url?: string; title?: string }>('browser_page_info', {})
      return {
        ok: typeof info.url === 'string' && info.url.startsWith('https://chatgpt.com/'),
        detail: typeof info.url === 'string' ? info.url : (info.title ?? 'browser reachable'),
      }
    } catch (error) {
      return { ok: false, detail: String(error) }
    }
  }

  async recover(): Promise<void> {
    await this.ensureReady()
  }
}

function unwrapMcpToolValue<T>(value: unknown): T {
  if (typeof value !== 'object' || value === null) return value as T
  const record = value as { structuredContent?: unknown; content?: Array<{ type?: string; text?: string }> }
  if (record.structuredContent !== undefined) return record.structuredContent as T
  const text = record.content?.find(block => block.type === 'text' && typeof block.text === 'string')?.text
  if (text === undefined) return value as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as T
  }
}

// ---------------------------------------------------------------- apply

export const name = 'dsh-with-chatgpt'

/** Services this plugin hard-requires (storage-domain is optional in v1). */
export const inject: string[] = []

export function apply(ctx: Context, config: Config) {
  const activate = async (): Promise<() => void> => {
    // ---- state: durable storage domain when available
    let coordinatorState = memoryCoordinatorState
    let domain: Domain<typeof d2cDomain> | undefined
    const storageDomain = ctx.get('storageDomain')
    if (storageDomain !== undefined) {
      domain = await storageDomain.open(d2cDomain)
      coordinatorState = new CoordinatorState(new DomainStateStore(domain))
    }

    // ---- execution recorder lives in DSH storage area (outside workspaces)
    const stateDir = joinStateDir()
    const recorder = new ExecutionRecorder({ stateDir })

    // Observe foreground shell tools so ChatGPT can verify actual command
    // outcomes instead of trusting the executor's prose. Background jobs are
    // intentionally excluded: their initial tool result only proves a job was
    // started, not that the command completed.
    const executionObserverDispose = ctx.on('tools/execute', async (exec: any, next: () => Promise<any>) => {
      if ((exec.name !== 'bash' && exec.name !== 'pwsh') || exec.parent !== undefined) return next()
      const args = (typeof exec.arguments === 'object' && exec.arguments !== null)
        ? exec.arguments as Record<string, unknown>
        : {}
      const command = typeof args.command === 'string' ? args.command : ''
      if (command === '' || args.run_in_background === true) return next()

      const startedAt = Date.now()
      const result = await next()
      try {
        const cwd = exec.agent?.session?.header?.cwd
        if (typeof cwd !== 'string' || cwd === '') return result
        const binding = await coordinatorState.loadWorkspace(cwd)
        const task = binding?.lastTaskId !== null && binding?.lastTaskId !== undefined
          ? await coordinatorState.loadTask(binding.lastTaskId)
          : undefined
        if (task === undefined || (task.waitingFor !== 'dsh-execution' && task.state !== 'executing')) return result

        const value = result.isError === false && typeof result.value === 'object' && result.value !== null
          ? result.value as Record<string, any>
          : undefined
        const foreground = value?.kind === 'foreground' ? value : undefined
        const stdout = typeof foreground?.stdout?.text === 'string'
          ? foreground.stdout.text
          : result.content?.map((block: any) => block?.type === 'text' ? String(block.text ?? '') : '').join('\n') ?? ''
        const stderr = typeof foreground?.stderr?.text === 'string' ? foreground.stderr.text : ''
        const exitCode = typeof foreground?.exitCode === 'number' || foreground?.exitCode === null
          ? foreground.exitCode as number | null
          : null
        const status = foreground?.timedOut === true
          ? 'timeout'
          : foreground?.aborted === true
            ? 'cancelled'
            : result.isError === true || (typeof exitCode === 'number' && exitCode !== 0)
              ? 'failure'
              : 'success'

        recorder.record({
          taskId: task.taskId,
          iteration: task.iteration,
          command,
          cwd,
          startedAt,
          endedAt: Date.now(),
          status,
          exitCode,
          stdout,
          stderr,
        })
      } catch {
        // Evidence collection must never change the executor-visible tool
        // result. Private-key rejection and recorder I/O failures stay local.
      }
      return result
    })

    // ---- browser control
    // The per-call agent comes from tool execution context; the adapter is
    // constructed per tool call so sessions stay correctly scoped.
    const makeBrowser = (agent: unknown): BrowserControl => new BrowserHarnessAdapter(ctx, agent as never)

    // ---- bridge: bind tools for the initiating session's workspace lazily.
    // The bridge server starts once; workspace binding happens at tool time
    // via the token->subject map maintained by chatgpt_status/setup.
    const bridges = new Map<string, BridgeServer>()
    const bridgeTokens = new Map<string, { subject: string; workspaceRoot: string }>()

    async function ensureBridge(workspaceRoot: string): Promise<{ port: number; token: string }> {
      const existing = bridges.get(workspaceRoot)
      if (existing !== undefined) {
        const token = [...bridgeTokens.entries()].find(([, v]) => v.workspaceRoot === workspaceRoot)?.[0]
        if (token !== undefined) return { port: existing.port, token }
      }
      const token = 'd2c_' + randomToken(32)
      const server = await startBridgeServer(
        { port: config.bridgePort, tokens: new Map([[token, 'workspace:bound']]) },
        // Tools are constructed against the workspace at bridge start; the
        // workspace is fixed for this bridge instance.
        buildWorkspaceTools(loadWorkspaceSpec(workspaceRoot, recorder)),
      )
      bridges.set(workspaceRoot, server)
      bridgeTokens.set(token, { subject: 'workspace:' + workspaceRoot, workspaceRoot })
      return { port: server.port, token }
    }

    // ---- coordinator (per workspace; cached)
    function coordinatorFor(workspaceRoot: string, agent: unknown): ChatGptCoordinator {
      // Browser Harness tools are session-gated. Build the coordinator around
      // the CURRENT tool caller so a later DSH session in the same workspace
      // never reuses the previous session's BrowserUse owner.
      return new ChatGptCoordinator({
        browser: makeBrowser(agent),
        store: coordinatorState,
        workspaceRoot,
        replyTimeoutMs: config.replyTimeoutMs,
      })
    }

    // ---- model-facing tools
    const tools = ctx.get('tools')
    if (tools === undefined) throw new Error('dsh-with-chatgpt requires the tools service')

    /** Shared output schema (raw JSON Schema subset) for the plan/review payload shape. */
    const roundOutputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'D2C task id.' },
        state: { type: 'string', description: 'Task state after this round.' },
        iteration: { type: 'integer', description: 'Protocol iteration.' },
        actions: { type: 'string', description: 'ACTIONS section from the ChatGPT envelope.' },
        successCriteria: { type: 'string', description: 'SUCCESS_CRITERIA section (plan rounds).' },
        rationale: { type: 'string', description: 'RATIONALE section (plan rounds).' },
        summary: { type: 'string', description: 'SUMMARY section (review rounds).' },
      },
      required: ['taskId', 'state', 'iteration'],
    } as const

    /** Render a round payload as compact model-facing text. */
    function renderRound(_args: Record<string, unknown>, value: Record<string, unknown>): Array<{ type: 'text'; text: string }> {
      const lines: string[] = []
      lines.push('taskId: ' + String(value['taskId']))
      lines.push('state: ' + String(value['state']))
      lines.push('iteration: ' + String(value['iteration']))
      for (const key of ['actions', 'successCriteria', 'rationale', 'summary'] as const) {
        const text = value[key]
        if (typeof text === 'string' && text.length > 0) lines.push(key + ':\n' + text)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }

    tools.register({
      name: 'chatgpt_plan',
      description:
        'Start a ChatGPT collaboration round: send the task goal to ChatGPT Web (planning brain) and wait for its '
        + 'structured PLAN envelope. ChatGPT reads the workspace itself via the read-only MCP connector; do not paste '
        + 'files or diffs into the conversation. Returns the parsed plan sections for you to execute.',
      parameters: {
        goal: { type: 'string', required: true, description: 'The concrete task goal, phrased for a planning reviewer.' },
      },
      output: {
        schema: roundOutputSchema,
        render: renderRound as never,
      },
      async execute(args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        const coordinator = coordinatorFor(workspaceRoot, exec?.agent)
        // The data plane must be listening before the INIT goes out, so the
        // ChatGPT connector can answer with workspace reads on its own.
        await ensureBridge(workspaceRoot)
        const started = await coordinator.startTask(String(args.goal))
        const round = await coordinator.awaitPlan(started.taskId)
        return {
          taskId: round.taskId,
          state: round.record.state,
          iteration: round.record.iteration,
          actions: round.envelope.sections.get('ACTIONS') ?? '',
          successCriteria: round.envelope.sections.get('SUCCESS_CRITERIA') ?? '',
          rationale: round.envelope.sections.get('RATIONALE') ?? '',
        }
      },
    })

    tools.register({
      name: 'chatgpt_review',
      description:
        'After you implemented the plan and ran tests, report execution to ChatGPT and request independent review. '
        + 'ChatGPT reads the diff and execution records itself via MCP. Returns DONE or a fix plan (PLAN state).',
      parameters: {
        taskId: { type: 'string', required: true, description: 'Task id from chatgpt_plan.' },
        changedFiles: { type: 'json', description: 'Array of changed file paths (workspace-relative).' },
        head: { type: 'string', description: 'Current git HEAD sha after your work.' },
        testsRecorded: { type: 'boolean', description: 'Whether test runs were recorded (execute tests through normal DSH tools).' },
        note: { type: 'string', description: 'Short execution note (max ~200 chars).' },
      },
      output: {
        schema: roundOutputSchema,
        render: renderRound as never,
      },
      async execute(args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        const coordinator = coordinatorFor(workspaceRoot, exec?.agent)
        const round = await coordinator.reportExecuted(String(args.taskId), {
          changedFiles: Array.isArray(args.changedFiles) ? args.changedFiles.map(String) : [],
          head: typeof args.head === 'string' ? args.head : null,
          testsRecorded: args.testsRecorded === true,
          ...(args.note !== undefined ? { note: String(args.note).slice(0, 200) } : {}),
        })
        return {
          taskId: round.taskId,
          state: round.record.state,
          iteration: round.record.iteration,
          summary: round.envelope.sections.get('SUMMARY') ?? '',
          actions: round.envelope.sections.get('ACTIONS') ?? '',
        }
      },
    })

    tools.register({
      name: 'chatgpt_status',
      description: 'Report dsh-with-chatgpt status: latest task, coordinator state, bridge ports, boot prompt id.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plugin: { type: 'string', description: 'Plugin name.' },
            workspaceRoot: { type: 'string', description: 'Workspace the status is for.' },
            latestTask: { description: 'Latest persisted task record, or null.' },
            bridgeRunning: { type: 'boolean', description: 'Whether the read-only MCP bridge is listening.' },
            bridgePort: { description: 'Bridge port when running, else null.' },
            bootPromptVersion: { type: 'integer', description: 'Boot prompt version.' },
          },
          required: ['plugin', 'workspaceRoot', 'latestTask', 'bridgeRunning', 'bootPromptVersion'],
        },
        render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{
          type: 'text' as const,
          text: JSON.stringify(value),
        }],
      },
      async execute(_args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        const coordinator = coordinatorFor(workspaceRoot, exec?.agent)
        const latestTaskId = await coordinator.latestTaskId()
        const task = latestTaskId !== undefined ? await coordinator.status(latestTaskId) : undefined
        const bridge = bridges.get(workspaceRoot)
        return {
          plugin: 'dsh-with-chatgpt',
          workspaceRoot,
          latestTask: task ?? null,
          bridgeRunning: bridge !== undefined,
          bridgePort: bridge?.port ?? null,
          bootPromptVersion: 1,
        }
      },
    })

    tools.register({
      name: 'chatgpt_reconnect',
      description: 'Recover the ChatGPT control plane after browser reload, logout, or DSH restart; rebinding the latest task.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            recovered: { type: 'boolean', description: 'Whether a prior task was found and rebound.' },
            task: { description: 'Recovered task record, or null.' },
            detail: { type: 'string', description: 'Human-readable recovery detail.' },
          },
          required: ['recovered', 'task', 'detail'],
        },
        render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{
          type: 'text' as const,
          text: String(value['detail']),
        }],
      },
      async execute(_args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        const coordinator = coordinatorFor(workspaceRoot, exec?.agent)
        const task = await coordinator.recover()
        return {
          recovered: task !== undefined,
          task: task ?? null,
          detail: task !== undefined ? 'conversation rebound; task state intact' : 'no prior task for this workspace',
        }
      },
    })

    // ---- system prompt section
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt !== undefined && typeof systemPrompt.section === 'function' && typeof systemPrompt.getSectionOrder === 'function') {
      systemPrompt.section({
        name: 'dsh-with-chatgpt:collaboration',
        order: systemPrompt.getSectionOrder('TOOL_WORKFLOW'),
        text: [
          'dsh-with-chatgpt present: when the user asks to collaborate with ChatGPT (for example: use ChatGPT to implement X, or plan X), start a collaboration round:',
          '- Use chatgpt_plan to get the ChatGPT plan; execute it yourself with normal DSH tools (edit/shell/test/git).',
          '- ChatGPT owns WHAT/WHY (architecture, planning, review); you own HOW (implementation, tests, git).',
          '- Never paste file contents or diffs into the ChatGPT conversation: ChatGPT reads the workspace through the read-only MCP connector.',
          '- After implementing and running tests, call chatgpt_review with changed files + HEAD; ChatGPT independently verifies via MCP.',
          '- Never treat ChatGPT replies as shell scripts; derive your own steps.',
        ].join('\n'),
      })
    }

    // ---- cleanup
    return () => {
      executionObserverDispose()
      for (const bridge of bridges.values()) void bridge.close()
      bridges.clear()
      domain?.close().catch(() => undefined)
    }
  }

  return activate()
}

/** Minimal tool execution context shape used by this plugin. */
type ToolExec = { agent?: { session?: { header?: { cwd?: string } } } }

/** Workspace root for a tool execution (session cwd). */
function workspaceOf(exec: { agent?: { session?: { header?: { cwd?: string } } } } | undefined): string {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') return cwd
  return process.cwd()
}

/** State dir under the OS config home (never inside a workspace). */
function joinStateDir(): string {
  const base = process.env['LOCALAPPDATA'] ?? process.env['XDG_STATE_HOME'] ?? process.env['HOME'] ?? process.cwd()
  return joinPath(String(base), 'dsh-with-chatgpt')
}

/** Random hex token. */
function randomToken(bytes: number): string {
  const array = new Uint8Array(bytes)
  randomFillSync(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}
